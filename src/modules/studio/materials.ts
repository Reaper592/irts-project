/**
 * Materiaux et textures procedurales du Studio.
 *
 * Aucun asset externe : tout est peint dans un canvas au chargement. Cela
 * garde l'application autonome — elle fonctionne hors ligne, sur le reseau
 * local — tout en donnant aux surfaces le grain qui separe une maquette
 * credible d'un empilement de boites colorees.
 */
import * as THREE from 'three';

type Painter = (ctx: CanvasRenderingContext2D, size: number) => void;

const CACHE = new Map<string, THREE.CanvasTexture>();

function canvasTexture(key: string, size: number, paint: Painter, repeat: [number, number]): THREE.CanvasTexture {
  const cached = CACHE.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, size);
  SOURCES.set(key, canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.userData.shared = true;
  CACHE.set(key, texture);
  return texture;
}


/**
 * Taches larges et douces, superposees a la texture fine.
 *
 * Une texture carrelee se trahit par sa repetition : c'est la variation a
 * grande echelle — des zones un peu plus claires, un peu plus sombres — qui
 * fait qu'un sol reel ne se lit pas comme un damier.
 */
function macroVariation(ctx: CanvasRenderingContext2D, size: number, amount: number, count = 26) {
  ctx.save();
  for (let index = 0; index < count; index += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = size * (0.12 + Math.random() * 0.3);
    const light = Math.random() > 0.5;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const tint = light ? 255 : 0;
    gradient.addColorStop(0, `rgba(${tint},${tint},${tint},${amount})`);
    gradient.addColorStop(1, `rgba(${tint},${tint},${tint},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Carte de rugosite deduite de la texture : les zones sombres d'un sol sont
 * generalement les plus humides et les plus lisses. Sans variation de
 * rugosite, une surface renvoie la lumiere de maniere uniforme et parait
 * plastique.
 */
function roughnessFrom(key: string, source: HTMLCanvasElement, base: number, spread: number): THREE.CanvasTexture {
  const cached = ROUGHNESS.get(key);
  if (cached) return cached;
  const size = source.width;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, size, size);
  for (let index = 0; index < image.data.length; index += 4) {
    const luminance =
      (image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114) / 255;
    const value = clamp((base + (luminance - 0.5) * spread) * 255);
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.userData.shared = true;
  ROUGHNESS.set(key, texture);
  return texture;
}

const ROUGHNESS = new Map<string, THREE.CanvasTexture>();
const SOURCES = new Map<string, HTMLCanvasElement>();

function grain(ctx: CanvasRenderingContext2D, size: number, amount: number) {
  const image = ctx.getImageData(0, 0, size, size);
  for (let index = 0; index < image.data.length; index += 4) {
    const noise = (Math.random() - 0.5) * amount;
    image.data[index] = clamp(image.data[index] + noise);
    image.data[index + 1] = clamp(image.data[index + 1] + noise);
    image.data[index + 2] = clamp(image.data[index + 2] + noise);
  }
  ctx.putImageData(image, 0, 0);
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, value));
}

function fill(ctx: CanvasRenderingContext2D, size: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
}

/* ------------------------------------------------------------------- sols */

/** Emprise de reference des cadences de texture, en metres. */
const REFERENCE_SPAN = 34;

const GROUND_PAINTERS: Record<string, { paint: Painter; repeat: number; roughness: number; metalness: number }> = {
  herbe: {
    repeat: 26,
    roughness: 0.94,
    metalness: 0,
    paint: (ctx, size) => {
      fill(ctx, size, '#3b5529');
      // Touffes : des paquets d'herbe plutot qu'un semis regulier.
      for (let clump = 0; clump < 220; clump += 1) {
        const cx = Math.random() * size;
        const cy = Math.random() * size;
        const spread = 6 + Math.random() * 16;
        const hue = 88 + Math.random() * 26;
        const light = 22 + Math.random() * 20;
        for (let blade = 0; blade < 26; blade += 1) {
          const x = cx + (Math.random() - 0.5) * spread;
          const y = cy + (Math.random() - 0.5) * spread;
          ctx.strokeStyle = `hsla(${hue}, ${34 + Math.random() * 22}%, ${light + Math.random() * 14}%, 0.75)`;
          ctx.lineWidth = 0.8 + Math.random() * 0.8;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(
            x + (Math.random() - 0.5) * 3,
            y - 3 - Math.random() * 4,
            x + (Math.random() - 0.5) * 6,
            y - 5 - Math.random() * 7,
          );
          ctx.stroke();
        }
      }
      macroVariation(ctx, size, 0.05, 30);
      grain(ctx, size, 14);
    },
  },
  'gazon-tondu': {
    repeat: 18,
    roughness: 0.9,
    metalness: 0,
    paint: (ctx, size) => {
      fill(ctx, size, '#476730');
      const band = size / 8;
      for (let y = 0; y < size; y += band) {
        ctx.fillStyle = (y / band) % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.07)';
        ctx.fillRect(0, y, size, band);
      }
      for (let index = 0; index < 9000; index += 1) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.strokeStyle = `hsla(${92 + Math.random() * 20}, 32%, ${24 + Math.random() * 16}%, 0.5)`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 2, y - 2 - Math.random() * 3);
        ctx.stroke();
      }
      macroVariation(ctx, size, 0.045, 22);
      grain(ctx, size, 10);
    },
  },
  terre: {
    repeat: 30,
    roughness: 0.98,
    metalness: 0,
    paint: (ctx, size) => {
      fill(ctx, size, '#6b5237');
      for (let index = 0; index < 900; index += 1) {
        ctx.fillStyle = `rgba(${90 + Math.random() * 50},${70 + Math.random() * 40},${45 + Math.random() * 30},0.5)`;
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      grain(ctx, size, 26);
    },
  },
  sable: {
    repeat: 34,
    roughness: 0.96,
    metalness: 0,
    paint: (ctx, size) => {
      fill(ctx, size, '#a48a5e');
      for (let index = 0; index < 260; index += 1) {
        // Ondulations laissees par le vent.
        ctx.strokeStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.04})`;
        ctx.lineWidth = 2 + Math.random() * 5;
        const y = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(size / 3, y + 10, (size * 2) / 3, y - 10, size, y);
        ctx.stroke();
      }
      macroVariation(ctx, size, 0.09, 20);
      grain(ctx, size, 26);
    },
  },
  bitume: {
    repeat: 24,
    roughness: 0.82,
    metalness: 0.04,
    paint: (ctx, size) => {
      fill(ctx, size, '#2f3236');
      for (let index = 0; index < 9000; index += 1) {
        ctx.fillStyle = `rgba(${140 + Math.random() * 70},${140 + Math.random() * 70},${145 + Math.random() * 70},0.13)`;
        ctx.fillRect(Math.random() * size, Math.random() * size, 1.6, 1.6);
      }
      macroVariation(ctx, size, 0.1, 20);
      grain(ctx, size, 12);
    },
  },
  beton: {
    repeat: 18,
    roughness: 0.72,
    metalness: 0.03,
    paint: (ctx, size) => {
      fill(ctx, size, '#6d7178');
      for (let index = 0; index < 70; index += 1) {
        ctx.strokeStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.05})`;
        ctx.lineWidth = 1 + Math.random() * 2.5;
        ctx.beginPath();
        ctx.moveTo(Math.random() * size, Math.random() * size);
        ctx.lineTo(Math.random() * size, Math.random() * size);
        ctx.stroke();
      }
      // Variation legere : une dalle beton n'est pas marbree.
      macroVariation(ctx, size, 0.035, 18);
      grain(ctx, size, 12);
    },
  },
  parquet: {
    repeat: 16,
    roughness: 0.42,
    metalness: 0.02,
    paint: (ctx, size) => {
      const plank = size / 8;
      for (let row = 0; row < 8; row += 1) {
        const offset = (row % 2) * plank * 1.5;
        for (let column = -1; column < 4; column += 1) {
          const x = column * plank * 2 + offset;
          const tone = 105 + Math.random() * 34;
          ctx.fillStyle = `rgb(${tone},${tone * 0.66},${tone * 0.4})`;
          ctx.fillRect(x, row * plank, plank * 2 - 2, plank - 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.28)';
          ctx.strokeRect(x, row * plank, plank * 2 - 2, plank - 2);
        }
      }
      grain(ctx, size, 12);
    },
  },
  moquette: {
    repeat: 30,
    roughness: 0.98,
    metalness: 0,
    paint: (ctx, size) => {
      fill(ctx, size, '#3a3129');
      for (let index = 0; index < 26000; index += 1) {
        ctx.fillStyle = `rgba(${90 + Math.random() * 60},${78 + Math.random() * 50},${64 + Math.random() * 44},0.08)`;
        ctx.fillRect(Math.random() * size, Math.random() * size, 1.3, 1.3);
      }
      macroVariation(ctx, size, 0.06, 16);
      grain(ctx, size, 16);
    },
  },
  carrelage: {
    repeat: 20,
    roughness: 0.28,
    metalness: 0.05,
    paint: (ctx, size) => {
      fill(ctx, size, '#8e9096');
      const tile = size / 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 3;
      for (let index = 0; index <= 4; index += 1) {
        ctx.beginPath();
        ctx.moveTo(index * tile, 0);
        ctx.lineTo(index * tile, size);
        ctx.moveTo(0, index * tile);
        ctx.lineTo(size, index * tile);
        ctx.stroke();
      }
      grain(ctx, size, 10);
    },
  },
  gravier: {
    repeat: 32,
    roughness: 0.94,
    metalness: 0,
    paint: (ctx, size) => {
      fill(ctx, size, '#6a6862');
      for (let index = 0; index < 7000; index += 1) {
        const tone = 90 + Math.random() * 90;
        ctx.fillStyle = `rgb(${tone},${tone - 4},${tone - 12})`;
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, 1.4 + Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      macroVariation(ctx, size, 0.08, 18);
      grain(ctx, size, 14);
    },
  },
};

/**
 * Materiau de sol a densite de texture constante, quelle que soit la geometrie.
 *
 * `uvSpan` est le nombre de metres couverts par une unite d'UV. Les deux
 * conventions de three.js coexistent dans la scene et n'ont rien a voir :
 * `PlaneGeometry` normalise ses UV entre 0 et 1 — un plan de 800 m a donc
 * uvSpan = 800 — tandis que `ShapeGeometry` et `ExtrudeGeometry` emettent des
 * UV exprimes directement en coordonnees monde, soit uvSpan = 1. Appliquer la
 * meme cadence aux deux donne une emprise texturee des centaines de fois plus
 * fin que ses abords : le sol se lit alors comme un rectangle plus sombre
 * pose sur le terrain, parce qu'un relief aussi serre assombrit la surface.
 */
export function groundMaterial(
  kind: string,
  tint: string,
  nightFactor: number,
  uvSpan = REFERENCE_SPAN,
): THREE.MeshStandardMaterial {
  const config = GROUND_PAINTERS[kind] ?? GROUND_PAINTERS.beton;
  const key = `sol_${kind}`;
  const base = canvasTexture(key, 1024, config.paint, [config.repeat, config.repeat]);
  const source = SOURCES.get(key)!;
  // Cote de la tuile en metres, deduite de la cadence de reference.
  const tile = REFERENCE_SPAN / config.repeat;
  const tiles = Math.max(0.05, uvSpan / tile);

  // Chaque plan a sa propre cadence : on clone plutot que de modifier la
  // texture partagee du cache, sinon le dernier appelant impose la sienne.
  const texture = base.clone();
  // `Texture.clone()` recopie aussi `userData` : sans cette remise a zero, le
  // clone herite de la marque « partagee » de sa source et echappe au
  // nettoyage, alors qu'il est fabrique pour cette construction seulement.
  texture.userData = {};
  texture.repeat.set(tiles, tiles);
  // Repetition en miroir : les motifs peints dans le canvas sont coupes net a
  // ses bords, et une repetition simple aligne ces coupures en une grille
  // parfaitement lisible sur une grande surface. Le miroir fait coincider les
  // bords exactement ; la symetrie qui en resulte est cassee par la variation
  // basse frequence en espace monde.
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.needsUpdate = true;

  const roughness = roughnessFrom(`${key}_r`, source, config.roughness, 0.35).clone();
  roughness.userData = {};
  roughness.repeat.set(tiles, tiles);
  roughness.wrapS = THREE.MirroredRepeatWrapping;
  roughness.wrapT = THREE.MirroredRepeatWrapping;
  roughness.needsUpdate = true;

  texture.anisotropy = 16;
  roughness.anisotropy = 16;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: texture,
    bumpScale: 0.3,
    roughnessMap: roughness,
    roughness: 1,
    metalness: config.metalness,
    color: new THREE.Color(tint).multiplyScalar(nightFactor),
  });
  applyMacroBreakup(material, BREAKUP[kind] ?? 0.4);
  return material;
}

/**
 * Rupture du carrelage par bruit en espace monde.
 *
 * Une texture repetee des centaines de fois se lit comme un damier, quel que
 * soit son grain : l'oeil detecte la periodicite avant le detail. Les moteurs
 * temps reel resolvent cela en modulant l'albedo par un bruit basse frequence
 * independant des UV. Deux octaves — une vingtaine et une soixantaine de
 * metres — suffisent a faire disparaitre la grille sans salir la couleur.
 */
/**
 * Amplitude de la rupture, par nature de sol.
 *
 * Une pelouse ou une terre battue varient beaucoup d'un metre a l'autre ; une
 * dalle beton, un bitume ou un parquet non. Appliquer la meme amplitude a
 * tous donne a une surface manufacturee un aspect de camouflage.
 */
const BREAKUP: Record<string, number> = {
  herbe: 0.42,
  'gazon-tondu': 0.34,
  terre: 0.44,
  sable: 0.36,
  gravier: 0.3,
  beton: 0.14,
  bitume: 0.12,
  parquet: 0.08,
  moquette: 0.1,
  dalle: 0.1,
};

function applyMacroBreakup(material: THREE.MeshStandardMaterial, amount: number) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvMacroPos = (modelMatrix * vec4(position, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vMacroPos;
        float macroHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float macroNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = macroHash(i);
          float b = macroHash(i + vec2(1.0, 0.0));
          float c = macroHash(i + vec2(0.0, 1.0));
          float d = macroHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float macro = macroNoise(vMacroPos.xz * 0.055) * 0.6 + macroNoise(vMacroPos.xz * 0.017) * 0.4;
        diffuseColor.rgb *= ${(1 - amount / 2).toFixed(3)} + macro * ${amount.toFixed(3)};`,
      );
  };
  // Deux materiaux au shader different ne doivent pas partager un programme.
  material.customProgramCacheKey = () => `macro-breakup-${amount.toFixed(3)}`;
}

/* ------------------------------------------------------------- materiaux */

export interface StudioMaterials {
  caisson: THREE.MeshStandardMaterial;
  grille: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  alu: THREE.MeshStandardMaterial;
  noirMat: THREE.MeshStandardMaterial;
  plastique: THREE.MeshStandardMaterial;
  bois: THREE.MeshStandardMaterial;
  boisClair: THREE.MeshStandardMaterial;
  nappe: THREE.MeshStandardMaterial;
  peintureFroide: THREE.MeshStandardMaterial;
  corten: THREE.MeshStandardMaterial;
  tissu: THREE.MeshStandardMaterial;
  toile: THREE.MeshStandardMaterial;
  verre: THREE.MeshPhysicalMaterial;
  lentille: THREE.MeshStandardMaterial;
  foule: THREE.MeshStandardMaterial;
  feuillage: THREE.MeshStandardMaterial;
  tronc: THREE.MeshStandardMaterial;
  moquetteRouge: THREE.MeshStandardMaterial;
  peinture: THREE.MeshStandardMaterial;
  inox: THREE.MeshStandardMaterial;
}

/**
 * Materiaux durables du Studio : construits une fois pour la duree de vie du
 * moteur, ils sont marques partages pour survivre au nettoyage qui suit
 * chaque reconstruction de scene.
 */
export function createMaterials(): StudioMaterials {
  const grille = canvasTexture(
    'grille',
    64,
    (ctx, size) => {
      fill(ctx, size, '#0b0d10');
      ctx.fillStyle = '#22262d';
      for (let y = 2; y < size; y += 5) {
        for (let x = 2; x < size; x += 5) {
          ctx.beginPath();
          ctx.arc(x + ((y / 5) % 2) * 2.5, y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    [4, 3],
  );

  const bois = canvasTexture(
    'bois',
    256,
    (ctx, size) => {
      fill(ctx, size, '#6b4a2f');
      for (let index = 0; index < 60; index += 1) {
        ctx.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.12})`;
        ctx.lineWidth = 1 + Math.random() * 3;
        ctx.beginPath();
        const y = Math.random() * size;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(size / 3, y + 8, (size * 2) / 3, y - 8, size, y);
        ctx.stroke();
      }
      grain(ctx, size, 12);
    },
    [2, 2],
  );

  const tissu = canvasTexture(
    'tissu',
    128,
    (ctx, size) => {
      fill(ctx, size, '#8d8f96');
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      for (let index = 0; index < size; index += 3) {
        ctx.beginPath();
        ctx.moveTo(index, 0);
        ctx.lineTo(index, size);
        ctx.moveTo(0, index);
        ctx.lineTo(size, index);
        ctx.stroke();
      }
      grain(ctx, size, 10);
    },
    [3, 3],
  );

  const materials: StudioMaterials = {
    caisson: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.62, metalness: 0.12 }),
    grille: new THREE.MeshStandardMaterial({
      color: 0x0c0e12,
      roughness: 0.85,
      metalness: 0.35,
      map: grille,
      bumpMap: grille,
      bumpScale: 0.35,
    }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.34, metalness: 0.92 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.4, metalness: 0.88 }),
    noirMat: new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 0.78, metalness: 0.06 }),
    plastique: new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.48, metalness: 0.05 }),
    bois: new THREE.MeshStandardMaterial({ map: bois, bumpMap: bois, bumpScale: 0.15, roughness: 0.62, metalness: 0 }),
    boisClair: new THREE.MeshStandardMaterial({ color: 0xc59a68, roughness: 0.58, metalness: 0 }),
    nappe: new THREE.MeshStandardMaterial({ color: 0xded8cb, roughness: 0.92, metalness: 0 }),
    tissu: new THREE.MeshStandardMaterial({ map: tissu, color: 0x6f7480, roughness: 0.94, metalness: 0 }),
    toile: new THREE.MeshStandardMaterial({
      color: 0xcac2b1,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.97,
    }),
    verre: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.06,
      metalness: 0,
      transmission: 0.88,
      thickness: 0.4,
      ior: 1.45,
    }),
    lentille: new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.18, metalness: 0.5 }),
    // Blanc de base : la teinte de chaque silhouette vient de sa couleur
    // d'instance. Une base sombre multipliee par une teinte sombre donnait une
    // foule de decoupes noires.
    foule: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0 }),
    feuillage: new THREE.MeshStandardMaterial({ color: 0x35521f, roughness: 0.95, metalness: 0, flatShading: true }),
    tronc: new THREE.MeshStandardMaterial({ color: 0x4a3625, roughness: 0.92, metalness: 0 }),
    moquetteRouge: new THREE.MeshStandardMaterial({ color: 0x7d1f24, roughness: 0.96, metalness: 0 }),
    peinture: new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.52, metalness: 0.08 }),
    peintureFroide: new THREE.MeshStandardMaterial({ color: 0x8b98a6, roughness: 0.58, metalness: 0.06 }),
    corten: new THREE.MeshStandardMaterial({ color: 0x2f5d7a, roughness: 0.74, metalness: 0.32 }),
    inox: new THREE.MeshStandardMaterial({ color: 0xd6dade, roughness: 0.22, metalness: 0.95 }),
  };
  for (const material of Object.values(materials)) material.userData.shared = true;
  return materials;
}

/** Contenu anime d'un mur LED ou d'un ecran. */
export function screenTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 288;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 512, 288);
  gradient.addColorStop(0, '#123a7a');
  gradient.addColorStop(0.5, '#2f7ad0');
  gradient.addColorStop(1, '#7a3fa8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 288);
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#000';
  for (let y = 0; y < 288; y += 3) ctx.fillRect(0, y, 512, 1);
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
