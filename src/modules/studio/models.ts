/**
 * Construction geometrique des objets du Studio.
 *
 * Chaque modele est bati aux cotes demandees, origine au sol et centre sur
 * X/Z. Les objets dont la forme depend de leurs dimensions — structures,
 * murs LED, blocs de sieges, tentes — sont reconstruits ; les autres sont
 * bâtis a leur taille nominale puis mis a l'echelle.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneItem } from '../../core/types';
import { objectDef, type ObjectDef } from './library';
import type { StudioMaterials } from './materials';
import { screenTexture } from './materials';

export interface BuildContext {
  materials: StudioMaterials;
  haze: number;
  /** Ajoute un faisceau volumetrique et sa source lumineuse. */
  addBeam: (
    parent: THREE.Object3D,
    color: string,
    intensity: number,
    length: number,
    spread: number,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
  ) => void;
}

const CACHE = new Map<string, THREE.BufferGeometry>();

function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geometry = CACHE.get(key);
  if (!geometry) {
    geometry = build();
    CACHE.set(key, geometry);
  }
  return geometry;
}

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return cached(`b_${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
}

function cyl(r: number, h: number, segments = 14): THREE.BufferGeometry {
  return cached(`c_${r}_${h}_${segments}`, () => new THREE.CylinderGeometry(r, r, h, segments));
}


/**
 * Boite a aretes adoucies. Les objets reels n'ont pas d'arete parfaitement
 * vive : un chanfrein de quelques millimetres accroche la lumiere et suffit
 * a sortir un meuble de l'aspect « boite grise ».
 */
function roundedBox(w: number, h: number, d: number, radius = 0.02): THREE.BufferGeometry {
  const key = `rb_${w}_${h}_${d}_${radius}`;
  return cached(key, () => {
    const r = Math.min(radius, w / 2.5, h / 2.5, d / 2.5);
    const shape = new THREE.Shape();
    const hw = w / 2 - r;
    const hd = d / 2 - r;
    shape.moveTo(-hw, -d / 2);
    shape.lineTo(hw, -d / 2);
    shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -hd);
    shape.lineTo(w / 2, hd);
    shape.quadraticCurveTo(w / 2, d / 2, hw, d / 2);
    shape.lineTo(-hw, d / 2);
    shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, hd);
    shape.lineTo(-w / 2, -hd);
    shape.quadraticCurveTo(-w / 2, -d / 2, -hw, -d / 2);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: h - r * 2,
      bevelEnabled: true,
      bevelThickness: r,
      bevelSize: r,
      bevelSegments: 2,
      curveSegments: 4,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, h / 2, 0);
    geometry.computeVertexNormals();
    return geometry;
  });
}

/** Cylindre vertical simple, utilise pour les pieds et les mats. */
function post(radius: number, height: number): THREE.BufferGeometry {
  return cyl(radius, height, 10);
}

/** Maille qui projette et recoit l'ombre — le defaut pour tout objet solide. */
function solid(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function emissive(color: string, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    roughness: 0.2,
    metalness: 0.1,
  });
}

/* --------------------------------------------------------- pieces communes */

function trussGeometry(length: number, section: number, vertical: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tube = Math.max(0.012, section * 0.08);
  const half = section / 2;
  for (const [a, b] of [
    [-half, -half],
    [half, -half],
    [-half, half],
    [half, half],
  ]) {
    const chord = new THREE.CylinderGeometry(tube, tube, length, 8);
    if (vertical) chord.translate(a, 0, b);
    else {
      chord.rotateZ(Math.PI / 2);
      chord.translate(0, a, b);
    }
    parts.push(chord);
  }
  const braces = Math.max(2, Math.round(length / (section * 1.7)));
  for (let index = 0; index < braces; index += 1) {
    const t = -length / 2 + (length / braces) * (index + 0.5);
    for (const axis of [0, 1]) {
      const brace = new THREE.CylinderGeometry(tube * 0.6, tube * 0.6, section * 1.42, 6);
      brace.rotateZ(Math.PI / 4);
      if (axis === 1) brace.rotateY(Math.PI / 2);
      if (vertical) brace.translate(0, t, axis === 0 ? half : -half);
      else {
        brace.rotateZ(Math.PI / 2);
        brace.rotateX(Math.PI / 2);
        brace.translate(t, axis === 0 ? half : -half, 0);
      }
      parts.push(brace);
    }
  }
  return mergeGeometries(parts, false) ?? new THREE.BoxGeometry(length, section, section);
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

function personGeometry(seated: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (seated) {
    const torso = new THREE.CapsuleGeometry(0.16, 0.4, 4, 10);
    torso.translate(0, 0.72, -0.02);
    parts.push(torso);
    const legs = new THREE.BoxGeometry(0.32, 0.16, 0.42);
    legs.translate(0, 0.46, 0.18);
    parts.push(legs);
    const head = new THREE.SphereGeometry(0.11, 12, 10);
    head.translate(0, 1.06, -0.02);
    parts.push(head);
  } else {
    const body = new THREE.CapsuleGeometry(0.17, 0.86, 4, 10);
    body.translate(0, 0.78, 0);
    parts.push(body);
    const head = new THREE.SphereGeometry(0.115, 12, 10);
    head.translate(0, 1.44, 0);
    parts.push(head);
    for (const side of [-1, 1]) {
      const leg = new THREE.CapsuleGeometry(0.075, 0.36, 4, 8);
      leg.translate(side * 0.09, 0.22, 0);
      parts.push(leg);
    }
  }
  return mergeGeometries(parts, false) ?? new THREE.CapsuleGeometry(0.17, 0.86, 4, 8);
}

export const PERSON_GEOMETRY = () => cached('person_std', () => personGeometry(false));
export const CHAIR_GEOMETRY = () => cached('chair_std', chairGeometry);

/** Toiture a quatre pans, utilisee par les tentes et abris. */
function hipRoof(w: number, d: number, rise: number, drop: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const vertices = new Float32Array([
    -hw, -drop, -hd, hw, -drop, -hd, hw, -drop, hd, -hw, -drop, hd, 0, rise, 0,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]);
  geometry.computeVertexNormals();
  return geometry;
}

interface Mast {
  x: number;
  z: number;
  height: number;
}

/**
 * Points d'ancrage d'une tente stretch : des mats de hauteurs alternees en
 * peripherie et un mat central plus haut. C'est cette alternance qui donne a
 * la toile sa double courbure caracteristique.
 */
function stretchMasts(w: number, h: number, d: number): Mast[] {
  const hw = w / 2;
  const hd = d / 2;
  const low = h * 0.56;
  return [
    { x: -hw, z: -hd, height: h * 0.92 },
    { x: hw, z: -hd, height: low },
    { x: hw, z: hd, height: h * 0.92 },
    { x: -hw, z: hd, height: low },
    { x: 0, z: -hd, height: low * 0.95 },
    { x: 0, z: hd, height: low * 0.95 },
    { x: 0, z: 0, height: h },
  ];
}

/**
 * Toile de tente stretch.
 *
 * La hauteur en un point est la moyenne des mats ponderee par l'inverse du
 * carre de la distance : la toile passe par le sommet de chaque mat et
 * retombe entre eux, comme une membrane reellement tendue. Un terme de fleche
 * creuse legerement les portees.
 */
function stretchCanopy(w: number, h: number, d: number, masts: Mast[]): THREE.BufferGeometry {
  const segments = 32;
  const geometry = new THREE.PlaneGeometry(w, d, segments, segments);
  const position = geometry.attributes.position;

  for (let index = 0; index < position.count; index += 1) {
    const px = position.getX(index);
    const pz = position.getY(index);
    let weighted = 0;
    let total = 0;
    let nearest = Infinity;
    for (const mast of masts) {
      const distance = Math.hypot(px - mast.x, pz - mast.z);
      if (distance < 0.02) {
        weighted = mast.height;
        total = 1;
        nearest = 0;
        break;
      }
      const weight = 1 / distance ** 2.6;
      weighted += mast.height * weight;
      total += weight;
      nearest = Math.min(nearest, distance);
    }
    const sag = Math.min(h * 0.16, nearest * 0.12);
    position.setZ(index, weighted / total - sag);
  }

  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/* ---------------------------------------------------------------- fabrique */

/**
 * Construit un objet aux dimensions demandees.
 * Renvoie le groupe et un drapeau indiquant si les cotes ont deja ete prises
 * en compte (auquel cas l'appelant ne doit pas le remettre a l'echelle).
 */
export function buildObject(
  item: SceneItem,
  size: [number, number, number],
  ctx: BuildContext,
): { object: THREE.Object3D; parametric: boolean } {
  const def = objectDef(item.model3d);
  const m = ctx.materials;
  const group = new THREE.Group();
  const [w, h, d] = size;
  const color = item.color || def.color || '#3987e5';
  let parametric = false;

  switch (def.id) {
    /* ------------------------------------------------------------------ son */
    case 'line-array': {
      group.add(solid(box(0.72, 0.26, 0.44), m.caisson));
      const front = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.22), m.grille);
      front.position.z = 0.221;
      group.add(front);
      for (const side of [-1, 1]) group.add(solid(box(0.03, 0.3, 0.46), m.alu, side * 0.375));
      break;
    }
    case 'sub': {
      group.add(solid(box(0.62, 0.6, 0.78), m.caisson, 0, 0.3));
      const front = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.54), m.grille);
      front.position.set(0, 0.3, 0.392);
      group.add(front);
      break;
    }
    case 'top-speaker':
    case 'speaker-pole': {
      const lift = def.id === 'speaker-pole' ? 1.55 : 0.26;
      group.add(solid(box(0.34, 0.52, 0.33), m.caisson, 0, lift));
      const front = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.48), m.grille);
      front.position.set(0, lift, 0.166);
      group.add(front);
      if (def.id === 'speaker-pole') {
        group.add(solid(cyl(0.022, 1.5, 10), m.metal, 0, 0.75));
        group.add(solid(cyl(0.32, 0.04, 18), m.noirMat, 0, 0.02));
      }
      break;
    }
    case 'monitor': {
      const wedge = solid(box(0.56, 0.34, 0.44), m.caisson, 0, 0.18);
      wedge.rotation.x = -0.62;
      group.add(wedge);
      const front = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.28), m.grille);
      front.rotation.x = -0.62;
      front.position.set(0, 0.28, 0.16);
      group.add(front);
      break;
    }
    case 'delay-tower': {
      parametric = true;
      group.add(solid(trussGeometry(h, Math.min(w, d) * 0.5, true), m.alu, 0, h / 2));
      group.add(solid(box(w, 0.12, d), m.noirMat, 0, 0.06));
      for (let index = 0; index < 3; index += 1) {
        group.add(solid(box(0.72, 0.26, 0.44), m.caisson, 0, h - 0.4 - index * 0.3, 0.2));
      }
      break;
    }
    case 'console': {
      group.add(solid(box(1.5, 0.75, 0.8), m.noirMat, 0, 0.375));
      const top = solid(box(1.42, 0.09, 0.72), m.plastique, 0, 0.79);
      top.rotation.x = -0.14;
      group.add(top);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.28), emissive('#2b6fc4', 1.6));
      screen.position.set(0, 0.98, -0.16);
      screen.rotation.x = -0.34;
      group.add(screen);
      break;
    }
    case 'dj-booth': {
      group.add(solid(box(1.7, 0.95, 0.62), m.noirMat, 0, 0.475));
      for (const x of [-0.55, 0.55]) {
        group.add(solid(box(0.42, 0.07, 0.46), m.plastique, x, 0.99));
        group.add(solid(cyl(0.13, 0.02, 24), m.alu, x, 1.04));
      }
      group.add(solid(box(0.38, 0.08, 0.44), m.plastique, 0, 0.99));
      break;
    }
    case 'amp-rack':
    case 'rack-technique': {
      group.add(solid(box(0.6, 1.2, 0.75), m.noirMat, 0, 0.6));
      for (let index = 0; index < 5; index += 1) {
        group.add(solid(box(0.52, 0.14, 0.02), m.metal, 0, 0.25 + index * 0.2, 0.376));
      }
      break;
    }
    case 'mic-stand': {
      group.add(solid(cyl(0.16, 0.02, 16), m.noirMat, 0, 0.01));
      group.add(solid(cyl(0.016, 1.4, 8), m.metal, 0, 0.7));
      const boom = solid(cyl(0.012, 0.45, 8), m.metal, 0.18, 1.4);
      boom.rotation.z = Math.PI / 2.4;
      group.add(boom);
      break;
    }

    /* -------------------------------------------------------------- lumière */
    case 'moving-head':
    case 'moving-wash': {
      const wash = def.id === 'moving-wash';
      group.add(solid(box(0.34, 0.14, 0.34), m.noirMat, 0, 0.58));
      for (const side of [-1, 1]) group.add(solid(box(0.07, 0.4, 0.2), m.plastique, side * 0.15, 0.34));
      const head = solid(cyl(wash ? 0.15 : 0.13, 0.36, 18), m.plastique, 0, 0.16);
      group.add(head);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(wash ? 0.14 : 0.115, 22), emissive(color, item.beam > 0 ? 3.4 : 0));
      lens.position.y = -0.025;
      lens.rotation.x = -Math.PI / 2;
      group.add(lens);
      ctx.addBeam(
        group,
        color,
        item.beam,
        Math.max(6, item.y + 3),
        wash ? 2.4 : 1.4,
        new THREE.Vector3(0, -0.03, 0),
        new THREE.Vector3(-item.x * 0.18, -1, -item.z * 0.12 - 1.1).normalize(),
      );
      break;
    }
    case 'par-led': {
      const body = solid(cyl(0.14, 0.3, 20), m.noirMat, 0, 0.2);
      body.rotation.x = Math.PI / 2.6;
      group.add(body);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.115, 20), emissive(color, item.beam > 0 ? 3.8 : 0));
      lens.position.set(0, 0.31, 0.12);
      lens.rotation.x = Math.PI / 2.6 - Math.PI / 2;
      group.add(lens);
      group.add(solid(box(0.3, 0.02, 0.02), m.metal, 0, 0.06));
      ctx.addBeam(
        group,
        color,
        item.beam * 0.85,
        6,
        1.9,
        new THREE.Vector3(0, 0.3, 0.12),
        new THREE.Vector3(0, item.y > 2 ? -1 : 0.35, item.z < 0 ? 1 : -1).normalize(),
      );
      break;
    }
    case 'blinder': {
      group.add(solid(box(0.72, 0.4, 0.22), m.noirMat, 0, 0.2));
      const lamp = emissive('#ffd9a0', item.beam > 0 ? 5 : 0);
      for (let index = 0; index < 8; index += 1) {
        const cell = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), lamp);
        cell.position.set(-0.27 + (index % 4) * 0.18, index < 4 ? 0.29 : 0.11, 0.112);
        group.add(cell);
      }
      ctx.addBeam(group, '#ffd9a0', item.beam * 0.7, 8, 3.2, new THREE.Vector3(0, 0.2, 0.12), new THREE.Vector3(0, -0.35, 1).normalize());
      break;
    }
    case 'strobe': {
      group.add(solid(box(0.5, 0.3, 0.2), m.noirMat, 0, 0.15));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.22), emissive('#ffffff', item.beam > 0 ? 6 : 0));
      face.position.set(0, 0.15, 0.102);
      group.add(face);
      ctx.addBeam(group, '#ffffff', item.beam * 0.5, 7, 3.6, new THREE.Vector3(0, 0.15, 0.1), new THREE.Vector3(0, -0.3, 1).normalize());
      break;
    }
    case 'followspot': {
      group.add(solid(cyl(0.03, 1.1, 8), m.metal, 0, 0.55));
      group.add(solid(cyl(0.35, 0.04, 16), m.noirMat, 0, 0.02));
      const barrel = solid(cyl(0.16, 1, 18), m.noirMat, 0, 1.2, 0.1);
      barrel.rotation.x = Math.PI / 2 + 0.12;
      group.add(barrel);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), emissive('#fff3d0', item.beam > 0 ? 4 : 0));
      lens.position.set(0, 1.14, 0.58);
      lens.rotation.x = -0.12;
      group.add(lens);
      ctx.addBeam(group, '#fff3d0', item.beam, 14, 0.9, new THREE.Vector3(0, 1.14, 0.6), new THREE.Vector3(0, -0.12, 1).normalize());
      break;
    }
    case 'uplight': {
      group.add(solid(cyl(0.11, 0.26, 16), m.noirMat, 0, 0.13));
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), emissive(color, item.beam > 0 ? 4 : 0));
      lens.position.y = 0.262;
      lens.rotation.x = -Math.PI / 2;
      group.add(lens);
      ctx.addBeam(group, color, item.beam * 0.9, 4.5, 0.8, new THREE.Vector3(0, 0.27, 0), new THREE.Vector3(0, 1, 0));
      break;
    }
    case 'haze': {
      group.add(solid(box(0.5, 0.34, 0.34), m.noirMat, 0, 0.17));
      group.add(solid(cyl(0.06, 0.12, 12), m.metal, 0, 0.24, 0.2));
      break;
    }
    case 'string-lights': {
      parametric = true;
      const span = w;
      const bulbs = Math.max(4, Math.round(span / 0.6));
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-span / 2, 0, 0),
        new THREE.Vector3(0, -Math.min(0.6, span * 0.06), 0),
        new THREE.Vector3(span / 2, 0, 0),
      ]);
      const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.012, 6, false), m.noirMat);
      group.add(cable);
      const bulbMaterial = emissive(color, 3.2);
      for (let index = 0; index <= bulbs; index += 1) {
        const point = curve.getPoint(index / bulbs);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), bulbMaterial);
        bulb.position.copy(point).add(new THREE.Vector3(0, -0.05, 0));
        group.add(bulb);
      }
      // Une guirlande eclaire reellement la table en dessous : sans source
      // ponctuelle, la scene de nuit reste noire sous les ampoules.
      const lamps = Math.max(1, Math.round(span / 4));
      for (let index = 0; index < lamps; index += 1) {
        const point = curve.getPoint((index + 0.5) / lamps);
        const light = new THREE.PointLight(new THREE.Color(color), 9, span * 0.9, 2);
        light.position.copy(point).add(new THREE.Vector3(0, -0.1, 0));
        group.add(light);
      }
      break;
    }
    case 'neon-sign': {
      parametric = true;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), emissive(color, 2.6));
      panel.position.y = h / 2;
      group.add(panel);
      const glow = new THREE.PointLight(new THREE.Color(color), 6, Math.max(4, w * 2.5), 2);
      glow.position.set(0, h / 2, 0.3);
      group.add(glow);
      group.add(solid(box(w + 0.06, h + 0.06, 0.06), m.noirMat, 0, h / 2, -0.04));
      break;
    }

    /* ---------------------------------------------------------------- vidéo */
    case 'led-wall': {
      parametric = true;
      const texture = screenTexture();
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.85,
        roughness: 0.42,
      });
      group.add(solid(box(w + 0.06, h + 0.06, 0.12), m.noirMat, 0, h / 2));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
      screen.position.set(0, h / 2, 0.062);
      group.add(screen);
      const glow = new THREE.RectAreaLight(0x6f9fe0, 1.4, w, h);
      glow.position.set(0, h / 2, 0.1);
      group.add(glow);
      break;
    }
    case 'projection-screen': {
      parametric = true;
      group.add(solid(box(w + 0.1, 0.08, 0.08), m.alu, 0, h + 0.04));
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.95, side: THREE.DoubleSide }));
      cloth.position.y = h / 2;
      cloth.receiveShadow = true;
      group.add(cloth);
      for (const side of [-1, 1]) group.add(solid(cyl(0.03, h, 8), m.metal, (side * w) / 2, h / 2, -0.05));
      break;
    }
    case 'projector': {
      group.add(solid(box(0.6, 0.28, 0.7), m.peinture, 0, 0.14));
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.08, 18), emissive('#cfe2ff', item.beam > 0 ? 3 : 0));
      lens.position.set(0, 0.14, 0.352);
      group.add(lens);
      ctx.addBeam(group, '#cfe2ff', item.beam * 0.6, 10, 1.6, new THREE.Vector3(0, 0.14, 0.36), new THREE.Vector3(0, -0.1, 1).normalize());
      break;
    }
    case 'tv-screen': {
      parametric = true;
      const panelH = h * 0.62;
      group.add(solid(box(w, panelH, 0.07), m.noirMat, 0, h - panelH / 2));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, panelH * 0.94), emissive('#1d3f6d', 1.1));
      face.position.set(0, h - panelH / 2, 0.037);
      group.add(face);
      group.add(solid(cyl(0.04, h - panelH, 10), m.metal, 0, (h - panelH) / 2));
      group.add(solid(box(w * 0.5, 0.04, 0.5), m.noirMat, 0, 0.02));
      break;
    }
    case 'camera': {
      group.add(solid(cyl(0.32, 0.03, 14), m.noirMat, 0, 0.015));
      for (let index = 0; index < 3; index += 1) {
        const leg = solid(cyl(0.018, 1.4, 6), m.metal, Math.cos((index * 2 * Math.PI) / 3) * 0.16, 0.7, Math.sin((index * 2 * Math.PI) / 3) * 0.16);
        leg.rotation.z = Math.cos((index * 2 * Math.PI) / 3) * 0.12;
        leg.rotation.x = -Math.sin((index * 2 * Math.PI) / 3) * 0.12;
        group.add(leg);
      }
      group.add(solid(box(0.2, 0.18, 0.42), m.noirMat, 0, 1.48));
      group.add(solid(cyl(0.06, 0.16, 14), m.lentille, 0, 1.48, 0.28));
      break;
    }

    /* -------------------------------------------------- structure & scène */
    case 'truss': {
      parametric = true;
      const mesh = solid(trussGeometry(w, Math.min(h, d), false), m.alu, 0, 0);
      group.add(mesh);
      break;
    }
    case 'truss-tower': {
      parametric = true;
      group.add(solid(trussGeometry(h, Math.min(w, d) * 0.35, true), m.alu, 0, h / 2));
      group.add(solid(box(w, 0.12, d), m.noirMat, 0, 0.06));
      break;
    }
    case 'truss-arch': {
      parametric = true;
      const section = Math.min(0.4, d);
      group.add(solid(trussGeometry(h, section, true), m.alu, -w / 2 + section / 2, h / 2));
      group.add(solid(trussGeometry(h, section, true), m.alu, w / 2 - section / 2, h / 2));
      group.add(solid(trussGeometry(w, section, false), m.alu, 0, h));
      for (const side of [-1, 1]) group.add(solid(box(1, 0.1, 1), m.noirMat, (side * w) / 2, 0.05));
      break;
    }
    case 'stage-deck': {
      parametric = true;
      group.add(solid(box(w, 0.09, d), m.noirMat, 0, h - 0.045));
      const legs = h - 0.09;
      if (legs > 0.05) {
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          group.add(solid(cyl(0.028, legs, 8), m.metal, (sx * (w / 2 - 0.1)), legs / 2, (sz * (d / 2 - 0.1))));
        }
      }
      break;
    }
    case 'stage-stairs': {
      parametric = true;
      const steps = Math.max(2, Math.round(h / 0.2));
      for (let index = 0; index < steps; index += 1) {
        const depth = d / steps;
        group.add(solid(box(w, 0.05, depth), m.noirMat, 0, (h / steps) * (index + 1) - 0.025, d / 2 - depth * (index + 0.5)));
        group.add(solid(box(w, h / steps, 0.04), m.metal, 0, (h / steps) * (index + 0.5), d / 2 - depth * index - depth));
      }
      break;
    }
    case 'stage-rail': {
      parametric = true;
      const top = solid(cyl(0.025, w, 10), m.metal, 0, h);
      top.rotation.z = Math.PI / 2;
      group.add(top);
      const mid = solid(cyl(0.02, w, 8), m.metal, 0, h * 0.55);
      mid.rotation.z = Math.PI / 2;
      group.add(mid);
      const posts = Math.max(2, Math.round(w / 1.2));
      for (let index = 0; index <= posts; index += 1) {
        group.add(solid(cyl(0.022, h, 8), m.metal, -w / 2 + (w / posts) * index, h / 2));
      }
      break;
    }
    case 'barrier': {
      parametric = true;
      const units = Math.max(1, Math.round(w / 2));
      for (let index = 0; index < units; index += 1) {
        const x = -w / 2 + (w / units) * (index + 0.5);
        const unit = new THREE.Group();
        unit.position.x = x;
        const width = w / units - 0.05;
        const top = solid(cyl(0.02, width, 8), m.metal, 0, h);
        top.rotation.z = Math.PI / 2;
        unit.add(top);
        for (let bar = 0; bar < 6; bar += 1) {
          unit.add(solid(cyl(0.012, h, 6), m.metal, -width / 2 + (width / 5) * bar, h / 2));
        }
        unit.add(solid(box(0.05, 0.04, d), m.metal, 0, 0.02));
        group.add(unit);
      }
      break;
    }
    case 'pipe-drape': {
      parametric = true;
      for (const side of [-1, 1]) group.add(solid(cyl(0.025, h, 8), m.metal, (side * w) / 2, h / 2));
      const beam = solid(cyl(0.02, w, 8), m.metal, 0, h);
      beam.rotation.z = Math.PI / 2;
      group.add(beam);
      const drape = new THREE.Mesh(new THREE.PlaneGeometry(w, h * 0.97, 12, 1), m.tissu);
      drape.position.y = (h * 0.97) / 2;
      drape.receiveShadow = true;
      drape.castShadow = true;
      const position = drape.geometry.attributes.position;
      for (let index = 0; index < position.count; index += 1) {
        position.setZ(index, Math.sin(position.getX(index) * 3) * 0.06);
      }
      drape.geometry.computeVertexNormals();
      group.add(drape);
      break;
    }

    /* ---------------------------------------------- mobilier & réception */
    case 'bar': {
      parametric = true;
      // Comptoir modulaire : les modules d'un metre se lisent en facade.
      const modules = Math.max(1, Math.round(w));
      for (let index = 0; index < modules; index += 1) {
        const mw = w / modules;
        const x = -w / 2 + mw * (index + 0.5);
        group.add(solid(roundedBox(mw - 0.02, h - 0.06, d, 0.015), m.bois, x, (h - 0.06) / 2));
        group.add(solid(box(mw - 0.06, h * 0.62, 0.012), m.boisClair, x, h * 0.42, d / 2 + 0.008));
      }
      group.add(solid(roundedBox(w + 0.14, 0.06, d + 0.16, 0.02), m.noirMat, 0, h - 0.03));
      group.add(solid(box(w, 0.04, 0.04), m.inox, 0, 0.12, d / 2 + 0.06));
      break;
    }
    case 'back-bar': {
      parametric = true;
      group.add(solid(roundedBox(w, h * 0.55, d, 0.02), m.noirMat, 0, (h * 0.55) / 2));
      group.add(solid(roundedBox(w + 0.06, 0.05, d + 0.06, 0.015), m.bois, 0, h * 0.57));
      for (let index = 0; index < 3; index += 1) {
        group.add(solid(box(w - 0.1, 0.03, d * 0.7), m.boisClair, 0, h * 0.66 + index * (h * 0.13), -0.02));
        const bottles = new THREE.MeshStandardMaterial({ color: 0x2f4a3a, roughness: 0.25, metalness: 0.1 });
        for (let b = 0; b < Math.max(3, Math.round(w * 4)); b += 1) {
          const bottle = solid(
            cached('bottle', () => new THREE.CylinderGeometry(0.035, 0.04, 0.28, 10)),
            bottles,
            -w / 2 + 0.1 + b * 0.24,
            h * 0.66 + index * (h * 0.13) + 0.15,
            -0.02,
          );
          if (bottle.position.x < w / 2 - 0.05) group.add(bottle);
        }
      }
      break;
    }
    case 'table-round': {
      parametric = true;
      group.add(solid(new THREE.CylinderGeometry(w / 2, w / 2, 0.05, 32), m.nappe, 0, h - 0.025));
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(w / 2 - 0.01, w / 2 - 0.03, h - 0.05, 32, 1, true), m.nappe);
      skirt.position.y = (h - 0.05) / 2;
      skirt.castShadow = true;
      skirt.receiveShadow = true;
      group.add(skirt);
      break;
    }
    case 'table-rect': {
      parametric = true;
      group.add(solid(box(w, 0.05, d), m.boisClair, 0, h - 0.025));
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        group.add(solid(cyl(0.025, h - 0.05, 8), m.metal, sx * (w / 2 - 0.08), (h - 0.05) / 2, sz * (d / 2 - 0.08)));
      }
      break;
    }
    case 'cocktail-table': {
      parametric = true;
      group.add(solid(new THREE.CylinderGeometry(w / 2, w / 2, 0.04, 28), m.nappe, 0, h - 0.02));
      // Housse tombante : ce qui distingue un mange-debout habille d'un champignon.
      const cover = new THREE.Mesh(
        new THREE.CylinderGeometry(w / 2 - 0.01, w / 2 - 0.06, h - 0.06, 28, 3, true),
        m.nappe,
      );
      cover.position.y = (h - 0.06) / 2;
      cover.castShadow = true;
      cover.receiveShadow = true;
      const folds = cover.geometry.attributes.position;
      for (let index = 0; index < folds.count; index += 1) {
        const angle = Math.atan2(folds.getZ(index), folds.getX(index));
        const fold = 1 + Math.sin(angle * 12) * 0.02;
        folds.setX(index, folds.getX(index) * fold);
        folds.setZ(index, folds.getZ(index) * fold);
      }
      cover.geometry.computeVertexNormals();
      group.add(cover);
      break;
    }
    case 'chair': {
      group.add(solid(CHAIR_GEOMETRY(), m.plastique));
      break;
    }
    case 'bench': {
      parametric = true;
      group.add(solid(box(w, 0.07, d), m.bois, 0, h - 0.035));
      for (const side of [-1, 1]) group.add(solid(box(0.07, h - 0.07, d * 0.8), m.metal, side * (w / 2 - 0.12), (h - 0.07) / 2));
      break;
    }
    case 'lounge-sofa':
    case 'armchair': {
      parametric = true;
      group.add(solid(box(w, h * 0.5, d), m.tissu, 0, h * 0.25));
      group.add(solid(box(w, h * 0.6, d * 0.22), m.tissu, 0, h * 0.55, -d / 2 + d * 0.11));
      for (const side of [-1, 1]) group.add(solid(box(w * 0.1, h * 0.7, d), m.tissu, side * (w / 2 - w * 0.05), h * 0.35));
      break;
    }
    case 'buffet': {
      parametric = true;
      group.add(solid(box(w, 0.05, d), m.nappe, 0, h - 0.025));
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(w, h - 0.05, d), m.nappe);
      skirt.position.y = (h - 0.05) / 2;
      skirt.castShadow = true;
      group.add(skirt);
      for (let index = 0; index < 3; index += 1) {
        group.add(solid(box(w * 0.22, 0.09, d * 0.5), m.inox, -w / 3 + (w / 3) * index, h + 0.045));
      }
      break;
    }
    case 'lectern': {
      group.add(solid(box(0.6, 1.15, 0.45), m.noirMat, 0, 0.575));
      const desk = solid(box(0.66, 0.04, 0.4), m.plastique, 0, 1.17);
      desk.rotation.x = -0.22;
      group.add(desk);
      break;
    }
    case 'seating-block': {
      parametric = true;
      const seats = Math.max(1, Math.min(1500, Math.round(item.qty)));
      const pitchX = 0.56;
      const pitchZ = 0.88;
      const cols = Math.max(1, Math.min(Math.round(w / pitchX), seats));
      const rows = Math.ceil(seats / cols);
      const chairs = new THREE.InstancedMesh(CHAIR_GEOMETRY(), m.plastique, seats);
      chairs.castShadow = true;
      chairs.receiveShadow = true;
      const people: THREE.Matrix4[] = [];
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < seats; index += 1) {
        const col = index % cols;
        const row = Math.floor(index / cols);
        matrix.makeTranslation((col - (cols - 1) / 2) * pitchX, 0, (row - (rows - 1) / 2) * pitchZ);
        chairs.setMatrixAt(index, matrix);
        if ((index * 7919) % 3 !== 0) people.push(matrix.clone());
      }
      chairs.instanceMatrix.needsUpdate = true;
      group.add(chairs);
      if (people.length) {
        const seated = new THREE.InstancedMesh(cached('person_seated', () => personGeometry(true)), m.foule, people.length);
        seated.castShadow = true;
        people.forEach((entry, index) => seated.setMatrixAt(index, entry));
        seated.instanceMatrix.needsUpdate = true;
        group.add(seated);
      }
      break;
    }
    case 'coat-rack': {
      parametric = true;
      group.add(solid(box(w, 0.05, d), m.metal, 0, h));
      for (const side of [-1, 1]) group.add(solid(cyl(0.02, h, 8), m.metal, side * (w / 2 - 0.05), h / 2));
      for (let index = 0; index < 8; index += 1) {
        group.add(solid(box(0.06, 0.6, 0.2), m.tissu, -w / 2 + 0.1 + (index * (w - 0.2)) / 7, h - 0.35));
      }
      break;
    }
    case 'bin': {
      const shell = new THREE.MeshStandardMaterial({ color: 0x36414c, roughness: 0.72, metalness: 0.04 });
      group.add(solid(new THREE.CylinderGeometry(0.25, 0.21, 0.85, 18), shell, 0, 0.425));
      group.add(solid(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 18), m.noirMat, 0, 0.87));
      group.add(solid(new THREE.TorusGeometry(0.2, 0.012, 6, 18), m.metal, 0, 0.89));
      break;
    }

    /* ------------------------------------------------------ tentes & abris */
    case 'tente-stretch': {
      parametric = true;
      const masts = stretchMasts(w * 0.94, h, d * 0.94);
      const canopy = new THREE.Mesh(stretchCanopy(w, h, d, masts), m.toile);
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      group.add(canopy);

      for (const mast of masts) {
        // Le mat central est droit ; les mats de rive sont inclines vers
        // l'exterieur et haubanes, comme sur un montage reel.
        const isEdge = Math.abs(mast.x) > 0.01 || Math.abs(mast.z) > 0.01;
        const pole = solid(cyl(0.05, mast.height, 12), m.metal, mast.x, mast.height / 2, mast.z);
        if (isEdge) {
          pole.rotation.z = -Math.sign(mast.x) * 0.09;
          pole.rotation.x = Math.sign(mast.z) * 0.09;
        }
        group.add(pole);
        group.add(solid(new THREE.CylinderGeometry(0.13, 0.17, 0.05, 12), m.noirMat, mast.x, 0.025, mast.z));

        if (isEdge) {
          const outward = new THREE.Vector3(mast.x, 0, mast.z).normalize().multiplyScalar(Math.max(w, d) * 0.15);
          const anchor = new THREE.Vector3(mast.x + outward.x, 0, mast.z + outward.z);
          const top = new THREE.Vector3(mast.x, mast.height, mast.z);
          group.add(
            new THREE.Mesh(
              new THREE.TubeGeometry(new THREE.LineCurve3(top, anchor), 1, 0.012, 5, false),
              m.noirMat,
            ),
          );
          group.add(solid(cyl(0.03, 0.4, 6), m.metal, anchor.x, 0.2, anchor.z));
        }
      }
      break;
    }
    case 'tonnelle':
    case 'tonnelle-48':
    case 'barnum':
    case 'pagode': {
      parametric = true;
      const legH = h * (def.id === 'pagode' ? 0.58 : 0.74);
      const roof = new THREE.Mesh(hipRoof(w, d, h - legH, 0), m.toile);
      roof.position.y = legH;
      roof.castShadow = true;
      roof.receiveShadow = true;
      group.add(roof);

      // Bandeau de rive : la retombee de toile qui borde tous les abris.
      const skirtH = Math.min(0.28, h * 0.09);
      for (const [dx, dz, rot] of [
        [0, d / 2, 0],
        [0, -d / 2, Math.PI],
        [w / 2, 0, Math.PI / 2],
        [-w / 2, 0, -Math.PI / 2],
      ] as [number, number, number][]) {
        const span = Math.abs(dx) > 0 ? d : w;
        const band = new THREE.Mesh(new THREE.PlaneGeometry(span, skirtH), m.toile);
        band.position.set(dx, legH - skirtH / 2, dz);
        band.rotation.y = rot;
        band.castShadow = true;
        group.add(band);
      }

      const posts: [number, number][] = [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ];
      if (w > 5) posts.push([0, -1], [0, 1]);
      if (d > 5) posts.push([-1, 0], [1, 0]);
      for (const [sx, sz] of posts) {
        const px = sx * (w / 2 - 0.06);
        const pz = sz * (d / 2 - 0.06);
        group.add(solid(box(0.06, legH, 0.06), m.alu, px, legH / 2, pz));
        group.add(solid(box(0.22, 0.02, 0.22), m.noirMat, px, 0.01, pz));
      }
      break;
    }
    case 'chapiteau': {
      parametric = true;
      const wallH = h * 0.55;
      const roof = new THREE.Mesh(hipRoof(w, d, h - wallH, 0), m.toile);
      roof.position.y = wallH;
      roof.castShadow = true;
      roof.receiveShadow = true;
      group.add(roof);
      const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), m.toile);
      walls.position.y = wallH / 2;
      walls.castShadow = true;
      walls.receiveShadow = true;
      group.add(walls);
      const posts = Math.max(2, Math.round(w / 4));
      for (let index = 0; index <= posts; index += 1) {
        const x = -w / 2 + (w / posts) * index;
        for (const sz of [-1, 1]) group.add(solid(cyl(0.05, wallH, 8), m.metal, x, wallH / 2, (sz * d) / 2));
      }
      break;
    }
    case 'parasol': {
      parametric = true;
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(w / 2, h * 0.3, 8, 1, true), m.toile);
      canopy.position.y = h - h * 0.15;
      canopy.castShadow = true;
      group.add(canopy);
      group.add(solid(cyl(0.035, h, 10), m.bois, 0, h / 2));
      group.add(solid(new THREE.CylinderGeometry(0.35, 0.4, 0.1, 16), m.noirMat, 0, 0.05));
      break;
    }

    /* ---------------------------------------------------- décor & extérieur */
    case 'arche-florale': {
      parametric = true;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-w / 2, 0, 0),
        new THREE.Vector3(-w / 2, h * 0.75, 0),
        new THREE.Vector3(0, h, 0),
        new THREE.Vector3(w / 2, h * 0.75, 0),
        new THREE.Vector3(w / 2, 0, 0),
      ]);
      group.add(solid(new THREE.TubeGeometry(curve, 40, 0.045, 8, false), m.bois));
      const foliage = new THREE.InstancedMesh(cached('leaf', () => new THREE.IcosahedronGeometry(0.16, 0)), m.feuillage, 90);
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < 90; index += 1) {
        const point = curve.getPoint(index / 89);
        matrix.makeScale(0.7 + Math.random() * 0.8, 0.7 + Math.random() * 0.8, 0.7 + Math.random() * 0.8);
        matrix.setPosition(point.x + (Math.random() - 0.5) * 0.22, point.y + (Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.25);
        foliage.setMatrixAt(index, matrix);
      }
      foliage.instanceMatrix.needsUpdate = true;
      foliage.castShadow = true;
      group.add(foliage);
      break;
    }
    case 'plante': {
      parametric = true;
      group.add(solid(new THREE.CylinderGeometry(w * 0.3, w * 0.22, h * 0.28, 14), m.bois, 0, h * 0.14));
      const bush = solid(new THREE.IcosahedronGeometry(w * 0.42, 1), m.feuillage, 0, h * 0.68);
      bush.scale.y = 1.25;
      group.add(bush);
      break;
    }
    case 'arbre': {
      parametric = true;
      group.add(solid(new THREE.CylinderGeometry(w * 0.06, w * 0.1, h * 0.45, 10), m.tronc, 0, h * 0.225));
      for (const [dx, dy, dz, scale] of [
        [0, 0.72, 0, 1],
        [0.22, 0.6, 0.12, 0.72],
        [-0.24, 0.62, -0.1, 0.66],
        [0.05, 0.86, -0.18, 0.6],
      ] as [number, number, number, number][]) {
        const blob = solid(new THREE.IcosahedronGeometry((w / 2) * 0.62 * scale, 1), m.feuillage, dx * w, dy * h, dz * d);
        group.add(blob);
      }
      break;
    }
    case 'haie': {
      parametric = true;
      const hedge = solid(box(1, 1, 1), m.feuillage, 0, h / 2);
      hedge.scale.set(w, h, d);
      group.add(hedge);
      break;
    }
    case 'tapis': {
      parametric = true;
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m.moquetteRouge);
      rug.rotation.x = -Math.PI / 2;
      rug.position.y = 0.012;
      rug.receiveShadow = true;
      group.add(rug);
      break;
    }
    case 'photobooth': {
      parametric = true;
      group.add(solid(box(w, h, d), m.noirMat, 0, h / 2));
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.85), m.moquetteRouge);
      curtain.position.set(0, h * 0.45, d / 2 + 0.01);
      group.add(curtain);
      break;
    }
    case 'panneau': {
      parametric = true;
      group.add(solid(cyl(0.03, h * 0.45, 8), m.metal, 0, h * 0.225));
      group.add(solid(box(w, h * 0.55, 0.05), m.peinture, 0, h * 0.72));
      break;
    }
    case 'brasero': {
      group.add(solid(new THREE.CylinderGeometry(0.4, 0.3, 0.45, 16), m.metal, 0, 0.3));
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.4, 10), emissive('#ff8a3d', 3.4));
      fire.position.y = 0.68;
      group.add(fire);
      const light = new THREE.PointLight(0xff8a3d, 6, 8, 2);
      light.position.y = 0.7;
      group.add(light);
      break;
    }
    case 'palissade': {
      parametric = true;
      const panels = Math.max(1, Math.round(w / 2));
      for (let index = 0; index < panels; index += 1) {
        group.add(solid(box(w / panels - 0.04, h, d), m.bois, -w / 2 + (w / panels) * (index + 0.5), h / 2));
      }
      break;
    }

    /* -------------------------------------------------- énergie & technique */
    case 'groupe-electrogene': {
      parametric = true;
      group.add(solid(box(w, h * 0.8, d), m.peinture, 0, h * 0.4 + 0.1));
      group.add(solid(box(w + 0.1, 0.12, d + 0.1), m.noirMat, 0, 0.06));
      group.add(solid(cyl(0.07, h * 0.35, 10), m.metal, w / 2 - 0.25, h * 0.95, -d / 2 + 0.2));
      for (let index = 0; index < 6; index += 1) {
        group.add(solid(box(w * 0.6, 0.02, 0.01), m.noirMat, 0, h * 0.35 + index * 0.06, d / 2 + 0.005));
      }
      break;
    }
    case 'coffret-electrique': {
      group.add(solid(box(0.6, 1.1, 0.4), m.peinture, 0, 0.55));
      group.add(solid(box(0.5, 0.3, 0.02), m.noirMat, 0, 0.75, 0.21));
      break;
    }
    case 'cable-ramp': {
      parametric = true;
      const ramp = solid(new THREE.CylinderGeometry(h * 1.6, h * 1.6, w, 12, 1, false, 0, Math.PI), m.noirMat, 0, 0);
      ramp.rotation.z = Math.PI / 2;
      ramp.scale.set(1, 1, 0.6);
      group.add(ramp);
      break;
    }
    case 'wc-mobile': {
      parametric = true;
      group.add(solid(roundedBox(w, h, d, 0.03), m.peintureFroide, 0, h / 2));
      group.add(solid(roundedBox(w * 0.52, h * 0.86, 0.04, 0.02), m.plastique, 0, (h * 0.86) / 2, d / 2 + 0.02));
      // Bandeau d'aeration et poignee : deux details qui suffisent a le lire.
      group.add(solid(box(w * 0.4, 0.05, 0.02), m.noirMat, 0, h * 0.9, d / 2 + 0.03));
      group.add(solid(cyl(0.02, 0.14, 8), m.metal, w * 0.16, h * 0.5, d / 2 + 0.06));
      break;
    }

    /* -------------------------------------------------- échelle & circulation */
    case 'person': {
      group.add(solid(PERSON_GEOMETRY(), m.foule));
      break;
    }
    case 'person-seated': {
      group.add(solid(cached('person_seated', () => personGeometry(true)), m.foule));
      break;
    }
    case 'camion': {
      parametric = true;
      group.add(solid(box(w, h * 0.62, d * 0.72), m.peinture, 0, h * 0.42, -d * 0.12));
      group.add(solid(box(w * 0.95, h * 0.4, d * 0.24), m.peinture, 0, h * 0.32, d / 2 - d * 0.12));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, h * 0.18), m.verre);
      glass.position.set(0, h * 0.42, d / 2 + 0.005);
      group.add(glass);
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const wheel = solid(new THREE.CylinderGeometry(h * 0.16, h * 0.16, 0.24, 16), m.noirMat, sx * (w / 2 - 0.05), h * 0.16, sz * (d / 2 - d * 0.2));
        wheel.rotation.z = Math.PI / 2;
        group.add(wheel);
      }
      break;
    }
    case 'voiture': {
      parametric = true;
      group.add(solid(box(w, h * 0.42, d), m.peinture, 0, h * 0.36));
      group.add(solid(box(w * 0.86, h * 0.34, d * 0.48), m.verre, 0, h * 0.72, -d * 0.04));
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const wheel = solid(new THREE.CylinderGeometry(h * 0.22, h * 0.22, 0.2, 16), m.noirMat, sx * (w / 2 - 0.02), h * 0.22, sz * (d / 2 - d * 0.22));
        wheel.rotation.z = Math.PI / 2;
        group.add(wheel);
      }
      break;
    }
    case 'palette': {
      group.add(solid(box(1.2, 0.15, 0.8), m.bois, 0, 0.075));
      break;
    }


      /* ----------------------------------------------------- son (variantes) */
      case 'console-compact':
      case 'light-desk': {
        group.add(solid(roundedBox(1.4, 0.75, 0.75, 0.02), m.noirMat, 0, 0.375));
        const top = solid(roundedBox(1.34, 0.08, 0.68, 0.015), m.plastique, 0, 0.79);
        top.rotation.x = -0.14;
        group.add(top);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.24), emissive('#2b6fc4', 1.6));
        screen.position.set(0, 0.96, -0.14);
        screen.rotation.x = -0.34;
        group.add(screen);
        break;
      }
      case 'hf-rack': {
        group.add(solid(roundedBox(0.6, 1.1, 0.7, 0.02), m.noirMat, 0, 0.55));
        for (let index = 0; index < 4; index += 1) {
          group.add(solid(box(0.52, 0.12, 0.02), m.metal, 0, 0.25 + index * 0.2, 0.351));
        }
        for (const side of [-1, 1]) {
          group.add(solid(cyl(0.006, 0.5, 6), m.metal, side * 0.2, 1.35, 0.3));
        }
        break;
      }

      /* ------------------------------------------------ lumière (variantes) */
      case 'fairy-lights': {
        parametric = true;
        const strands = Math.max(4, Math.round(w / 0.35));
        const material = emissive(color, 2.6);
        for (let index = 0; index < strands; index += 1) {
          const x = -w / 2 + (w / (strands - 1)) * index;
          const wire = new THREE.Mesh(cyl(0.004, h, 4), m.noirMat);
          wire.position.set(x, -h / 2, 0);
          group.add(wire);
          const bulbs = Math.max(3, Math.round(h / 0.35));
          for (let b = 0; b < bulbs; b += 1) {
            const bulb = new THREE.Mesh(cached('fairy_bulb', () => new THREE.SphereGeometry(0.022, 8, 6)), material);
            bulb.position.set(x, -(h / bulbs) * (b + 0.5), 0);
            group.add(bulb);
          }
        }
        break;
      }
      case 'mirror-ball': {
        parametric = true;
        const ball = solid(new THREE.IcosahedronGeometry(w / 2, 2), m.inox, 0, h / 2);
        group.add(ball);
        group.add(solid(cyl(0.012, h / 2, 6), m.metal, 0, h * 0.75));
        break;
      }

      /* --------------------------------------------- structure (variantes) */
      case 'stage-skirt': {
        parametric = true;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 20, 1), m.tissu);
        const position = cloth.geometry.attributes.position;
        for (let index = 0; index < position.count; index += 1) {
          position.setZ(index, Math.sin(position.getX(index) * 6) * 0.03);
        }
        cloth.geometry.computeVertexNormals();
        cloth.material = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.96, side: THREE.DoubleSide });
        cloth.position.y = h / 2;
        cloth.castShadow = true;
        group.add(cloth);
        break;
      }
      case 'dance-floor': {
        parametric = true;
        const cols = Math.max(1, Math.round(w));
        const rows = Math.max(1, Math.round(d));
        const light = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.22, metalness: 0.04 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.22, metalness: 0.04 });
        for (let cx = 0; cx < cols; cx += 1) {
          for (let cz = 0; cz < rows; cz += 1) {
            const tile = solid(
              box(w / cols - 0.01, h, d / rows - 0.01),
              (cx + cz) % 2 ? dark : light,
              -w / 2 + (w / cols) * (cx + 0.5),
              h / 2,
              -d / 2 + (d / rows) * (cz + 0.5),
            );
            group.add(tile);
          }
        }
        break;
      }

      /* ---------------------------------------------- mobilier (variantes) */
      case 'table-brasserie': {
        parametric = true;
        group.add(solid(roundedBox(w, 0.045, d, 0.008), m.boisClair, 0, h - 0.022));
        for (const side of [-1, 1]) {
          const leg = solid(box(0.06, h - 0.045, 0.06), m.metal, side * (w / 2 - 0.25), (h - 0.045) / 2, 0);
          leg.rotation.z = side * 0.06;
          group.add(leg);
          group.add(solid(box(0.05, 0.04, d * 0.8), m.metal, side * (w / 2 - 0.25), 0.03, 0));
        }
        break;
      }
      case 'banc-brasserie': {
        parametric = true;
        group.add(solid(roundedBox(w, 0.04, d, 0.008), m.boisClair, 0, h - 0.02));
        for (const side of [-1, 1]) {
          group.add(solid(box(0.05, h - 0.04, 0.05), m.metal, side * (w / 2 - 0.22), (h - 0.04) / 2, 0));
          group.add(solid(box(0.045, 0.03, d * 1.6), m.metal, side * (w / 2 - 0.22), 0.02, 0));
        }
        break;
      }
      case 'chaise-napoleon': {
        const clear = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.12,
          metalness: 0,
          transmission: 0.82,
          thickness: 0.2,
          ior: 1.5,
        });
        group.add(solid(roundedBox(0.4, 0.035, 0.4, 0.01), m.nappe, 0, 0.46));
        group.add(solid(roundedBox(0.4, 0.03, 0.4, 0.01), clear, 0, 0.44));
        const back = solid(roundedBox(0.4, 0.46, 0.03, 0.01), clear, 0, 0.7, -0.185);
        group.add(back);
        for (const [x, z] of [
          [-0.17, -0.16],
          [0.17, -0.16],
          [-0.17, 0.16],
          [0.17, 0.16],
        ]) {
          group.add(solid(post(0.016, 0.44), clear, x, 0.22, z));
        }
        break;
      }
      case 'transat': {
        const frame = m.boisClair;
        const cloth = new THREE.MeshStandardMaterial({ color: 0x2f5e86, roughness: 0.95 });
        const seat = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.25, 1, 6), cloth);
        seat.rotation.x = -0.72;
        seat.position.set(0, 0.5, 0.05);
        seat.castShadow = true;
        seat.material.side = THREE.DoubleSide;
        group.add(seat);
        for (const side of [-1, 1]) {
          const rail = solid(post(0.022, 1.35), frame, side * 0.3, 0.5, 0.05);
          rail.rotation.x = 0.72;
          group.add(rail);
          const leg = solid(post(0.022, 0.85), frame, side * 0.3, 0.36, -0.3);
          leg.rotation.x = -0.5;
          group.add(leg);
        }
        break;
      }

      /* ------------------------------------------------- bar & restauration */
      case 'pompe-biere': {
        group.add(solid(roundedBox(0.4, 0.42, 0.45, 0.03), m.inox, 0, 0.21));
        for (const side of [-1, 1]) {
          const column = solid(cyl(0.035, 0.28, 12), m.inox, side * 0.09, 0.56);
          group.add(column);
          const tap = solid(cyl(0.018, 0.12, 8), m.inox, side * 0.09, 0.66, 0.09);
          tap.rotation.x = Math.PI / 2;
          group.add(tap);
          const handle = solid(cyl(0.014, 0.1, 8), m.noirMat, side * 0.09, 0.74, 0.09);
          handle.rotation.x = 0.5;
          group.add(handle);
        }
        const drip = solid(box(0.34, 0.02, 0.16), m.inox, 0, 0.43, 0.14);
        group.add(drip);
        break;
      }
      case 'fut-biere': {
        const keg = solid(new THREE.CylinderGeometry(0.19, 0.19, 0.5, 20), m.inox, 0, 0.3);
        group.add(keg);
        group.add(solid(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 20), m.inox, 0, 0.03));
        group.add(solid(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 20), m.inox, 0, 0.57));
        group.add(solid(cyl(0.05, 0.06, 12), m.noirMat, 0, 0.62));
        break;
      }
      case 'frigo-boissons': {
        parametric = true;
        group.add(solid(roundedBox(w, h, d, 0.02), m.peinture, 0, h / 2));
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.82, h * 0.74), m.verre);
        glass.position.set(0, h * 0.55, d / 2 + 0.006);
        group.add(glass);
        const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.6 });
        for (let index = 1; index <= 4; index += 1) {
          const bottles = new THREE.Mesh(box(w * 0.78, 0.02, d * 0.6), shelfMaterial);
          bottles.position.set(0, (h * 0.16) * index + h * 0.16, 0);
          group.add(bottles);
        }
        group.add(solid(box(w * 0.9, 0.05, 0.02), m.noirMat, 0, h * 0.94, d / 2 + 0.01));
        break;
      }
      case 'congelateur': {
        parametric = true;
        group.add(solid(roundedBox(w, h, d, 0.025), m.peinture, 0, h / 2));
        group.add(solid(roundedBox(w * 0.98, 0.06, d * 0.98, 0.02), m.peinture, 0, h + 0.02));
        group.add(solid(box(w * 0.4, 0.03, 0.04), m.metal, 0, h + 0.04, d / 2 - 0.02));
        break;
      }
      case 'chambre-froide': {
        parametric = true;
        const panel = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.55, metalness: 0.15 });
        group.add(solid(roundedBox(w, h, d, 0.03), panel, 0, h / 2));
        group.add(solid(roundedBox(w * 0.4, h * 0.85, 0.06, 0.02), m.peinture, 0, (h * 0.85) / 2, d / 2 + 0.02));
        group.add(solid(cyl(0.03, 0.3, 8), m.inox, w * 0.08, h * 0.45, d / 2 + 0.07));
        group.add(solid(roundedBox(w * 0.5, 0.32, 0.35, 0.02), m.metal, 0, h - 0.28, -d / 2 + 0.2));
        break;
      }
      case 'machine-glacons': {
        parametric = true;
        group.add(solid(roundedBox(w, h, d, 0.02), m.inox, 0, h / 2));
        group.add(solid(box(w * 0.7, 0.04, 0.02), m.noirMat, 0, h * 0.55, d / 2 + 0.005));
        break;
      }
      case 'plancha': {
        parametric = true;
        group.add(solid(roundedBox(w * 0.92, h * 0.72, d * 0.9, 0.02), m.inox, 0, h * 0.36));
        const plate = solid(box(w * 0.86, 0.04, d * 0.72), m.noirMat, 0, h * 0.74);
        group.add(plate);
        group.add(solid(box(w * 0.9, 0.05, 0.04), m.inox, 0, h * 0.8, d * 0.4));
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          group.add(solid(cyl(0.05, 0.08, 10), m.noirMat, sx * (w / 2 - 0.12), 0.04, sz * (d / 2 - 0.12)));
        }
        break;
      }
      case 'friteuse': {
        parametric = true;
        group.add(solid(roundedBox(w, h * 0.6, d, 0.02), m.noirMat, 0, h * 0.3));
        for (const side of [-1, 1]) {
          group.add(solid(box(w * 0.4, h * 0.32, d * 0.72), m.inox, side * w * 0.24, h * 0.76));
          group.add(solid(cyl(0.014, 0.2, 6), m.noirMat, side * w * 0.24, h * 0.98, d * 0.3));
        }
        break;
      }
      case 'four-pizza': {
        parametric = true;
        const dome = solid(new THREE.SphereGeometry(w * 0.45, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.peinture, 0, h * 0.52);
        group.add(dome);
        group.add(solid(roundedBox(w, h * 0.5, d, 0.02), m.noirMat, 0, h * 0.26));
        group.add(solid(new THREE.TorusGeometry(w * 0.16, 0.03, 8, 18), m.metal, 0, h * 0.62, d * 0.38));
        group.add(solid(cyl(0.06, h * 0.4, 10), m.metal, w * 0.22, h * 0.92, -d * 0.2));
        for (const side of [-1, 1]) {
          const wheel = solid(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), m.noirMat, side * (w / 2 - 0.08), 0.09, d * 0.3);
          wheel.rotation.z = Math.PI / 2;
          group.add(wheel);
        }
        break;
      }
      case 'percolateur': {
        group.add(solid(new THREE.CylinderGeometry(0.16, 0.17, 0.5, 18), m.inox, 0, 0.25));
        group.add(solid(new THREE.CylinderGeometry(0.17, 0.16, 0.06, 18), m.noirMat, 0, 0.53));
        const tap = solid(cyl(0.014, 0.09, 8), m.inox, 0, 0.12, 0.15);
        tap.rotation.x = Math.PI / 2;
        group.add(tap);
        break;
      }
      case 'machine-granite': {
        parametric = true;
        group.add(solid(roundedBox(w, h * 0.35, d, 0.02), m.inox, 0, h * 0.175));
        const bowl = new THREE.MeshPhysicalMaterial({
          color: 0xff8fb0,
          roughness: 0.1,
          transmission: 0.7,
          thickness: 0.15,
          ior: 1.45,
        });
        for (let index = 0; index < 3; index += 1) {
          const tank = solid(roundedBox(w * 0.28, h * 0.55, d * 0.7, 0.04), bowl, (index - 1) * w * 0.32, h * 0.63);
          group.add(tank);
        }
        break;
      }
      case 'plonge': {
        parametric = true;
        group.add(solid(roundedBox(w, 0.05, d, 0.01), m.inox, 0, h - 0.025));
        for (const side of [-1, 0.35]) {
          group.add(solid(box(w * 0.34, 0.22, d * 0.6), m.metal, side * w * 0.24, h - 0.14));
        }
        const tap = solid(cyl(0.018, 0.35, 8), m.inox, 0, h + 0.17, -d * 0.32);
        group.add(tap);
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          group.add(solid(post(0.02, h - 0.05), m.inox, sx * (w / 2 - 0.06), (h - 0.05) / 2, sz * (d / 2 - 0.06)));
        }
        break;
      }
      case 'table-inox': {
        parametric = true;
        group.add(solid(roundedBox(w, 0.04, d, 0.01), m.inox, 0, h - 0.02));
        group.add(solid(box(w * 0.92, 0.03, d * 0.8), m.inox, 0, h * 0.28));
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          group.add(solid(post(0.02, h - 0.04), m.inox, sx * (w / 2 - 0.06), (h - 0.04) / 2, sz * (d / 2 - 0.06)));
        }
        break;
      }
      case 'caisse': {
        group.add(solid(roundedBox(0.36, 0.04, 0.3, 0.01), m.noirMat, 0, 0.02));
        const screen = solid(roundedBox(0.32, 0.22, 0.02, 0.01), m.noirMat, 0, 0.2, -0.04);
        screen.rotation.x = -0.25;
        group.add(screen);
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.18), emissive('#3987e5', 1.4));
        face.position.set(0, 0.2, -0.026);
        face.rotation.x = -0.25;
        group.add(face);
        group.add(solid(roundedBox(0.12, 0.06, 0.16, 0.01), m.peinture, 0.22, 0.03, 0.05));
        break;
      }
      case 'foodtruck': {
        parametric = true;
        group.add(solid(roundedBox(w, h * 0.62, d, 0.06), m.peinture, 0, h * 0.42));
        // Comptoir ouvert sur le cote long.
        const opening = new THREE.Mesh(new THREE.PlaneGeometry(d * 0.6, h * 0.3), emissive('#f5e2b8', 0.5));
        opening.position.set(w / 2 + 0.005, h * 0.52, 0);
        opening.rotation.y = Math.PI / 2;
        group.add(opening);
        const awning = solid(box(0.9, 0.04, d * 0.62), m.toile, w / 2 + 0.42, h * 0.78, 0);
        awning.rotation.z = -0.28;
        group.add(awning);
        group.add(solid(box(w * 0.9, 0.12, 0.3), m.noirMat, 0, 0.06, -d / 2 + 0.4));
        for (const sz of [-1, 1]) {
          const wheel = solid(new THREE.CylinderGeometry(h * 0.14, h * 0.14, 0.2, 16), m.noirMat, w / 2 - 0.02, h * 0.14, sz * d * 0.3);
          wheel.rotation.z = Math.PI / 2;
          group.add(wheel);
          const wheel2 = wheel.clone();
          wheel2.position.x = -w / 2 + 0.02;
          group.add(wheel2);
        }
        group.add(solid(cyl(0.04, 0.5, 8), m.metal, 0, 0.25, d / 2 + 0.25));
        break;
      }

      /* -------------------------------------------- sanitaires & confort */
      case 'wc-pmr': {
        parametric = true;
        group.add(solid(roundedBox(w, h, d, 0.03), m.peintureFroide, 0, h / 2));
        group.add(solid(roundedBox(w * 0.5, h * 0.85, 0.04, 0.02), m.plastique, 0, (h * 0.85) / 2, d / 2 + 0.02));
        const ramp = solid(box(w * 0.8, 0.05, 0.9), m.metal, 0, 0.12, d / 2 + 0.45);
        ramp.rotation.x = 0.14;
        group.add(ramp);
        break;
      }
      case 'bloc-lavabo': {
        parametric = true;
        group.add(solid(roundedBox(w, h * 0.75, d, 0.02), m.peinture, 0, h * 0.375));
        group.add(solid(roundedBox(w * 0.96, 0.05, d * 0.9, 0.015), m.inox, 0, h * 0.77));
        for (let index = 0; index < 2; index += 1) {
          const basin = solid(new THREE.CylinderGeometry(0.14, 0.11, 0.1, 16), m.inox, (index - 0.5) * w * 0.42, h * 0.76);
          group.add(basin);
          group.add(solid(cyl(0.014, 0.22, 8), m.inox, (index - 0.5) * w * 0.42, h * 0.9, -d * 0.28));
        }
        break;
      }
      case 'parasol-chauffant': {
        group.add(solid(new THREE.CylinderGeometry(0.28, 0.32, 0.55, 16), m.inox, 0, 0.275));
        group.add(solid(cyl(0.04, 1.3, 10), m.inox, 0, 1.2));
        group.add(solid(new THREE.CylinderGeometry(0.14, 0.22, 0.35, 16), m.inox, 0, 1.9));
        const reflector = solid(new THREE.ConeGeometry(0.45, 0.2, 18, 1, true), m.inox, 0, 2.1);
        group.add(reflector);
        const glow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), emissive('#ff8a3d', 2.4));
        glow.position.y = 1.99;
        glow.rotation.x = Math.PI / 2;
        group.add(glow);
        const light = new THREE.PointLight(0xff8a3d, 4, 7, 2);
        light.position.y = 1.95;
        group.add(light);
        break;
      }
      case 'chauffage-air-pulse': {
        parametric = true;
        const body = solid(new THREE.CylinderGeometry(h * 0.35, h * 0.35, w, 18), m.peinture, 0, h * 0.45);
        body.rotation.z = Math.PI / 2;
        group.add(body);
        group.add(solid(box(w * 0.9, 0.1, d * 0.7), m.noirMat, 0, 0.05));
        group.add(solid(new THREE.TorusGeometry(h * 0.3, 0.04, 8, 16), m.metal, w / 2, h * 0.45, 0));
        break;
      }

      /* ---------------------------------------------- logistique & stockage */
      case 'malle': {
        parametric = true;
        group.add(solid(roundedBox(w, h * 0.8, d, 0.02), m.plastique, 0, h * 0.4));
        group.add(solid(roundedBox(w * 1.02, h * 0.2, d * 1.02, 0.02), m.noirMat, 0, h * 0.9));
        break;
      }
      case 'container-stockage': {
        parametric = true;
        const corten = m.corten;
        group.add(solid(box(w, h, d), corten, 0, h / 2));
        const rib = new THREE.MeshStandardMaterial({ color: 0x27506a, roughness: 0.78, metalness: 0.32 });
        const ribs = Math.round(d / 0.3);
        for (let index = 0; index < ribs; index += 1) {
          const z = -d / 2 + (d / ribs) * (index + 0.5);
          group.add(solid(box(w + 0.03, h * 0.9, 0.06), rib, 0, h / 2, z));
        }
        group.add(solid(box(w * 0.98, h * 0.94, 0.05), m.noirMat, 0, h / 2, d / 2 + 0.02));
        for (const side of [-1, 1]) group.add(solid(cyl(0.03, h * 0.8, 8), m.metal, side * w * 0.2, h / 2, d / 2 + 0.06));
        break;
      }
      case 'remorque': {
        parametric = true;
        const tarp = new THREE.MeshStandardMaterial({ color: 0x39424c, roughness: 0.92, metalness: 0.02 });
        group.add(solid(roundedBox(w, h * 0.68, d, 0.04), tarp, 0, h * 0.5));
        group.add(solid(box(w * 0.96, 0.1, d), m.metal, 0, h * 0.14));
        const draw = solid(box(0.08, 0.08, 0.9), m.metal, 0, h * 0.14, d / 2 + 0.45);
        group.add(draw);
        for (const side of [-1, 1]) {
          const wheel = solid(new THREE.CylinderGeometry(0.28, 0.28, 0.16, 16), m.noirMat, side * (w / 2 + 0.02), 0.28, 0);
          wheel.rotation.z = Math.PI / 2;
          group.add(wheel);
        }
        break;
      }
      case 'diable': {
        group.add(solid(box(0.5, 1.2, 0.04), m.metal, 0, 0.62, -0.02));
        group.add(solid(box(0.5, 0.04, 0.28), m.metal, 0, 0.06, 0.14));
        for (const side of [-1, 1]) {
          group.add(solid(post(0.018, 1.2), m.metal, side * 0.22, 0.62, 0));
          const wheel = solid(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14), m.noirMat, side * 0.24, 0.11, -0.02);
          wheel.rotation.z = Math.PI / 2;
          group.add(wheel);
        }
        break;
      }

      /* ------------------------------------------- sécurité & signalétique */
      case 'barriere-mojo': {
        parametric = true;
        const units = Math.max(1, Math.round(w / 1.2));
        for (let index = 0; index < units; index += 1) {
          const x = -w / 2 + (w / units) * (index + 0.5);
          const unit = new THREE.Group();
          unit.position.x = x;
          const uw = w / units - 0.02;
          unit.add(solid(box(uw, h * 0.85, 0.05), m.alu, 0, h * 0.5, -d / 2 + 0.05));
          unit.add(solid(box(uw, 0.05, d * 0.55), m.alu, 0, 0.03, d * 0.1));
          const brace = solid(box(0.05, h * 0.9, 0.05), m.alu, 0, h * 0.45, -d / 2 + 0.3);
          brace.rotation.x = -0.5;
          unit.add(brace);
          const top = solid(cyl(0.03, uw, 10), m.alu, 0, h * 0.92, -d / 2 + 0.05);
          top.rotation.z = Math.PI / 2;
          unit.add(top);
          group.add(unit);
        }
        break;
      }
      case 'plot-balisage': {
        const cone = solid(new THREE.ConeGeometry(0.16, 0.68, 16), new THREE.MeshStandardMaterial({ color: 0xe8531f, roughness: 0.7 }), 0, 0.38);
        group.add(cone);
        group.add(solid(box(0.34, 0.04, 0.34), m.noirMat, 0, 0.02));
        const band = solid(new THREE.CylinderGeometry(0.11, 0.13, 0.09, 16), m.nappe, 0, 0.4);
        group.add(band);
        break;
      }
      case 'extincteur': {
        group.add(solid(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 16), new THREE.MeshStandardMaterial({ color: 0xc02020, roughness: 0.42, metalness: 0.2 }), 0, 0.32));
        group.add(solid(cyl(0.03, 0.08, 10), m.noirMat, 0, 0.61));
        group.add(solid(box(0.02, 0.9, 0.02), m.metal, 0, 0.45, -0.1));
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), emissive('#c02020', 0.6));
        sign.position.set(0, 1.05, -0.1);
        group.add(sign);
        break;
      }
      case 'bloc-secours': {
        group.add(solid(roundedBox(0.4, 0.2, 0.06, 0.01), m.peinture, 0, 0.1));
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.15), emissive('#1fa64a', 2.2));
        face.position.set(0, 0.1, 0.032);
        group.add(face);
        break;
      }

      /* -------------------------------------------------- abris (variantes) */
      case 'auvent-bar': {
        parametric = true;
        const roof = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m.toile);
        roof.rotation.x = -Math.PI / 2 + 0.18;
        roof.position.y = h;
        roof.castShadow = true;
        roof.receiveShadow = true;
        group.add(roof);
        for (const sx of [-1, 1]) {
          group.add(solid(post(0.035, h), m.metal, (sx * w) / 2, h / 2, d / 2 - 0.1));
          group.add(solid(post(0.035, h * 0.9), m.metal, (sx * w) / 2, (h * 0.9) / 2, -d / 2 + 0.1));
        }
        break;
      }

      /* --------------------------------------------------- décor (variantes) */
      case 'fanions': {
        parametric = true;
        const span = w;
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-span / 2, 0, 0),
          new THREE.Vector3(0, -Math.min(0.5, span * 0.05), 0),
          new THREE.Vector3(span / 2, 0, 0),
        ]);
        group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.008, 5, false), m.noirMat));
        const palette = ['#e34948', '#eda100', '#1baf7a', '#2a78d6', '#e87ba4'];
        const count = Math.max(6, Math.round(span / 0.4));
        for (let index = 0; index < count; index += 1) {
          const point = curve.getPoint((index + 0.5) / count);
          const flag = new THREE.Mesh(
            cached('fanion', () => {
              const shape = new THREE.Shape();
              shape.moveTo(-0.11, 0);
              shape.lineTo(0.11, 0);
              shape.lineTo(0, -0.26);
              shape.lineTo(-0.11, 0);
              return new THREE.ShapeGeometry(shape);
            }),
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(palette[index % palette.length]),
              roughness: 0.94,
              side: THREE.DoubleSide,
            }),
          );
          flag.position.copy(point);
          flag.rotation.y = (index % 2 ? 0.25 : -0.25);
          group.add(flag);
        }
        break;
      }

    default: {
      parametric = true;
      const generic = solid(box(1, 1, 1), m.plastique, 0, h / 2);
      generic.scale.set(w, h, d);
      group.add(generic);
    }
  }

  return { object: group, parametric };
}

export { objectDef };
export type { ObjectDef };
