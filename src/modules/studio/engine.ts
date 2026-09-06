/**
 * Moteur de rendu du Studio 3D.
 *
 * Objectif : donner au client une image credible de ce qu'il loue ou achete.
 * On s'appuie sur un pipeline PBR complet — environnement IBL, tone mapping
 * ACES filmique, ombres douces, bloom selectif et faisceaux volumetriques
 * dans le brouillard — plutot que sur des maquettes symboliques.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Scene as SceneModel, SceneItem } from '../../core/types';

export type CameraPreset = 'public' | 'face' | 'plongee' | 'scene' | 'laterale';

const SKY: Record<SceneModel['timeOfDay'], { top: string; bottom: string; light: number }> = {
  jour: { top: '#8fb6dd', bottom: '#d9e3ec', light: 2.2 },
  crepuscule: { top: '#2b3b5c', bottom: '#8a5a4a', light: 0.85 },
  nuit: { top: '#070a10', bottom: '#131a26', light: 0.16 },
};

/* ------------------------------------------------------- materiaux partages */

function makeMaterials() {
  const grilleTexture = grille();
  return {
    caisson: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.62, metalness: 0.12 }),
    grille: new THREE.MeshStandardMaterial({
      color: 0x0c0e12,
      roughness: 0.85,
      metalness: 0.35,
      map: grilleTexture,
      bumpMap: grilleTexture,
      bumpScale: 0.4,
    }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.34, metalness: 0.92 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.42, metalness: 0.88 }),
    noirMat: new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 0.78, metalness: 0.06 }),
    plastique: new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.48, metalness: 0.05 }),
    bois: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.66, metalness: 0 }),
    nappe: new THREE.MeshStandardMaterial({ color: 0xe8e3d8, roughness: 0.92, metalness: 0 }),
    verre: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.86,
      thickness: 0.4,
      ior: 1.45,
    }),
    lentille: new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.18, metalness: 0.5 }),
    foule: new THREE.MeshStandardMaterial({ color: 0x1c2029, roughness: 0.92, metalness: 0 }),
  };
}

/** Texture procedurale de grille de haut-parleur : evite tout asset externe. */
function grille(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#22262d';
  for (let y = 2; y < size; y += 5) {
    for (let x = 2; x < size; x += 5) {
      ctx.beginPath();
      ctx.arc(x + ((y / 5) % 2) * 2.5, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Sol : bruit fin pour casser l'uniformite et accrocher la lumiere. */
function floorTexture(tone: string): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = tone;
  ctx.fillRect(0, 0, size, size);
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 26;
    image.data[i] = Math.max(0, Math.min(255, image.data[i] + noise));
    image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1] + noise));
    image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2] + noise));
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(14, 14);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Contenu du mur LED : degrade anime, suffisant pour lire l'implantation. */
function ledContent(): THREE.CanvasTexture {
  const w = 512;
  const h = 288;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, '#123a7a');
  gradient.addColorStop(0.5, '#2f7ad0');
  gradient.addColorStop(1, '#7a3fa8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#000';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

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

/* ------------------------------------------------------------- geometries */

const CACHE = new Map<string, THREE.BufferGeometry>();
function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geometry = CACHE.get(key);
  if (!geometry) {
    geometry = build();
    CACHE.set(key, geometry);
  }
  return geometry;
}

function trussGeometry(length: number, vertical: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const side = 0.29;
  const tube = 0.024;
  const offsets = [
    [-side / 2, -side / 2],
    [side / 2, -side / 2],
    [-side / 2, side / 2],
    [side / 2, side / 2],
  ];
  for (const [a, b] of offsets) {
    const chord = new THREE.CylinderGeometry(tube, tube, length, 8);
    if (vertical) chord.translate(a, 0, b);
    else {
      chord.rotateZ(Math.PI / 2);
      chord.translate(0, a, b);
    }
    parts.push(chord);
  }
  const braceCount = Math.max(2, Math.round(length / 0.5));
  for (let i = 0; i < braceCount; i += 1) {
    const t = -length / 2 + (length / braceCount) * (i + 0.5);
    for (const axis of [0, 1]) {
      const brace = new THREE.CylinderGeometry(tube * 0.62, tube * 0.62, side * 1.42, 6);
      brace.rotateZ(Math.PI / 4);
      if (axis === 1) brace.rotateY(Math.PI / 2);
      if (vertical) brace.translate(0, t, axis === 0 ? side / 2 : -side / 2);
      else {
        brace.rotateZ(Math.PI / 2);
        brace.rotateX(Math.PI / 2);
        brace.translate(t, axis === 0 ? side / 2 : -side / 2, 0);
      }
      parts.push(brace);
    }
  }
  return mergeGeometries(parts, false) ?? new THREE.BoxGeometry(length, side, side);
}

function chairGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const seat = new THREE.BoxGeometry(0.46, 0.06, 0.44);
  seat.translate(0, 0.45, 0);
  parts.push(seat);
  const back = new THREE.BoxGeometry(0.46, 0.44, 0.05);
  back.translate(0, 0.68, -0.2);
  parts.push(back);
  for (const [x, z] of [
    [-0.2, -0.18],
    [0.2, -0.18],
    [-0.2, 0.18],
    [0.2, 0.18],
  ]) {
    const leg = new THREE.CylinderGeometry(0.018, 0.018, 0.45, 6);
    leg.translate(x, 0.225, z);
    parts.push(leg);
  }
  return mergeGeometries(parts, false) ?? new THREE.BoxGeometry(0.46, 0.9, 0.44);
}

/* --------------------------------------------------------------- le moteur */

export interface StudioStats {
  objets: number;
  projecteurs: number;
  puissanceW: number;
  poidsKg: number;
}

export class StudioEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private materials = makeMaterials();
  private content = new THREE.Group();
  private beams: THREE.ShaderMaterial[] = [];
  private clock = new THREE.Clock();
  private frame = 0;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private selection: THREE.Box3Helper | null = null;
  private model: SceneModel | null = null;
  private disposed = false;
  private ledMaterials: THREE.MeshStandardMaterial[] = [];

  onSelect: ((itemId: string | null) => void) | null = null;

  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(46, host.clientWidth / host.clientHeight, 0.1, 400);
    this.camera.position.set(0, 6, 22);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 90;
    this.controls.target.set(0, 2.2, 0);

    // Environnement IBL : indispensable pour que le metal et le plastique
    // reagissent de maniere credible, meme sans lumiere directe.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(host.clientWidth, host.clientHeight),
      0.55,
      0.38,
      0.9,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.scene.add(this.content);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointer);
    window.addEventListener('resize', this.resize);
    this.loop();
  }

  /* ---------------------------------------------------------- cycle de vie */

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const time = this.clock.getElapsedTime();
    for (const material of this.beams) {
      // Leger scintillement : le brouillard n'est jamais parfaitement stable.
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
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointer);
    this.controls.dispose();
    this.renderer.dispose();
    if (this.host.contains(this.renderer.domElement)) this.host.removeChild(this.renderer.domElement);
  }

  /* -------------------------------------------------------------- selection */

  private handlePointer = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const box = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
    this.pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.content.children, true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.itemId) node = node.parent;
      if (node?.userData.itemId) {
        this.highlight(node);
        this.onSelect?.(node.userData.itemId as string);
        return;
      }
    }
    this.highlight(null);
    this.onSelect?.(null);
  };

  selectById(itemId: string | null) {
    if (!itemId) return this.highlight(null);
    const node = this.content.children.find((child) => child.userData.itemId === itemId) ?? null;
    this.highlight(node);
  }

  private highlight(node: THREE.Object3D | null) {
    if (this.selection) {
      this.scene.remove(this.selection);
      this.selection.geometry.dispose();
      this.selection = null;
    }
    if (!node) return;
    const box = new THREE.Box3().setFromObject(node).expandByScalar(0.08);
    this.selection = new THREE.Box3Helper(box, new THREE.Color('#3987e5'));
    this.scene.add(this.selection);
  }

  /* ------------------------------------------------------------- cadrages */

  setCamera(preset: CameraPreset) {
    const model = this.model;
    if (!model) return;
    const depth = model.depth;
    const width = model.width;
    const targets: Record<CameraPreset, [THREE.Vector3, THREE.Vector3]> = {
      public: [new THREE.Vector3(0, 1.7, depth * 0.42), new THREE.Vector3(0, 3, -depth * 0.2)],
      face: [new THREE.Vector3(0, 4.5, depth * 0.62), new THREE.Vector3(0, 3.4, -depth * 0.18)],
      plongee: [
        new THREE.Vector3(
          width * 0.45,
          model.venueType === 'plein-air' ? model.height * 1.5 : model.height * 0.82,
          depth * 0.55,
        ),
        new THREE.Vector3(0, 1.5, -depth * 0.1),
      ],
      scene: [new THREE.Vector3(-width * 0.16, 2.2, -depth * 0.32), new THREE.Vector3(0, 2.2, depth * 0.3)],
      laterale: [new THREE.Vector3(-width * 0.55, 3.2, depth * 0.1), new THREE.Vector3(0, 3, -depth * 0.2)],
    };
    const [position, target] = targets[preset];
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.controls.update();
  }

  screenshot(): string {
    this.composer.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  stats(): StudioStats {
    return {
      objets: this.model?.items.length ?? 0,
      projecteurs: this.beams.length,
      puissanceW: 0,
      poidsKg: 0,
    };
  }

  /* ------------------------------------------------------- reglages rapides */

  applySettings(model: SceneModel) {
    this.renderer.toneMappingExposure = model.exposure;
    this.bloom.strength = model.bloom;
    const sky = SKY[model.timeOfDay];
    this.scene.fog = new THREE.FogExp2(new THREE.Color(sky.top), 0.0018 + model.haze * 0.013);
    for (const material of this.beams) material.uniforms.uHaze.value = model.haze;
    const ambient = this.scene.getObjectByName('ambient') as THREE.HemisphereLight | undefined;
    if (ambient) ambient.intensity = model.ambient * 2.4 + sky.light * 0.25;
    if (this.model) {
      this.model.exposure = model.exposure;
      this.model.bloom = model.bloom;
      this.model.haze = model.haze;
      this.model.ambient = model.ambient;
    }
  }

  /* ------------------------------------------------------ construction scene */

  build(model: SceneModel) {
    this.model = structuredClone(model);
    this.beams = [];
    this.ledMaterials = [];
    this.highlight(null);
    this.content.clear();
    // Copie explicite : `remove` mute la liste que l'on parcourt.
    const stale = this.scene.children.filter((child) => child !== this.content);
    for (const child of stale) this.scene.remove(child);

    const sky = SKY[model.timeOfDay];
    this.scene.background = null;
    this.scene.add(skyDome(sky.top, sky.bottom, Math.max(model.width, model.depth) * 6));

    const hemi = new THREE.HemisphereLight(new THREE.Color(sky.top), new THREE.Color(model.floorTone), 1);
    hemi.name = 'ambient';
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, model.timeOfDay === 'jour' ? 2.4 : 0.35);
    key.position.set(model.width * 0.4, model.height * 2.2, model.depth * 0.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 160;
    const span = Math.max(model.width, model.depth) * 0.8;
    key.shadow.camera.left = -span;
    key.shadow.camera.right = span;
    key.shadow.camera.top = span;
    key.shadow.camera.bottom = -span;
    key.shadow.bias = -0.0006;
    this.scene.add(key);

    this.buildVenue(model);
    this.buildAudience(model);

    for (const item of model.items) {
      const object = this.buildItem(item, model);
      if (!object) continue;
      object.userData.itemId = item.id;
      object.position.set(item.x, item.y, item.z);
      object.rotation.y = item.rotY;
      object.scale.setScalar(item.scale);
      this.content.add(object);
    }

    this.applySettings(model);
    this.setCamera('face');
  }

  private buildVenue(model: SceneModel) {
    const { width, depth, height } = model;
    const floorMaterial = new THREE.MeshStandardMaterial({
      map: floorTexture(model.floorTone),
      roughness: model.venueType === 'club' ? 0.35 : 0.78,
      metalness: 0.06,
      color: new THREE.Color(0xffffff).multiplyScalar(
        model.timeOfDay === 'jour' ? 1 : model.timeOfDay === 'crepuscule' ? 0.6 : 0.34,
      ),
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width * 2.6, depth * 2.6), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    if (model.venueType === 'plein-air') return;

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(model.wallTone),
      roughness: 0.92,
      metalness: 0.02,
      side: THREE.BackSide,
    });
    const room = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMaterial);
    room.position.y = height / 2;
    room.receiveShadow = true;
    this.scene.add(room);

    // Retombee de plafond : une salle sans plafond marque mal a la camera.
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(model.wallTone).multiplyScalar(0.7), roughness: 0.95 }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height - 0.02;
    this.scene.add(ceiling);
  }

  /** Foule instanciee : donne l'echelle, condition d'un rendu credible. */
  private buildAudience(model: SceneModel) {
    // Une salle equipee de sieges represente deja son public : superposer une
    // foule debout donnerait deux jauges dans la meme image.
    const seated = model.items.some((item) => item.model3d === 'chair' || item.model3d === 'seating-block');
    if (seated) return;
    // Avec des tables, seul le devant de scene reste debout.
    const banquet = model.items.some((item) => item.model3d === 'table-round');
    const count = Math.min(900, Math.round(model.audience / (banquet ? 8 : 3)));
    if (count < 6) return;
    const body = new THREE.CapsuleGeometry(0.17, 0.86, 4, 8);
    body.translate(0, 0.78, 0);
    const head = new THREE.SphereGeometry(0.115, 10, 8);
    head.translate(0, 1.44, 0);
    const geometry = mergeGeometries([body, head], false) ?? body;
    const mesh = new THREE.InstancedMesh(geometry, this.materials.foule, count);
    mesh.castShadow = true;
    const matrix = new THREE.Matrix4();
    const zStart = model.depth * 0.06;
    const zEnd = model.depth * (banquet ? 0.18 : 0.48);
    for (let index = 0; index < count; index += 1) {
      const x = (Math.random() - 0.5) * model.width * 0.82;
      const z = zStart + Math.random() * (zEnd - zStart);
      const scale = 0.93 + Math.random() * 0.16;
      matrix.makeRotationY(Math.random() * 0.5 - 0.25);
      matrix.scale(new THREE.Vector3(scale, scale, scale));
      matrix.setPosition(x, 0, z);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
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
    const geometry = cached(`beam_${length}_${spread}`, () => {
      const cone = new THREE.ConeGeometry(spread, length, 22, 1, true);
      cone.translate(0, -length / 2, 0);
      return cone;
    });
    const material = beamMaterial(color, intensity, haze);
    material.userData.base = intensity;
    material.userData.phase = Math.random() * 6.28;
    this.beams.push(material);
    const beam = new THREE.Mesh(geometry, material);
    beam.position.copy(origin);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction.clone().normalize());
    parent.add(beam);

    const spot = new THREE.SpotLight(new THREE.Color(color), intensity * 42, length * 1.4, 0.34, 0.6, 1.4);
    spot.position.copy(origin);
    const target = new THREE.Object3D();
    target.position.copy(origin.clone().add(direction.clone().multiplyScalar(length)));
    parent.add(target);
    spot.target = target;
    parent.add(spot);
  }

  /* --------------------------------------------------------- objets 3D */

  private buildItem(item: SceneItem, model: SceneModel): THREE.Object3D | null {
    const group = new THREE.Group();
    const m = this.materials;
    const shadowed = (mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    switch (item.model3d) {
      case 'line-array': {
        const body = shadowed(new THREE.Mesh(cached('la_body', () => new THREE.BoxGeometry(0.72, 0.26, 0.44)), m.caisson));
        group.add(body);
        const front = new THREE.Mesh(cached('la_front', () => new THREE.PlaneGeometry(0.68, 0.22)), m.grille);
        front.position.z = 0.221;
        group.add(front);
        for (const side of [-1, 1]) {
          const ear = shadowed(new THREE.Mesh(cached('la_ear', () => new THREE.BoxGeometry(0.03, 0.3, 0.46)), m.alu));
          ear.position.x = side * 0.375;
          group.add(ear);
        }
        break;
      }
      case 'sub': {
        const body = shadowed(new THREE.Mesh(cached('sub_body', () => new THREE.BoxGeometry(0.62, 0.6, 0.78)), m.caisson));
        body.position.y = 0.3;
        group.add(body);
        const front = new THREE.Mesh(cached('sub_front', () => new THREE.PlaneGeometry(0.56, 0.54)), m.grille);
        front.position.set(0, 0.3, 0.392);
        group.add(front);
        break;
      }
      case 'top-speaker': {
        const body = shadowed(new THREE.Mesh(cached('top_body', () => new THREE.BoxGeometry(0.34, 0.52, 0.33)), m.caisson));
        body.position.y = 0.26;
        group.add(body);
        const front = new THREE.Mesh(cached('top_front', () => new THREE.PlaneGeometry(0.3, 0.48)), m.grille);
        front.position.set(0, 0.26, 0.166);
        group.add(front);
        const pole = shadowed(new THREE.Mesh(cached('top_pole', () => new THREE.CylinderGeometry(0.024, 0.024, 2, 8)), m.metal));
        pole.position.y = -0.75;
        group.add(pole);
        break;
      }
      case 'monitor': {
        const wedge = shadowed(new THREE.Mesh(cached('mon_body', () => new THREE.BoxGeometry(0.56, 0.34, 0.44)), m.caisson));
        wedge.rotation.x = -0.62;
        wedge.position.y = 0.18;
        group.add(wedge);
        const front = new THREE.Mesh(cached('mon_front', () => new THREE.PlaneGeometry(0.5, 0.28)), m.grille);
        front.rotation.x = -0.62;
        front.position.set(0, 0.28, 0.16);
        group.add(front);
        break;
      }
      case 'console': {
        const desk = shadowed(new THREE.Mesh(cached('cons_desk', () => new THREE.BoxGeometry(1.5, 0.75, 0.8)), m.noirMat));
        desk.position.y = 0.375;
        group.add(desk);
        const top = shadowed(new THREE.Mesh(cached('cons_top', () => new THREE.BoxGeometry(1.42, 0.09, 0.72)), m.plastique));
        top.position.y = 0.79;
        top.rotation.x = -0.14;
        group.add(top);
        const screens = new THREE.Mesh(
          cached('cons_screen', () => new THREE.PlaneGeometry(0.5, 0.28)),
          new THREE.MeshStandardMaterial({ color: 0x0d1a2c, emissive: new THREE.Color('#2b6fc4'), emissiveIntensity: 1.4, roughness: 0.3 }),
        );
        screens.position.set(0, 0.98, -0.16);
        screens.rotation.x = -0.34;
        group.add(screens);
        break;
      }
      case 'dj-booth': {
        const table = shadowed(new THREE.Mesh(cached('dj_table', () => new THREE.BoxGeometry(1.7, 0.95, 0.62)), m.noirMat));
        table.position.y = 0.475;
        group.add(table);
        for (const x of [-0.55, 0.55]) {
          const player = shadowed(new THREE.Mesh(cached('dj_player', () => new THREE.BoxGeometry(0.42, 0.07, 0.46)), m.plastique));
          player.position.set(x, 0.99, 0);
          group.add(player);
          const platter = new THREE.Mesh(cached('dj_platter', () => new THREE.CylinderGeometry(0.13, 0.13, 0.02, 24)), m.alu);
          platter.position.set(x, 1.04, 0);
          group.add(platter);
        }
        const mixer = shadowed(new THREE.Mesh(cached('dj_mixer', () => new THREE.BoxGeometry(0.38, 0.08, 0.44)), m.plastique));
        mixer.position.y = 0.99;
        group.add(mixer);
        break;
      }
      case 'moving-head': {
        const base = shadowed(new THREE.Mesh(cached('mh_base', () => new THREE.BoxGeometry(0.34, 0.14, 0.34)), m.noirMat));
        group.add(base);
        for (const side of [-1, 1]) {
          const arm = shadowed(new THREE.Mesh(cached('mh_arm', () => new THREE.BoxGeometry(0.07, 0.4, 0.2)), m.plastique));
          arm.position.set(side * 0.15, -0.24, 0);
          group.add(arm);
        }
        const head = shadowed(new THREE.Mesh(cached('mh_head', () => new THREE.CylinderGeometry(0.13, 0.15, 0.36, 18)), m.plastique));
        head.position.y = -0.42;
        head.rotation.x = Math.PI;
        group.add(head);
        const lens = new THREE.Mesh(
          cached('mh_lens', () => new THREE.CircleGeometry(0.115, 20)),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(item.color),
            emissive: new THREE.Color(item.color),
            emissiveIntensity: item.beam > 0 ? 3.4 : 0,
            roughness: 0.16,
          }),
        );
        lens.position.y = -0.605;
        lens.rotation.x = Math.PI / 2;
        group.add(lens);
        const toward = new THREE.Vector3(-item.x * 0.25, -1, -item.z * 0.18 - 1.4).normalize();
        this.addBeam(group, item.color, item.beam, model.haze, Math.max(6, item.y + 3), 1.5, new THREE.Vector3(0, -0.6, 0), toward);
        break;
      }
      case 'par-led': {
        const body = shadowed(new THREE.Mesh(cached('par_body', () => new THREE.CylinderGeometry(0.13, 0.15, 0.3, 20)), m.noirMat));
        body.rotation.x = Math.PI / 2.6;
        group.add(body);
        const lens = new THREE.Mesh(
          cached('par_lens', () => new THREE.CircleGeometry(0.115, 20)),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(item.color),
            emissive: new THREE.Color(item.color),
            emissiveIntensity: item.beam > 0 ? 3.8 : 0,
            roughness: 0.2,
          }),
        );
        lens.position.set(0, 0.11, 0.12);
        lens.rotation.x = Math.PI / 2.6 - Math.PI / 2;
        group.add(lens);
        const yoke = shadowed(new THREE.Mesh(cached('par_yoke', () => new THREE.BoxGeometry(0.3, 0.02, 0.02)), m.metal));
        yoke.position.y = -0.14;
        group.add(yoke);
        this.addBeam(
          group,
          item.color,
          item.beam * 0.85,
          model.haze,
          6,
          1.9,
          new THREE.Vector3(0, 0.1, 0.12),
          new THREE.Vector3(0, item.y > 2 ? -1 : 0.3, item.z < 0 ? 1 : -1).normalize(),
        );
        break;
      }
      case 'blinder': {
        const body = shadowed(new THREE.Mesh(cached('bl_body', () => new THREE.BoxGeometry(0.72, 0.4, 0.22)), m.noirMat));
        group.add(body);
        const lampMaterial = new THREE.MeshStandardMaterial({
          color: 0xfff0d0,
          emissive: new THREE.Color('#ffd9a0'),
          emissiveIntensity: item.beam > 0 ? 5 : 0,
          roughness: 0.25,
        });
        for (let index = 0; index < 8; index += 1) {
          const lamp = new THREE.Mesh(cached('bl_lamp', () => new THREE.CircleGeometry(0.075, 16)), lampMaterial);
          lamp.position.set(-0.27 + (index % 4) * 0.18, index < 4 ? 0.09 : -0.09, 0.112);
          group.add(lamp);
        }
        this.addBeam(group, '#ffd9a0', item.beam * 0.7, model.haze, 8, 3.2, new THREE.Vector3(0, 0, 0.12), new THREE.Vector3(0, -0.35, 1).normalize());
        break;
      }
      case 'led-wall': {
        const cols = Math.max(2, Math.round(Math.sqrt(item.qty * 2)));
        const rows = Math.max(2, Math.ceil(item.qty / cols));
        const width = cols * 0.5;
        const height = rows * 0.5;
        const frame = shadowed(new THREE.Mesh(new THREE.BoxGeometry(width + 0.06, height + 0.06, 0.12), m.noirMat));
        group.add(frame);
        const screenMaterial = new THREE.MeshStandardMaterial({
          map: ledContent(),
          emissiveMap: ledContent(),
          emissive: new THREE.Color(0xffffff),
          emissiveIntensity: 1.15,
          roughness: 0.42,
          metalness: 0,
        });
        this.ledMaterials.push(screenMaterial);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), screenMaterial);
        screen.position.z = 0.062;
        group.add(screen);
        const glow = new THREE.RectAreaLight(0x6f9fe0, 1.5, width, height);
        glow.position.z = 0.1;
        group.add(glow);
        break;
      }
      case 'truss': {
        const mesh = shadowed(new THREE.Mesh(cached('truss_3', () => trussGeometry(3, false)), m.alu));
        group.add(mesh);
        break;
      }
      case 'truss-tower': {
        const mast = shadowed(new THREE.Mesh(cached('truss_v6', () => trussGeometry(6, true)), m.alu));
        mast.position.y = 3;
        group.add(mast);
        const base = shadowed(new THREE.Mesh(cached('tower_base', () => new THREE.BoxGeometry(1.1, 0.12, 1.1)), m.noirMat));
        group.add(base);
        break;
      }
      case 'stage-deck': {
        const top = shadowed(new THREE.Mesh(cached('deck_top', () => new THREE.BoxGeometry(2, 0.09, 1)), m.noirMat));
        top.position.y = 0.8;
        group.add(top);
        for (const [x, z] of [
          [-0.9, -0.4],
          [0.9, -0.4],
          [-0.9, 0.4],
          [0.9, 0.4],
        ]) {
          const leg = shadowed(new THREE.Mesh(cached('deck_leg', () => new THREE.CylinderGeometry(0.028, 0.028, 0.8, 8)), m.metal));
          leg.position.set(x, 0.4, z);
          group.add(leg);
        }
        break;
      }
      case 'chair': {
        const chair = shadowed(new THREE.Mesh(cached('chair', chairGeometry), m.plastique));
        group.add(chair);
        break;
      }
      case 'seating-block': {
        // Un bloc de gradins : `qty` sieges instancies, occupes aux deux tiers.
        const seats = Math.max(1, Math.min(1200, Math.round(item.qty)));
        const cols = Math.max(1, Math.round(Math.sqrt(seats * 1.7)));
        const rows = Math.ceil(seats / cols);
        const pitchX = 0.56;
        const pitchZ = 0.88;
        const chairs = new THREE.InstancedMesh(cached('chair', chairGeometry), m.plastique, seats);
        chairs.castShadow = true;
        chairs.receiveShadow = true;
        const occupied: THREE.Matrix4[] = [];
        const matrix = new THREE.Matrix4();
        for (let index = 0; index < seats; index += 1) {
          const col = index % cols;
          const rowIndex = Math.floor(index / cols);
          const x = (col - (cols - 1) / 2) * pitchX;
          const z = (rowIndex - (rows - 1) / 2) * pitchZ;
          matrix.makeTranslation(x, 0, z);
          chairs.setMatrixAt(index, matrix);
          if ((index * 7919) % 3 !== 0) occupied.push(matrix.clone());
        }
        chairs.instanceMatrix.needsUpdate = true;
        group.add(chairs);

        const bust = mergeGeometries(
          [
            (() => {
              const body = new THREE.CapsuleGeometry(0.16, 0.42, 4, 8);
              body.translate(0, 0.72, -0.02);
              return body;
            })(),
            (() => {
              const head = new THREE.SphereGeometry(0.11, 10, 8);
              head.translate(0, 1.06, -0.02);
              return head;
            })(),
          ],
          false,
        );
        if (bust && occupied.length) {
          const people = new THREE.InstancedMesh(bust, m.foule, occupied.length);
          people.castShadow = true;
          occupied.forEach((entry, index) => people.setMatrixAt(index, entry));
          people.instanceMatrix.needsUpdate = true;
          group.add(people);
        }
        break;
      }
      case 'table-round': {
        const top = shadowed(new THREE.Mesh(cached('table_top', () => new THREE.CylinderGeometry(0.75, 0.75, 0.05, 32)), m.nappe));
        top.position.y = 0.74;
        group.add(top);
        const skirt = shadowed(new THREE.Mesh(cached('table_skirt', () => new THREE.CylinderGeometry(0.74, 0.72, 0.72, 32, 1, true)), m.nappe));
        skirt.position.y = 0.37;
        group.add(skirt);
        break;
      }
      case 'bar': {
        const counter = shadowed(new THREE.Mesh(cached('bar_body', () => new THREE.BoxGeometry(2.6, 1.1, 0.7)), m.bois));
        counter.position.y = 0.55;
        group.add(counter);
        const top = shadowed(new THREE.Mesh(cached('bar_top', () => new THREE.BoxGeometry(2.75, 0.06, 0.85)), m.noirMat));
        top.position.y = 1.13;
        group.add(top);
        break;
      }
      case 'lectern': {
        const body = shadowed(new THREE.Mesh(cached('lect_body', () => new THREE.BoxGeometry(0.6, 1.15, 0.45)), m.noirMat));
        body.position.y = 0.575;
        group.add(body);
        const desk = shadowed(new THREE.Mesh(cached('lect_desk', () => new THREE.BoxGeometry(0.66, 0.04, 0.4)), m.plastique));
        desk.position.y = 1.17;
        desk.rotation.x = -0.22;
        group.add(desk);
        break;
      }
      case 'haze': {
        const body = shadowed(new THREE.Mesh(cached('haze_body', () => new THREE.BoxGeometry(0.5, 0.34, 0.34)), m.noirMat));
        body.position.y = 0.17;
        group.add(body);
        break;
      }
      default: {
        const box = shadowed(new THREE.Mesh(cached('generic', () => new THREE.BoxGeometry(0.5, 0.5, 0.5)), m.plastique));
        box.position.y = 0.25;
        group.add(box);
      }
    }
    return group;
  }
}

/**
 * Voute celeste en degrade. Un aplat de couleur trahit immediatement la
 * synthese ; un degrade vertical donne un horizon et de la profondeur.
 */
function skyDome(top: string, bottom: string, radius: number): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uBottom: { value: new THREE.Color(bottom) },
    },
    vertexShader: `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uBottom;
      varying vec3 vPosition;
      void main() {
        float h = clamp(normalize(vPosition).y * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(mix(uBottom, uTop, pow(h, 0.85)), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), material);
  dome.name = 'sky';
  return dome;
}
