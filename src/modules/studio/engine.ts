/**
 * Moteur de rendu et d'edition du Studio 3D.
 *
 * L'objectif est double : donner au client une image credible de ce qu'il
 * loue, et donner a l'equipe un outil de conception d'espace — terrain aux
 * bonnes dimensions, grille d'accrochage, manipulateurs de deplacement, de
 * rotation et de mise a l'echelle, vue en plan cotee.
 *
 * Chaine de rendu : ciel physique de Preetham, soleil directionnel avec ombres
 * douces, environnement IBL, occlusion ambiante en espace ecran, halo selectif,
 * anticrenelage SMAA et tone mapping ACES filmique.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GroundPoint, Scene as SceneModel, SceneItem } from '../../core/types';
import { itemSize, objectDef } from './library';
import { buildObject } from './models';
import { createMaterials, groundMaterial, type StudioMaterials } from './materials';

export type CameraPreset = 'public' | 'face' | 'plongee' | 'scene' | 'laterale' | 'plan';
export type TransformMode = 'translate' | 'rotate' | 'scale';

interface DayProfile {
  elevation: number;
  turbidity: number;
  exposure: number;
  sun: number;
  ambient: number;
  /** Assombrissement du sol : une pelouse de nuit n'est pas une pelouse de jour. */
  night: number;
  /** Fond visible : zenith, ciel median, horizon. */
  sky: [string, string, string];
  /** Intensite de l'environnement issu du ciel physique. */
  env: number;
  /** Teinte de la lumiere directe : le soleil rougit en descendant. */
  light: string;
  /** Astre visible dans la voute : couleur, intensite, elevation (deg). */
  disc: { color: string; power: number; elevation: number };
}

/**
 * Finition photographique appliquee apres le tone mapping.
 *
 * Trois effets qu'aucune image de rendu credible n'omet : le vignettage, qui
 * ramene le regard au centre ; l'aberration chromatique laterale, minuscule,
 * qui evite l'aspect « image de synthese parfaite » ; et un grain tres fin qui
 * casse le banding des degrades de ciel.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.03 },
    uAberration: { value: 0.0016 },
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);

      // L'aberration croit avec la distance au centre, comme sur un objectif.
      vec2 offset = centered * uAberration * r2 * 4.0;
      vec4 color;
      color.r = texture2D(tDiffuse, vUv + offset).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - offset).b;
      color.a = texture2D(tDiffuse, vUv).a;

      float vignette = 1.0 - uVignette * smoothstep(0.15, 0.72, r2);
      color.rgb *= vignette;

      float grain = hash(vUv * 1024.0 + uTime) - 0.5;
      color.rgb += grain * uGrain;

      gl_FragColor = color;
    }
  `,
};

/**
 * Teintes de vetements observees dans un public : denim, noir, gris, kaki,
 * blanc casse, et quelques pieces franches. Les repetitions dans la liste
 * ponderent la palette — le denim et le noir dominent, le rouge est rare.
 */
const CROWD_PALETTE = [
  '#2b3242', '#2b3242', '#1d2129', '#1d2129', '#3c4350', '#4c5462',
  '#6d6f6b', '#8b8d88', '#c9c4b8', '#e2ded3',
  '#3f4a35', '#5a5138', '#7a6a4f', '#402a24',
  '#2f4d63', '#1f3b57', '#6b2f38', '#8c4a2f', '#a8763c', '#3f6b52',
];

const DAY: Record<SceneModel['timeOfDay'], DayProfile> = {
  jour: {
    elevation: 44, turbidity: 4.5, exposure: 0.95, sun: 3.0, ambient: 0.62, night: 1,
    sky: ['#2f6bb0', '#9dc4e4', '#dce9f3'], env: 1, light: '#fff6e6',
    disc: { color: '#fff6dd', power: 1, elevation: 44 },
  },
  crepuscule: {
    elevation: 14, turbidity: 8, exposure: 1.05, sun: 2.2, ambient: 0.34, night: 0.68,
    sky: ['#1b2647', '#7a5878', '#d8894f'], env: 0.75, light: '#ffb271',
    disc: { color: '#ffb265', power: 1.15, elevation: 11 },
  },
  nuit: {
    elevation: -14, turbidity: 6, exposure: 1.45, sun: 0.3, ambient: 0.7, night: 0.5,
    sky: ['#070c18', '#0f1a2e', '#20304a'], env: 1.1, light: '#9fb6e8',
    // La nuit, l'astre visible est la lune : haute, froide et discrete.
    disc: { color: '#dbe6ff', power: 0.3, elevation: 52 },
  },
};


/**
 * Contour de l'emprise du terrain, dans le plan XZ.
 * Le rectangle reste le cas courant ; le L, le cercle, l'ovale et le polygone
 * libre couvrent les cours, les places et les parcelles reelles, qui ne sont
 * presque jamais des rectangles parfaits.
 */
export function groundOutline(model: SceneModel): THREE.Vector2[] {
  const hw = model.width / 2;
  const hd = model.depth / 2;
  switch (model.groundShape) {
    case 'l':
      return [
        new THREE.Vector2(-hw, -hd),
        new THREE.Vector2(hw, -hd),
        new THREE.Vector2(hw, 0),
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0, hd),
        new THREE.Vector2(-hw, hd),
      ];
    case 'cercle':
    case 'ovale': {
      const radius = model.groundShape === 'cercle' ? Math.min(hw, hd) : 1;
      const points: THREE.Vector2[] = [];
      for (let index = 0; index < 48; index += 1) {
        const angle = (index / 48) * Math.PI * 2;
        points.push(
          model.groundShape === 'cercle'
            ? new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius)
            : new THREE.Vector2(Math.cos(angle) * hw, Math.sin(angle) * hd),
        );
      }
      return points;
    }
    case 'polygone':
      return model.polygon.length >= 3
        ? model.polygon.map((point) => new THREE.Vector2(point.x, point.z))
        : [new THREE.Vector2(-hw, -hd), new THREE.Vector2(hw, -hd), new THREE.Vector2(hw, hd), new THREE.Vector2(-hw, hd)];
    default:
      return [new THREE.Vector2(-hw, -hd), new THREE.Vector2(hw, -hd), new THREE.Vector2(hw, hd), new THREE.Vector2(-hw, hd)];
  }
}

/** Aire d'un contour ferme, en metres carres (formule du lacet). */
export function polygonArea(points: { x: number; z: number }[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

/** Perimetre d'un contour ferme, en metres. */
export function polygonPerimeter(points: { x: number; z: number }[]): number {
  let length = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return length;
}

/** Aire de l'emprise du terrain. */
export function groundArea(model: SceneModel): number {
  return polygonArea(groundOutline(model).map((point) => ({ x: point.x, z: point.y })));
}

/** Couleur renvoyee par le sol dans l'eclairage indirect. */
const GROUND_BOUNCE: Record<string, string> = {
  herbe: '#3f5a2c',
  'gazon-tondu': '#4a6b33',
  terre: '#6b5237',
  sable: '#a48a5e',
  bitume: '#2f3236',
  beton: '#6d7178',
  parquet: '#7a5334',
  moquette: '#3a3129',
  carrelage: '#8e9096',
  gravier: '#6a6862',
};

/* ------------------------------------------------------ faisceau volumetrique */

const BEAM_VERTEX = `
  varying float vY;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vY = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BEAM_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uHaze;
  varying float vY;
  varying vec2 vUv;
  void main() {
    // Attenuation le long du faisceau et adoucissement des bords du cone.
    float lengthFade = pow(vY, 1.6);
    float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
    float alpha = lengthFade * edge * uIntensity * (0.07 + uHaze * 0.5);
    gl_FragColor = vec4(uColor * (0.45 + uIntensity * 0.6), alpha);
  }
`;

function beamMaterial(color: THREE.ColorRepresentation, intensity: number, haze: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uHaze: { value: haze },
    },
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Cible de l'edition de contour : l'emprise du site ou une zone. */
export type SurfaceTarget = { kind: 'site' } | { kind: 'zone'; id: string };

/** Une modification d'objet issue du gizmo. */
export interface TransformChange {
  id: string;
  change: Partial<SceneItem>;
}

export interface EngineHandlers {
  /** `additive` : la touche Maj etait enfoncee — on ajoute a la selection. */
  onSelect: (itemId: string | null, additive: boolean) => void;
  /** Emis a la fin d'une manipulation au gizmo, pour tous les objets tenus. */
  onTransform: (changes: TransformChange[]) => void;
  onHover: (itemId: string | null) => void;
  /** Emis apres modification d'un contour a la souris. */
  onSurfaceChange: (target: SurfaceTarget, points: GroundPoint[]) => void;
  /** Emis a chaque point pose par le decametre. */
  onMeasure: (points: GroundPoint[]) => void;
}

export class StudioEngine {
  private host: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private planCamera: THREE.OrthographicCamera;
  private controls: OrbitControls;
  private gizmo: TransformControls;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private gtao: GTAOPass | null = null;
  private grade!: ShaderPass;
  private materials: StudioMaterials = createMaterials();

  private content = new THREE.Group();
  private helpers = new THREE.Group();
  private beams: THREE.ShaderMaterial[] = [];
  private clock = new THREE.Clock();
  private frame = 0;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private grid: THREE.GridHelper | null = null;
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xbdd7ff, 0x4a4438, 1);
  private model: SceneModel | null = null;
  private disposed = false;
  private planMode = false;
  private downAt = { x: 0, y: 0, time: 0 };
  private dimensions = new THREE.Group();
  private crowd: THREE.Object3D[] = [];
  private ground: THREE.Mesh | null = null;
  private environmentMap: THREE.Texture | null = null;
  private environmentKey = '';
  private groundTint = 1;
  private builtScene: string | null = null;
  private surfaceTarget: SurfaceTarget | null = null;
  private surfaceHandles = new THREE.Group();
  private dragging: { index: number; insert: boolean } | null = null;
  private workingOutline: GroundPoint[] | null = null;
  private hoveredHandle: { index: number; insert: boolean } | null = null;
  private outlineLine: THREE.LineLoop | null = null;
  private surfacePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private selection: string[] = [];
  private outlines: THREE.Box3Helper[] = [];
  /** Pivot virtuel : c'est lui que tient le gizmo quand plusieurs objets sont pris. */
  private pivot = new THREE.Object3D();
  private pivotStart = new THREE.Vector3();
  private groupStart = new Map<string, { position: THREE.Vector3; rotY: number; scale: THREE.Vector3 }>();

  private measuring = false;
  private measurePoints: GroundPoint[] = [];
  private measureGroup = new THREE.Group();

  handlers: EngineHandlers = {
    onSelect: () => {},
    onTransform: () => {},
    onHover: () => {},
    onSurfaceChange: () => {},
    onMeasure: () => {},
  };

  /** Diagnostic de la chaine de rendu, pour le support et les tests. */
  diagnostics() {
    let casters = 0;
    let receivers = 0;
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.castShadow) casters += 1;
      if (mesh.receiveShadow) receivers += 1;
    });
    const camera = this.sun.shadow.camera;
    return {
      shadowMapEnabled: this.renderer.shadowMap.enabled,
      shadowMapType: this.renderer.shadowMap.type,
      sunCastShadow: this.sun.castShadow,
      sunIntensity: this.sun.intensity,
      hemiIntensity: this.hemi.intensity,
      envIntensity: this.scene.environmentIntensity,
      exposure: this.renderer.toneMappingExposure,
      sunPosition: this.sun.position.toArray().map((value) => Math.round(value)),
      shadowBox: [camera.left, camera.right, camera.top, camera.bottom, camera.near, camera.far].map((v) => Math.round(v)),
      casters,
      receivers,
      items: this.content.children.length,
      visibleItems: this.content.children.filter((node) => node.visible).length,
      selection: this.selection.length,
      measurePoints: this.measurePoints.length,
      passes: this.composer.passes.map((pass) => pass.constructor.name),
    };
  }

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    // Courbe « PBR Neutral » de Khronos. ACES sature les couleurs vives et vire
    // les hautes lumieres au blanc ; AgX, essaye ici, desature tellement les
    // tons moyens qu'une pelouse devient grise. La courbe neutre garde la
    // couleur exacte des materiaux dans les tons moyens et n'ecrase que les
    // tres hautes lumieres — c'est ce que font les visualiseurs produit.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(46, host.clientWidth / host.clientHeight, 0.1, 2200);
    this.camera.position.set(0, 6, 22);

    this.planCamera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 500);
    this.planCamera.position.set(0, 120, 0);
    this.planCamera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.497;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 260;
    this.controls.target.set(0, 2.2, 0);

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.85);
    this.gizmo.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !(event as unknown as { value: boolean }).value;
      if (!(event as unknown as { value: boolean }).value) this.commitTransform();
    });
    // Le pivot n'existe que le temps d'une manipulation multiple : c'est lui
    // que deplace le gizmo, les objets suivent a chaque image.
    this.gizmo.addEventListener('objectChange', () => this.followPivot());
    const helper = this.gizmo.getHelper();
    helper.visible = false;
    this.scene.add(helper);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(3072, 3072);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 2.5;
    this.sun.shadow.blurSamples = 16;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.dimensions.visible = false;
    this.scene.add(this.content, this.helpers, this.dimensions, this.surfaceHandles, this.measureGroup, this.pivot);

    this.buildComposer('equilibre');

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('resize', this.resize);
    this.loop();
  }

  /* ------------------------------------------------------ chaine de rendu */

  private buildComposer(quality: SceneModel['quality']) {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.activeCamera()));

    // L'occlusion ambiante en espace ecran ancre les objets au sol : c'est
    // elle qui fait la difference entre une maquette et une image credible.
    if (quality !== 'rapide') {
      const gtao = new GTAOPass(this.scene, this.camera, width, height);
      gtao.output = GTAOPass.OUTPUT.Default;
      // Le rayon s'exprime en metres : cale sur la taille du site, sinon
      // l'occlusion est invisible sur un terrain et trop dure dans une salle.
      const site = this.model ? Math.max(this.model.width, this.model.depth) : 30;
      const radius = THREE.MathUtils.clamp(site * 0.035, 0.5, 2.2);
      gtao.updateGtaoMaterial({
        radius: quality === 'photo' ? radius * 1.3 : radius,
        distanceExponent: 1.2,
        thickness: 1.4,
        scale: quality === 'photo' ? 1.5 : 1.2,
        samples: quality === 'photo' ? 16 : 10,
      });
      this.composer.addPass(gtao);
      this.gtao = gtao;
    } else {
      this.gtao = null;
    }

    // Le halo est applique APRES le tone mapping : sur un ciel diurne, dont la
    // luminance depasse largement 1 en lineaire, un halo applique avant
    // saturerait toute l'image. En sortie sRGB, le seuil signifie enfin
    // « pixels presque blancs » — les sources lumineuses, pas le ciel.
    this.composer.addPass(new OutputPass());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.4, 0.35, 0.95);
    this.composer.addPass(this.bloom);
    // L'antialiasing du contexte WebGL ne s'applique pas au rendu differe du
    // composer : sans SMAA, toutes les aretes du decor crenellent.
    if (quality !== 'rapide') this.composer.addPass(new SMAAPass());

    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uVignette.value = quality === 'rapide' ? 0.22 : 0.3;
    this.grade.uniforms.uAberration.value = quality === 'rapide' ? 0 : 0.0016;
    this.composer.addPass(this.grade);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'photo' ? 2 : quality === 'rapide' ? 1 : 1.5));
    this.syncRenderCamera();
  }

  /**
   * Aligne les passes sur la camera courante.
   *
   * Le composer est rebati a chaque changement de qualite et a chaque
   * reconstruction de scene ; sans ce recalage, il repart sur la camera
   * perspective. La vue en plan restait alors active pour la selection et les
   * poignees mais l'image affichee redevenait une perspective — le pire des
   * cas, puisque rien ne signale l'incoherence.
   */
  private syncRenderCamera() {
    const camera = this.activeCamera();
    const pass = this.composer.passes[0] as RenderPass;
    if (pass) pass.camera = camera;
    if (this.gtao) this.gtao.camera = camera as THREE.PerspectiveCamera;
  }

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const time = this.clock.getElapsedTime();
    if (this.grade) this.grade.uniforms.uTime.value = time;
    for (const material of this.beams) {
      material.uniforms.uIntensity.value =
        (material.userData.base as number) * (0.93 + Math.sin(time * 1.7 + (material.userData.phase as number)) * 0.07);
    }
    this.controls.update();
    this.composer.render();
  };

  private resize = () => {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.updatePlanFrustum();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.host.contains(this.renderer.domElement)) this.host.removeChild(this.renderer.domElement);
  }

  /* --------------------------------------------------------- interaction */

  private onPointerDown = (event: PointerEvent) => {
    this.downAt = { x: event.clientX, y: event.clientY, time: performance.now() };
    if (event.button !== 0 || !this.surfaceTarget) return;
    const handle = this.pickHandle(event);
    if (!handle) return;
    // Une poignee saisie fige la navigation : sans cela, la vue tourne en meme
    // temps que le sommet se deplace.
    this.controls.enabled = false;
    const points = this.currentOutline();
    if (handle.insert) {
      const a = points[handle.index];
      const b = points[(handle.index + 1) % points.length];
      points.splice(handle.index + 1, 0, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      this.dragging = { index: handle.index + 1, insert: false };
    } else {
      this.dragging = { index: handle.index, insert: false };
    }
    this.workingOutline = points;
    this.drawSurface();
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.dragging && this.workingOutline) {
      const point = this.groundPoint(event);
      if (!point) return;
      this.workingOutline[this.dragging.index] = point;
      this.drawSurface();
      return;
    }
    if (this.surfaceTarget) {
      this.hoveredHandle = this.pickHandle(event);
      this.renderer.domElement.style.cursor = this.hoveredHandle ? 'grab' : 'crosshair';
      return;
    }
    if (this.measuring) {
      this.renderer.domElement.style.cursor = 'crosshair';
      return;
    }
    const hit = this.pick(event);
    this.handlers.onHover(hit);
    this.renderer.domElement.style.cursor = hit ? 'pointer' : 'default';
  };

  /** Un clic selectionne ; un glisser fait tourner la vue. */
  private onPointerUp = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (this.dragging) {
      this.dragging = null;
      this.controls.enabled = true;
      if (this.surfaceTarget && this.workingOutline) {
        this.handlers.onSurfaceChange(this.surfaceTarget, this.workingOutline);
        this.workingOutline = null;
      }
      return;
    }
    const moved = Math.hypot(event.clientX - this.downAt.x, event.clientY - this.downAt.y);
    if (moved > 5 || performance.now() - this.downAt.time > 600) return;
    if ((this.gizmo as unknown as { dragging: boolean }).dragging) return;
    if (this.surfaceTarget) return;
    if (this.measuring) {
      const point = this.groundPoint(event);
      if (!point) return;
      this.measurePoints.push(point);
      this.drawMeasure();
      this.handlers.onMeasure(this.measurePoints.map((entry) => ({ ...entry })));
      return;
    }
    const hit = this.pick(event);
    this.handlers.onSelect(hit, event.shiftKey);
  };

  private pick(event: PointerEvent): string | null {
    const box = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
    this.pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.activeCamera());
    for (const hit of this.raycaster.intersectObjects(this.content.children, true)) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.itemId) node = node.parent;
      if (node?.userData.itemId) return node.userData.itemId as string;
    }
    return null;
  }

  private activeCamera(): THREE.Camera {
    return this.planMode ? this.planCamera : this.camera;
  }

  /* --------------------------------------------------------- manipulateurs */

  setTransformMode(mode: TransformMode) {
    this.gizmo.setMode(mode);
    // Le choix des axes depend du mode ET du nombre d'objets tenus.
    if (this.selection.length > 1) this.selectMany(this.selection);
  }

  /** Identifiants actuellement selectionnes. */
  getSelection(): string[] {
    return [...this.selection];
  }

  /** Identifiants de tous les objets poses, dans l'ordre de la scene. */
  allItemIds(): string[] {
    return this.content.children
      .map((node) => node.userData.itemId as string | undefined)
      .filter((id): id is string => Boolean(id));
  }

  setSnap(step: number) {
    this.gizmo.setTranslationSnap(step > 0 ? step : null);
    this.gizmo.setRotationSnap(step > 0 ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(step > 0 ? 0.05 : null);
  }

  selectById(itemId: string | null) {
    this.selectMany(itemId ? [itemId] : []);
  }

  /**
   * Selection multiple.
   *
   * Un seul objet : le gizmo se pose dessus, comme avant. Plusieurs : il se
   * pose sur un pivot virtuel place au centre de la selection, et les objets
   * suivent le mouvement du pivot. C'est la seule facon de deplacer un groupe
   * sans reparenter les objets — un reparentage changerait leurs coordonnees
   * dans le modele.
   */
  selectMany(ids: string[]) {
    this.outlineOff();
    const helper = this.gizmo.getHelper();
    this.gizmo.detach();
    helper.visible = false;

    const nodes = ids
      .map((id) => this.content.children.find((child) => child.userData.itemId === id))
      .filter((node): node is THREE.Object3D => Boolean(node));
    this.selection = nodes.map((node) => node.userData.itemId as string);

    for (const node of nodes) {
      const box = new THREE.Box3().setFromObject(node).expandByScalar(0.06);
      const outline = new THREE.Box3Helper(box, new THREE.Color(nodes.length > 1 ? '#7bc2ff' : '#3987e5'));
      this.outlines.push(outline);
      this.helpers.add(outline);
    }
    if (!nodes.length || this.measuring || this.surfaceTarget) return;

    const movable = nodes.filter((node) => !node.userData.locked);
    if (!movable.length) return;

    if (movable.length === 1) {
      this.gizmo.attach(movable[0]);
      this.gizmo.showX = true;
      this.gizmo.showY = true;
      this.gizmo.showZ = true;
      helper.visible = true;
      return;
    }

    this.resetPivot(movable);
    this.gizmo.attach(this.pivot);
    // En rotation, un groupe ne tourne qu'autour de la verticale : le modele
    // ne stocke pas de roulis, et un basculement serait perdu a l'ecriture.
    const rotating = this.gizmo.getMode() === 'rotate';
    this.gizmo.showX = !rotating;
    this.gizmo.showY = true;
    this.gizmo.showZ = !rotating;
    helper.visible = true;
  }

  /** Replace le pivot au centre de la selection et memorise l'etat de depart. */
  private resetPivot(nodes: THREE.Object3D[]) {
    const centre = new THREE.Vector3();
    for (const node of nodes) centre.add(node.position);
    centre.divideScalar(nodes.length);
    this.pivot.position.copy(centre);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
    this.pivotStart.copy(centre);
    this.groupStart.clear();
    for (const node of nodes) {
      this.groupStart.set(node.userData.itemId as string, {
        position: node.position.clone(),
        rotY: node.rotation.y,
        scale: node.scale.clone(),
      });
    }
  }

  /** Applique au groupe le deplacement, la rotation et l'echelle du pivot. */
  private followPivot() {
    if (this.gizmo.object !== this.pivot || !this.groupStart.size) return;
    const delta = new THREE.Vector3().subVectors(this.pivot.position, this.pivotStart);
    const spin = this.pivot.rotation.y;
    const factor = this.pivot.scale;
    const offset = new THREE.Vector3();
    for (const node of this.content.children) {
      const start = this.groupStart.get(node.userData.itemId as string);
      if (!start) continue;
      offset.subVectors(start.position, this.pivotStart).multiply(factor).applyAxisAngle(UP, spin);
      node.position.copy(this.pivotStart).add(offset).add(delta);
      node.rotation.y = start.rotY + spin;
      node.scale.copy(start.scale).multiply(factor);
    }
  }

  private outlineOff() {
    for (const outline of this.outlines) {
      this.helpers.remove(outline);
      outline.geometry.dispose();
    }
    this.outlines = [];
  }

  /** Renvoie a l'application la position, la rotation et les cotes obtenues. */
  private commitTransform() {
    const scaling = this.gizmo.getMode() === 'scale';
    const read = (node: THREE.Object3D): TransformChange => {
      const nominal = node.userData.nominal as [number, number, number];
      const change: Partial<SceneItem> = {
        x: round(node.position.x),
        y: round(node.position.y),
        z: round(node.position.z),
        rotY: round(node.rotation.y, 3),
        rotX: round(node.rotation.x, 3),
      };
      if (scaling) {
        change.width = round(nominal[0] * node.scale.x);
        change.height = round(nominal[1] * node.scale.y);
        change.depth = round(nominal[2] * node.scale.z);
      }
      return { id: node.userData.itemId as string, change };
    };

    if (this.gizmo.object === this.pivot) {
      const moved = this.content.children.filter((node) => this.groupStart.has(node.userData.itemId as string));
      if (!moved.length) return;
      this.handlers.onTransform(moved.map(read));
      // Le pivot repart de zero : sans cela, la rotation deja appliquee
      // s'ajouterait a la suivante et le groupe partirait en vrille.
      this.resetPivot(moved);
      return;
    }

    const node = this.gizmo.object;
    if (!node?.userData.itemId) return;
    this.handlers.onTransform([read(node)]);
  }

  /* ---------------------------------------------------------- decametre */

  /**
   * Decametre : chaque clic pose un point au sol, chaque segment porte sa
   * longueur, et une chaine de plusieurs segments affiche son cumul. C'est
   * l'outil qu'on cherche des qu'il faut verifier un passage pompier ou le
   * recul devant une scene.
   */
  setMeasureMode(active: boolean) {
    this.measuring = active;
    this.measurePoints = [];
    this.drawMeasure();
    this.renderer.domElement.style.cursor = active ? 'crosshair' : 'default';
    if (active) {
      this.gizmo.detach();
      this.gizmo.getHelper().visible = false;
      this.outlineOff();
    }
    this.handlers.onMeasure([]);
  }

  isMeasuring(): boolean {
    return this.measuring;
  }

  /** Retire le dernier point pose ; vide la chaine si elle n'en a qu'un. */
  undoMeasurePoint() {
    this.measurePoints.pop();
    this.drawMeasure();
    this.handlers.onMeasure(this.measurePoints.map((point) => ({ ...point })));
  }

  clearMeasure() {
    this.measurePoints = [];
    this.drawMeasure();
    this.handlers.onMeasure([]);
  }

  private drawMeasure() {
    while (this.measureGroup.children.length) {
      const child = this.measureGroup.children[0] as THREE.Mesh;
      this.measureGroup.remove(child);
      child.geometry?.dispose?.();
    }
    const points = this.measurePoints;
    if (!points.length) return;

    const span = this.model ? Math.max(this.model.width, this.model.depth) : 30;
    const radius = Math.max(0.12, span * 0.007);
    const marker = new THREE.SphereGeometry(radius, 12, 10);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffc857, depthTest: false, toneMapped: false });
    for (const point of points) {
      const dot = new THREE.Mesh(marker, markerMaterial);
      dot.position.set(point.x, 0.08, point.z);
      dot.renderOrder = 6;
      this.measureGroup.add(dot);
    }

    if (points.length < 2) return;
    const vertices = points.map((point) => new THREE.Vector3(point.x, 0.08, point.z));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(vertices),
      new THREE.LineBasicMaterial({ color: 0xffc857, depthTest: false, toneMapped: false }),
    );
    line.renderOrder = 6;
    this.measureGroup.add(line);

    // Taille figee a l'ecran : une cote de mesure doit rester lisible qu'on
    // soit au ras du sol ou en vue d'ensemble.
    const scale = 0.028;
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      total += length;
      const label = textSprite(
        `${length.toFixed(2).replace('.', ',')} m`,
        new THREE.Vector3((a.x + b.x) / 2, 0.3, (a.z + b.z) / 2),
        scale,
        { screen: true, tint: '#ffd98a' },
      );
      label.renderOrder = 7;
      this.measureGroup.add(label);
    }
    if (points.length > 2) {
      const last = points[points.length - 1];
      const label = textSprite(
        `cumul ${total.toFixed(2).replace('.', ',')} m`,
        new THREE.Vector3(last.x, 0.9, last.z),
        scale * 1.15,
        { screen: true, tint: '#ffc857' },
      );
      label.renderOrder = 7;
      this.measureGroup.add(label);
    }
  }


  /* ------------------------------------------------ edition des surfaces */

  /**
   * Entre en edition de contour. Les sommets deviennent des poignees
   * deplacables et un point d'insertion apparait au milieu de chaque arete :
   * c'est la maniere dont on dessine une parcelle dans un logiciel de plan.
   */
  setSurfaceTarget(target: SurfaceTarget | null) {
    this.surfaceTarget = target;
    this.gizmo.detach();
    this.gizmo.getHelper().visible = false;
    if (target) this.outlineOff();
    this.refreshHandles();
  }

  getSurfaceTarget(): SurfaceTarget | null {
    return this.surfaceTarget;
  }

  /** Contour actuellement edite, copie pour modification. */
  private currentOutline(): GroundPoint[] {
    if (this.workingOutline) return this.workingOutline;
    const model = this.model;
    if (!model || !this.surfaceTarget) return [];
    if (this.surfaceTarget.kind === 'site') {
      return groundOutline(model).map((point) => ({ x: point.x, z: point.y }));
    }
    const target = this.surfaceTarget;
    const found = model.zones.find((entry) => entry.id === target.id);
    return found ? found.polygon.map((point) => ({ ...point })) : [];
  }

  /** Point du sol sous le curseur, accroche a la grille. */
  private groundPoint(event: PointerEvent): GroundPoint | null {
    const box = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
    this.pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.activeCamera());
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.surfacePlane, hit)) return null;
    const step = this.model?.gridSnap ?? 0;
    const snap = (value: number) => (step > 0 ? Math.round(value / step) * step : Math.round(value * 100) / 100);
    return { x: snap(hit.x), z: snap(hit.z) };
  }

  private pickHandle(event: PointerEvent): { index: number; insert: boolean } | null {
    const box = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
    this.pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.activeCamera());
    const hits = this.raycaster.intersectObjects(this.surfaceHandles.children, false);
    const hit = hits[0]?.object;
    if (!hit) return null;
    return { index: hit.userData.index as number, insert: Boolean(hit.userData.insert) };
  }

  /** Supprime le sommet survole, si le contour peut se le permettre. */
  removeHoveredVertex(): boolean {
    const handle = this.hoveredHandle;
    if (!this.surfaceTarget || !handle || handle.insert) return false;
    const points = this.currentOutline();
    if (points.length <= 3) return false;
    points.splice(handle.index, 1);
    this.hoveredHandle = null;
    this.handlers.onSurfaceChange(this.surfaceTarget, points);
    return true;
  }

  /** Redessine poignees et contour sans reconstruire la scene. */
  private drawSurface() {
    this.refreshHandles();
    const points = this.currentOutline();
    if (this.outlineLine) {
      this.outlineLine.geometry.dispose();
      this.outlineLine.geometry = new THREE.BufferGeometry().setFromPoints(
        points.map((point) => new THREE.Vector3(point.x, 0.05, point.z)),
      );
    }
  }

  /** Redessine les poignees du contour en cours d'edition. */
  private refreshHandles() {
    this.surfaceHandles.clear();
    const model = this.model;
    if (!model || !this.surfaceTarget) return;

    const points = this.currentOutline();
    if (points.length < 3) return;
    const radius = Math.max(0.16, Math.max(model.width, model.depth) * 0.009);
    const vertexMaterial = new THREE.MeshBasicMaterial({ color: 0x3987e5, depthTest: false, toneMapped: false });
    const insertMaterial = new THREE.MeshBasicMaterial({
      color: 0xf2f5f8,
      depthTest: false,
      toneMapped: false,
      transparent: true,
      opacity: 0.65,
    });
    const disc = new THREE.CircleGeometry(radius, 20);
    const small = new THREE.CircleGeometry(radius * 0.62, 16);

    points.forEach((point, index) => {
      const handle = new THREE.Mesh(disc, vertexMaterial);
      handle.rotation.x = -Math.PI / 2;
      handle.position.set(point.x, 0.09, point.z);
      handle.renderOrder = 20;
      handle.userData = { index, insert: false };
      this.surfaceHandles.add(handle);

      const next = points[(index + 1) % points.length];
      const mid = new THREE.Mesh(small, insertMaterial);
      mid.rotation.x = -Math.PI / 2;
      mid.position.set((point.x + next.x) / 2, 0.085, (point.z + next.z) / 2);
      mid.renderOrder = 20;
      mid.userData = { index, insert: true };
      this.surfaceHandles.add(mid);
    });
  }

  /* ------------------------------------------------------------- cadrages */

  /**
   * Boite englobante du contenu pose, hors decor de site.
   * Les cadrages s'appuient dessus plutot que sur des fractions du terrain :
   * c'est ce qui evite de placer la camera a l'interieur d'une tente ou de
   * cadrer dans le vide quand l'implantation n'occupe qu'un coin du site.
   */
  private contentBounds(model: SceneModel): THREE.Box3 {
    const box = new THREE.Box3();
    let found = false;
    for (const child of this.content.children) {
      const id = child.userData.itemId as string | undefined;
      const item = model.items.find((entry) => entry.id === id);
      // Les arbres et les reperes d'echelle ne doivent pas tirer le cadrage.
      if (item && ['arbre', 'person', 'person-seated', 'voiture'].includes(item.model3d)) continue;
      box.expandByObject(child);
      found = true;
    }
    if (!found || box.isEmpty()) {
      box.set(
        new THREE.Vector3(-model.width / 2, 0, -model.depth / 2),
        new THREE.Vector3(model.width / 2, model.height, model.depth / 2),
      );
    }
    return box;
  }

  setCamera(preset: CameraPreset) {
    const model = this.model;
    if (!model) return;
    if (preset === 'plan') return this.setPlanMode(true);
    this.setPlanMode(false);

    const box = this.contentBounds(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Recul necessaire pour contenir l'implantation : on tient compte du champ
    // horizontal, plus large que le champ vertical, sans quoi le cadrage recule
    // beaucoup trop sur un site large et plat.
    const radius = Math.max(size.x, size.z) / 2;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const back = Math.max(8, (radius / Math.tan(Math.min(vFov, hFov) / 2)) * 0.62);

    const targets: Record<Exclude<CameraPreset, 'plan'>, [THREE.Vector3, THREE.Vector3]> = {
      public: [
        new THREE.Vector3(center.x, 1.7, box.max.z + Math.max(3, size.z * 0.35)),
        new THREE.Vector3(center.x, Math.min(2.6, size.y * 0.5), center.z),
      ],
      face: [
        new THREE.Vector3(center.x, Math.max(4, size.y * 0.8), box.max.z + back),
        new THREE.Vector3(center.x, size.y * 0.4, center.z),
      ],
      plongee: [
        new THREE.Vector3(center.x + back * 0.62, Math.max(size.y * 1.8, back * 0.7), box.max.z + back * 0.62),
        new THREE.Vector3(center.x, 0.8, center.z),
      ],
      laterale: [
        new THREE.Vector3(box.min.x - back * 0.85, Math.max(3, size.y * 0.7), center.z + size.z * 0.15),
        new THREE.Vector3(center.x, size.y * 0.38, center.z),
      ],
      scene: [
        new THREE.Vector3(center.x, Math.max(2.2, size.y * 0.35), box.min.z - Math.max(2, size.z * 0.12)),
        new THREE.Vector3(center.x, 1.6, box.max.z),
      ],
    };

    const [position, target] = targets[preset];
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.controls.update();
  }

  /**
   * Profil de rendu de la vue en plan : une implantation se lit a plat, sans
   * halo, sans brouillard et sous une lumiere neutre.
   */
  private applyPlanProfile(active: boolean) {
    const model = this.model;
    this.dimensions.visible = active;
    for (const object of this.crowd) object.visible = !active;
    for (const material of this.beams) material.visible = !active;
    if (active) {
      this.scene.fog = null;
      this.bloom.strength = 0;
      this.hemi.intensity = 2.6;
      this.sun.intensity = 1.4;
      this.renderer.toneMappingExposure = 1;
      if (this.grid) (this.grid.material as THREE.Material).opacity = 0.7;
      if (this.ground) (this.ground.material as THREE.MeshStandardMaterial).color.setScalar(1);
    } else if (model) {
      this.applySettings(model);
      if (this.grid) (this.grid.material as THREE.Material).opacity = 0.16;
      if (this.ground) (this.ground.material as THREE.MeshStandardMaterial).color.setScalar(this.groundTint);
    }
  }

  /** Vue en plan orthographique : le mode de travail pour poser une implantation. */
  setPlanMode(active: boolean) {
    if (this.planMode === active) return;
    this.planMode = active;
    this.updatePlanFrustum();
    const camera = active ? this.planCamera : this.camera;
    this.controls.object = camera;
    this.gizmo.camera = camera;
    this.syncRenderCamera();
    this.applyPlanProfile(active);
    if (active) {
      this.controls.target.set(0, 0, 0);
      this.planCamera.position.set(0, 120, 0);
      this.controls.maxPolarAngle = 0;
      this.controls.minPolarAngle = 0;
    } else {
      this.controls.maxPolarAngle = Math.PI * 0.497;
      this.controls.minPolarAngle = 0;
      this.setCamera('plongee');
    }
    this.controls.update();
  }

  isPlanMode() {
    return this.planMode;
  }

  private updatePlanFrustum() {
    const model = this.model;
    if (!model) return;
    const aspect = Math.max(0.2, this.host.clientWidth / Math.max(1, this.host.clientHeight));
    const half = Math.max(model.width, model.depth) * 0.62;
    this.planCamera.left = -half * aspect;
    this.planCamera.right = half * aspect;
    this.planCamera.top = half;
    this.planCamera.bottom = -half;
    this.planCamera.updateProjectionMatrix();
  }

  screenshot(): string {
    this.composer.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  /* ----------------------------------------------------- reglages rapides */

  applySettings(model: SceneModel) {
    if (this.planMode) {
      if (this.grid) this.grid.visible = model.showGrid;
      this.setSnap(model.gridSnap);
      return;
    }
    const day = DAY[model.timeOfDay];
    this.renderer.toneMappingExposure = model.exposure * day.exposure;
    this.bloom.strength =
      model.bloom * (model.timeOfDay === 'jour' ? 0.22 : model.timeOfDay === 'crepuscule' ? 0.6 : 1);
    this.bloom.threshold = model.timeOfDay === 'nuit' ? 0.86 : 0.95;
    // Perspective aerienne : la brume prend la couleur de l'horizon du ciel,
    // legerement assombrie. Le sol lointain se fond alors dans la voute au lieu
    // de s'arreter sur une arete nette — le defaut qui trahit une maquette.
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(day.sky[2]).multiplyScalar(0.88),
      0.0026 + model.haze * 0.012,
    );
    for (const material of this.beams) material.uniforms.uHaze.value = model.haze;
    // Equilibre soleil / ciel. Un rapport proche de 1 donne une image plate et
    // sans ombres lisibles ; en exterieur reel, le soleil domine le ciel d'un
    // facteur 5 a 10. Le reglage d'ambiance module le deboucheur, pas le soleil.
    this.hemi.intensity = day.ambient * (model.timeOfDay === 'nuit' ? 0.5 : 0.18);
    this.sun.intensity = day.sun;
    this.scene.environmentIntensity = day.env * (0.55 + model.ambient * 0.9);
    if (this.grid) this.grid.visible = model.showGrid;
    this.setSnap(model.gridSnap);
    if (this.model) Object.assign(this.model, {
      exposure: model.exposure,
      bloom: model.bloom,
      haze: model.haze,
      ambient: model.ambient,
      showGrid: model.showGrid,
      gridSnap: model.gridSnap,
    });
  }

  setQuality(quality: SceneModel['quality']) {
    this.buildComposer(quality);
    this.resize();
  }

  /* ---------------------------------------------------- construction scene */

  build(model: SceneModel) {
    if (this.builtScene !== model.id) {
      this.selection = [];
      this.measurePoints = [];
    }
    this.model = structuredClone(model);
    this.beams = [];
    this.outlineOff();
    this.gizmo.detach();
    this.gizmo.getHelper().visible = false;
    this.content.clear();
    this.helpers.clear();

    for (const child of this.scene.children.filter(
      (child) => child.userData.decor === true,
    )) {
      this.scene.remove(child);
    }

    this.buildSky(model);
    this.buildGround(model);
    this.buildVenue(model);
    this.buildGrid(model);
    this.buildAudience(model);

    for (const item of model.items) this.addItem(item, model);

    this.refreshHandles();
    this.drawMeasure();
    if (this.selection.length) this.selectMany(this.selection);
    this.applySettings(model);
    this.setQuality(model.quality);
    this.updatePlanFrustum();

    // Le point de vue n'est recadre qu'au changement de scene. La geometrie est
    // rebatie a chaque deplacement d'objet ou de sommet : recadrer la aussi
    // ramenerait la camera en vue de face a chaque glisser, ce qui rend toute
    // implantation impraticable.
    const changed = this.builtScene !== model.id;
    this.builtScene = model.id;
    if (this.planMode) this.applyPlanProfile(true);
    else if (changed) this.setCamera('face');
  }

  /** (Re)construit un seul objet — evite de rebatir la scene a chaque reglage. */
  addItem(item: SceneItem, model: SceneModel) {
    const def = objectDef(item.model3d);
    const size = itemSize(item.model3d, item);
    const { object, parametric } = buildObject(item, size, {
      materials: this.materials,
      haze: model.haze,
      addBeam: (parent, color, intensity, length, spread, origin, direction) =>
        this.addBeam(parent, color, intensity, model.haze, length, spread, origin, direction),
    });
    if (!parametric) {
      object.scale.set(size[0] / def.size[0], size[1] / def.size[1], size[2] / def.size[2]);
    }
    const holder = new THREE.Group();
    holder.add(object);
    holder.position.set(item.x, item.y, item.z);
    holder.rotation.set(item.rotX, item.rotY, 0);
    holder.scale.multiplyScalar(item.scale);
    holder.userData.itemId = item.id;
    holder.userData.locked = item.locked;
    holder.userData.nominal = size;
    // Calque de famille : l'objet reste dans la scene et dans le devis, il
    // n'est simplement plus dessine. Masquer en supprimant fausserait le
    // chiffrage a chaque fois qu'on isole un corps de metier.
    holder.visible = !(model.hiddenFamilies ?? []).includes(def.family);
    this.content.add(holder);
  }

  private buildSky(model: SceneModel) {
    const day = DAY[model.timeOfDay];
    const phi = THREE.MathUtils.degToRad(90 - day.elevation);
    const theta = THREE.MathUtils.degToRad(model.sunAzimuth);
    const position = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

    // Fond : un degrade a luminance maitrisee. Le ciel physique de Preetham a
    // ete essaye ici ; sa dynamique, plusieurs ordres de grandeur au-dessus de
    // la scene, impose une exposition qui assombrit tout le reste de l'image.
    const disc = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - day.disc.elevation),
      theta,
    );
    this.scene.add(skyDome(day.sky[0], day.sky[1], day.sky[2], 900, disc, day.disc.color, day.disc.power));

    this.buildEnvironment(model, day);

    const span = Math.max(model.width, model.depth);
    this.sun.position.copy(position).multiplyScalar(span * 1.8);
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.set(day.light);
    this.hemi.color.set(model.timeOfDay === 'nuit' ? 0x2a3550 : 0xbdd7ff);
  }

  /**
   * Environnement d'eclairage indirect, construit depuis le ciel de la scene.
   *
   * Un environnement de studio d'interieur — RoomEnvironment — a ete essaye
   * ici : son irradiance, tres superieure a celle d'un ciel, deboucne les
   * ombres au point de les faire disparaitre en exterieur. On capture donc la
   * voute reelle, dome de ciel au-dessus et rebond du sol en dessous, ce qui
   * donne une lumiere d'ambiance bleutee au zenith et teintee par le terrain
   * au ras du sol, comme dans les moteurs de rendu d'architecture.
   */
  private buildEnvironment(model: SceneModel, day: DayProfile) {
    const key = `${model.timeOfDay}|${model.floorTone}|${Math.round(model.sunAzimuth / 15)}`;
    if (this.environmentKey === key && this.environmentMap) {
      this.scene.environment = this.environmentMap;
      return;
    }

    const envScene = new THREE.Scene();
    // Le halo solaire est conserve dans l'environnement — il oriente la lumiere
    // indirecte — mais attenue : le disque lui-meme est deja porte par la
    // lumiere directionnelle, le compter deux fois surexposerait la scene.
    const envSun = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - day.disc.elevation),
      THREE.MathUtils.degToRad(model.sunAzimuth),
    );
    envScene.add(skyDome(day.sky[0], day.sky[1], day.sky[2], 60, envSun, day.disc.color, day.disc.power * 0.35));
    const bounce = GROUND_BOUNCE[model.floorTone] ?? '#5a5f63';
    const floor = new THREE.Mesh(
      new THREE.SphereGeometry(58, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(bounce).multiplyScalar(day.night),
        side: THREE.BackSide,
        toneMapped: false,
      }),
    );
    envScene.add(floor);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environmentMap?.dispose();
    this.environmentMap = pmrem.fromScene(envScene, 0.03).texture;
    this.environmentKey = key;
    pmrem.dispose();
    this.scene.environment = this.environmentMap;
  }

  private buildGround(model: SceneModel) {
    const day = DAY[model.timeOfDay];

    // Un seul sol continu : une emprise plus claire que ses abords donnerait
    // l'impression d'un tapis pose sur le terrain. Le contour suffit a la lire.
    const size = Math.max(model.width, model.depth) * 14 + 400;
    const surroundings = groundMaterial(model.floorTone, '#ffffff', day.night, size);
    const around = new THREE.Mesh(new THREE.PlaneGeometry(size, size), surroundings);
    around.rotation.x = -Math.PI / 2;
    around.receiveShadow = true;
    around.userData.decor = true;
    this.scene.add(around);

    // L'emprise elle-meme, a la forme choisie.
    const points = groundOutline(model);
    const shape = new THREE.Shape(points);
    // ShapeGeometry emet des UV en coordonnees monde : une unite d'UV vaut un metre.
    const material = groundMaterial(model.floorTone, '#ffffff', day.night, 1);
    const plot = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), material);
    plot.rotation.x = -Math.PI / 2;
    plot.position.y = 0.004;
    plot.receiveShadow = true;
    plot.userData.decor = true;
    this.ground = plot;
    this.groundTint = day.night;
    this.scene.add(plot);

    // La camera d'ombre est ajustee a l'emprise reelle : une boite trop large
    // gaspille la resolution et bouche les contacts au sol.
    this.fitShadowCamera(model);

    this.buildZones(model, day);
    this.buildDimensions(model);

    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, 0.05, point.y))),
      new THREE.LineBasicMaterial({ color: 0x8fb0d8, transparent: true, opacity: this.planMode ? 0.9 : 0.22 }),
    );
    this.outlineLine = outline;
    this.helpers.add(outline);
  }

  /** Cotes du terrain, facon plan technique. */
  private buildDimensions(model: SceneModel) {
    this.dimensions.clear();
    const line = new THREE.LineBasicMaterial({ color: 0x9fb4cc });
    const half = { w: model.width / 2, d: model.depth / 2 };
    const margin = Math.max(1.2, Math.min(model.width, model.depth) * 0.06);

    const segments: [THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(-half.w, 0.05, -half.d - margin), new THREE.Vector3(half.w, 0.05, -half.d - margin)],
      [new THREE.Vector3(-half.w, 0.05, -half.d - margin * 1.3), new THREE.Vector3(-half.w, 0.05, -half.d - margin * 0.7)],
      [new THREE.Vector3(half.w, 0.05, -half.d - margin * 1.3), new THREE.Vector3(half.w, 0.05, -half.d - margin * 0.7)],
      [new THREE.Vector3(-half.w - margin, 0.05, -half.d), new THREE.Vector3(-half.w - margin, 0.05, half.d)],
      [new THREE.Vector3(-half.w - margin * 1.3, 0.05, -half.d), new THREE.Vector3(-half.w - margin * 0.7, 0.05, -half.d)],
      [new THREE.Vector3(-half.w - margin * 1.3, 0.05, half.d), new THREE.Vector3(-half.w - margin * 0.7, 0.05, half.d)],
    ];
    for (const [from, to] of segments) {
      this.dimensions.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), line));
    }

    const scale = Math.max(model.width, model.depth) * 0.055;
    this.dimensions.add(textSprite(`${model.width} m`, new THREE.Vector3(0, 0.1, -half.d - margin * 1.9), scale));
    this.dimensions.add(textSprite(`${model.depth} m`, new THREE.Vector3(-half.w - margin * 2.1, 0.1, 0), scale));
    this.dimensions.add(
      textSprite(`${Math.round(groundArea(model))} m²`, new THREE.Vector3(half.w - scale * 1.4, 0.1, half.d + margin), scale * 0.8),
    );
  }

  /**
   * Surfaces dessinees a l'interieur du terrain.
   * Une zone posee au sol est une simple decoupe ; des qu'elle a une hauteur,
   * elle est extrudee et prend une joue laterale, comme un plancher monte.
   */
  private buildZones(model: SceneModel, day: DayProfile) {
    for (const zone of model.zones) {
      if (!zone.visible || zone.polygon.length < 3) continue;
      const shape = new THREE.Shape(zone.polygon.map((point) => new THREE.Vector2(point.x, point.z)));
      const material = groundMaterial(zone.ground, '#ffffff', day.night, 1);

      if (zone.elevation > 0.01) {
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: zone.elevation, bevelEnabled: false });
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, zone.elevation, 0);
        const solid = new THREE.Mesh(geometry, material);
        solid.castShadow = true;
        solid.receiveShadow = true;
        solid.userData.decor = true;
        this.scene.add(solid);
      } else {
        const flat = new THREE.Mesh(new THREE.ShapeGeometry(shape, 20), material);
        flat.rotation.x = -Math.PI / 2;
        flat.position.y = 0.012;
        flat.receiveShadow = true;
        flat.userData.decor = true;
        this.scene.add(flat);
      }

      const border = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          zone.polygon.map((point) => new THREE.Vector3(point.x, zone.elevation + 0.02, point.z)),
        ),
        new THREE.LineBasicMaterial({ color: 0xc8d6e6, transparent: true, opacity: this.planMode ? 0.7 : 0.18 }),
      );
      this.helpers.add(border);
    }
  }

  /** Cadre l'ombre portee sur l'emprise du site, marge comprise. */
  private fitShadowCamera(model: SceneModel) {
    const span = Math.max(model.width, model.depth) * 0.62 + 6;
    const camera = this.sun.shadow.camera;
    camera.left = -span;
    camera.right = span;
    camera.top = span;
    camera.bottom = -span;
    camera.near = 1;
    camera.far = Math.max(model.width, model.depth) * 6;
    camera.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
  }

  private buildVenue(model: SceneModel) {
    if (model.venueType === 'plein-air') return;
    if (model.groundShape !== 'rectangle') return;
    const { width, depth, height } = model;
    const wall = new THREE.MeshStandardMaterial({
      color: new THREE.Color(model.wallTone),
      roughness: 0.92,
      metalness: 0.02,
      side: THREE.BackSide,
    });
    const room = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wall);
    room.position.y = height / 2;
    room.receiveShadow = true;
    room.userData.decor = true;
    this.scene.add(room);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(model.wallTone).multiplyScalar(0.7), roughness: 0.95 }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height - 0.02;
    ceiling.userData.decor = true;
    this.scene.add(ceiling);
  }

  private buildGrid(model: SceneModel) {
    const span = Math.ceil(Math.max(model.width, model.depth) / 2) * 2 + 8;
    const grid = new THREE.GridHelper(span, span, 0x51637a, 0x2c3948);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = this.planMode ? 0.7 : model.timeOfDay === 'nuit' ? 0.07 : 0.14;
    grid.position.y = 0.005;
    grid.visible = model.showGrid;
    this.grid = grid;
    this.helpers.add(grid);
  }

  /**
   * Foule d'ambiance.
   *
   * Des capsules alignees se voient immediatement : on instancie une
   * silhouette complete — jambes, torse, bras, tete — avec une couleur de
   * vetement par personne et une orientation vers la scene. La foule n'est
   * generee que si la scene n'a pas deja son propre public assis.
   */
  private buildAudience(model: SceneModel) {
    this.crowd = [];
    const seats = model.items.filter((item) =>
      ['chair', 'chaise-napoleon', 'seating-block', 'table-brasserie', 'banc-brasserie', 'table-round'].includes(
        item.model3d,
      ),
    ).length;
    if (seats > 3) return;

    const count = Math.min(600, Math.round(model.audience / 3));
    if (count < 6) return;

    const geometry = crowdGeometry();
    const mesh = new THREE.InstancedMesh(geometry, this.materials.foule, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const color = new THREE.Color();
    const zStart = model.depth * 0.06;
    const zEnd = model.depth * 0.46;

    for (let index = 0; index < count; index += 1) {
      const x = (Math.random() - 0.5) * model.width * 0.8;
      const z = zStart + Math.random() * (zEnd - zStart);
      const size = 0.92 + Math.random() * 0.16;
      position.set(x, 0, z);
      // Tout le monde regarde la scene, a un quart de tour pres.
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI + (Math.random() - 0.5) * 0.9);
      scale.set(size, size, size);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      // Palette de vetements reelle plutot qu'une teinte aleatoire : une teinte
      // tiree au hasard sur tout le cercle chromatique donne une foule mauve et
      // turquoise qu'on ne voit sur aucun terrain.
      color.set(CROWD_PALETTE[Math.floor(Math.random() * CROWD_PALETTE.length)]);
      color.multiplyScalar(0.86 + Math.random() * 0.28);
      mesh.setColorAt(index, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.decor = true;
    this.crowd = [mesh];
    this.scene.add(mesh);
  }

  private addBeam(
    parent: THREE.Object3D,
    color: string,
    intensity: number,
    haze: number,
    length: number,
    spread: number,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
  ) {
    if (intensity <= 0.01) return;
    const cone = new THREE.ConeGeometry(spread, length, 22, 1, true);
    cone.translate(0, -length / 2, 0);
    const material = beamMaterial(color, intensity, haze);
    material.userData.base = intensity;
    material.userData.phase = Math.random() * 6.28;
    this.beams.push(material);
    const beam = new THREE.Mesh(cone, material);
    beam.position.copy(origin);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction.clone().normalize());
    parent.add(beam);

    const spot = new THREE.SpotLight(new THREE.Color(color), intensity * 38, length * 1.4, 0.34, 0.6, 1.4);
    spot.position.copy(origin);
    const target = new THREE.Object3D();
    target.position.copy(origin.clone().add(direction.clone().multiplyScalar(length)));
    parent.add(target);
    spot.target = target;
    parent.add(spot);
  }
}

/** Axe vertical, reutilise a chaque rotation de groupe. */
const UP = new THREE.Vector3(0, 1, 0);

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Etiquette de cote : un texte plat, lisible depuis n'importe quel angle.
 *
 * `screen` fige la taille en pixels au lieu de la lier au monde : une cote
 * doit rester lisible quand on s'eloigne, alors qu'une cote de terrain doit
 * rester a l'echelle du plan.
 */
function textSprite(
  text: string,
  position: THREE.Vector3,
  scale: number,
  options: { screen?: boolean; tint?: string } = {},
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(12,16,22,0.86)';
  ctx.roundRect(4, 8, 248, 48, 10);
  ctx.fill();
  ctx.fillStyle = options.tint ?? '#e6edf6';
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
      toneMapped: false,
      sizeAttenuation: !options.screen,
    }),
  );
  sprite.position.copy(position);
  sprite.scale.set(scale * 4, scale, 1);
  return sprite;
}

/**
 * Voute de fond a trois arrets : zenith, ciel median, horizon.
 * Un degrade a deux couleurs donne un ciel plat ; c'est la bande claire pres
 * de l'horizon qui cree la profondeur et pose la ligne de sol. Le disque
 * solaire et son halo sont dessines dans le meme shader : sans eux, une image
 * exterieure n'a pas de source visible et le regard ne sait pas d'ou vient
 * la lumiere.
 */
export function skyDome(
  zenith: string,
  middle: string,
  horizon: string,
  radius: number,
  sun?: THREE.Vector3,
  sunColor = '#fff3d8',
  sunPower = 1,
): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(zenith) },
      uMiddle: { value: new THREE.Color(middle) },
      uHorizon: { value: new THREE.Color(horizon) },
      uSun: { value: sun ? sun.clone().normalize() : new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(sunColor) },
      uSunPower: { value: sun ? sunPower : 0 },
    },
    vertexShader: `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uMiddle;
      uniform vec3 uHorizon;
      uniform vec3 uSun;
      uniform vec3 uSunColor;
      uniform float uSunPower;
      varying vec3 vPosition;
      void main() {
        vec3 dir = normalize(vPosition);
        float h = dir.y;
        // Sous l'horizon, le ciel s'assombrit : le sol ne se decoupe plus sur
        // une bande claire quand la camera plonge.
        vec3 color = h < 0.0
          ? mix(uHorizon * 0.45, uHorizon, clamp(h * 6.0 + 1.0, 0.0, 1.0))
          : (h < 0.28
              ? mix(uHorizon, uMiddle, smoothstep(0.0, 0.28, h))
              : mix(uMiddle, uZenith, smoothstep(0.28, 0.9, h)));

        if (uSunPower > 0.0) {
          float cosA = clamp(dot(dir, uSun), -1.0, 1.0);
          // Diffusion de Mie : le halo large qui blanchit le ciel autour du
          // soleil, puis le disque lui-meme, net et sature.
          float halo = pow(max(cosA, 0.0), 220.0) * 0.55 + pow(max(cosA, 0.0), 12.0) * 0.16;
          float disc = smoothstep(0.99955, 0.99975, cosA);
          color += uSunColor * halo * uSunPower;
          color = mix(color, uSunColor * 2.4, disc * clamp(uSunPower, 0.0, 1.0));
        }

        // Brume d'horizon : l'air epaissit la derniere bande avant le sol.
        float haze = pow(1.0 - clamp(abs(h) * 5.5, 0.0, 1.0), 2.0);
        color = mix(color, uHorizon * 1.06, haze * 0.35);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 40), material);
  dome.name = 'sky';
  dome.userData.decor = true;
  return dome;
}

/**
 * Silhouette humaine instanciee : jambes, torse, bras et tete.
 * Une capsule suffit a donner l'echelle, pas a faire une image credible ;
 * quatre volumes de plus suffisent a lire une foule.
 */
function crowdGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const torso = new THREE.CapsuleGeometry(0.16, 0.44, 4, 10);
  torso.scale(1, 1, 0.72);
  torso.translate(0, 1.06, 0);
  parts.push(torso);

  const head = new THREE.SphereGeometry(0.105, 12, 10);
  head.translate(0, 1.5, 0);
  parts.push(head);

  const neck = new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8);
  neck.translate(0, 1.4, 0);
  parts.push(neck);

  for (const side of [-1, 1]) {
    const arm = new THREE.CapsuleGeometry(0.052, 0.44, 4, 8);
    arm.rotateZ(side * 0.09);
    arm.translate(side * 0.2, 1.05, 0);
    parts.push(arm);

    const leg = new THREE.CapsuleGeometry(0.075, 0.6, 4, 8);
    leg.translate(side * 0.085, 0.46, 0);
    parts.push(leg);

    const shoe = new THREE.BoxGeometry(0.09, 0.055, 0.22);
    shoe.translate(side * 0.085, 0.03, 0.03);
    parts.push(shoe);
  }

  return mergeGeometries(parts, false) ?? new THREE.CapsuleGeometry(0.17, 0.86, 4, 8);
}
