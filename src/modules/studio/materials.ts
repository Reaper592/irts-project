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
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  CACHE.set(key, texture);
  return texture;
}

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

const GROUND_PAINTERS: Record<string, { paint: Painter; repeat: number; roughness: number; metalness: number }> = {
  herbe: {
    repeat: 40,
    roughness: 0.95,
    metalness: 0,
    paint: (ctx, size) => {
      fill(ctx, size, '#3f5a2c');
      for (let index = 0; index < size * 22; index += 1) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const shade = 30 + Math.random() * 60;
        ctx.strokeStyle = `rgba(${shade + 30},${shade + 70},${shade + 20},0.55)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 4, y - 2 - Math.random() * 5);
        ctx.stroke();
      }
      grain(ctx, size, 22);
    },
  },
  'gazon-tondu': {
    repeat: 26,
    roughness: 0.9,
    metalness: 0,
    paint: (ctx, size) => {
      fill(ctx, size, '#4a6b33');
      for (let y = 0; y < size; y += 26) {
        ctx.fillStyle = (y / 26) % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(0, y, size, 26);
      }
      grain(ctx, size, 16);
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
      grain(ctx, size, 34);
    },
  },
  bitume: {
    repeat: 24,
    roughness: 0.82,
    metalness: 0.04,
    paint: (ctx, size) => {
      fill(ctx, size, '#2f3236');
      for (let index = 0; index < 2200; index += 1) {
        ctx.fillStyle = `rgba(${140 + Math.random() * 70},${140 + Math.random() * 70},${145 + Math.random() * 70},0.14)`;
        ctx.fillRect(Math.random() * size, Math.random() * size, 1.6, 1.6);
      }
      grain(ctx, size, 16);
    },
  },
  beton: {
    repeat: 18,
    roughness: 0.72,
    metalness: 0.03,
    paint: (ctx, size) => {
      fill(ctx, size, '#6d7178');
      for (let index = 0; index < 40; index += 1) {
        ctx.strokeStyle = 'rgba(0,0,0,0.05)';
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        ctx.moveTo(Math.random() * size, Math.random() * size);
        ctx.lineTo(Math.random() * size, Math.random() * size);
        ctx.stroke();
      }
      grain(ctx, size, 14);
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
      grain(ctx, size, 26);
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
      for (let index = 0; index < 1600; index += 1) {
        const tone = 90 + Math.random() * 90;
        ctx.fillStyle = `rgb(${tone},${tone - 4},${tone - 12})`;
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, 1 + Math.random() * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      grain(ctx, size, 18);
    },
  },
};

export function groundMaterial(kind: string, tint: string, nightFactor: number): THREE.MeshStandardMaterial {
  const config = GROUND_PAINTERS[kind] ?? GROUND_PAINTERS.beton;
  const texture = canvasTexture(`sol_${kind}`, 512, config.paint, [config.repeat, config.repeat]);
  return new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: texture,
    bumpScale: 0.22,
    roughness: config.roughness,
    metalness: config.metalness,
    color: new THREE.Color(tint).multiplyScalar(nightFactor),
  });
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

  return {
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
    foule: new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.9, metalness: 0 }),
    feuillage: new THREE.MeshStandardMaterial({ color: 0x35521f, roughness: 0.95, metalness: 0, flatShading: true }),
    tronc: new THREE.MeshStandardMaterial({ color: 0x4a3625, roughness: 0.92, metalness: 0 }),
    moquetteRouge: new THREE.MeshStandardMaterial({ color: 0x7d1f24, roughness: 0.96, metalness: 0 }),
    peinture: new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.52, metalness: 0.08 }),
    peintureFroide: new THREE.MeshStandardMaterial({ color: 0x8b98a6, roughness: 0.58, metalness: 0.06 }),
    corten: new THREE.MeshStandardMaterial({ color: 0x2f5d7a, roughness: 0.74, metalness: 0.32 }),
    inox: new THREE.MeshStandardMaterial({ color: 0xd6dade, roughness: 0.22, metalness: 0.95 }),
  };
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
