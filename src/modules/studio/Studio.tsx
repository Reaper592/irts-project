import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../core/store';
import { useNav } from '../../core/nav';
import { StudioEngine, groundArea, polygonArea, type CameraPreset, type SurfaceTarget, type TransformMode } from './engine';
import { GROUND_KINDS, OBJECT_LIBRARY, billableUnits, itemSize, objectDef, productIdForRef } from './library';
import type { EntityId, GroundPoint, GroundShape, Scene, SceneItem, SurfaceZone, VenueType } from '../../core/types';
import { addDays, downloadFile, esc, money, money0, num, sum, today, uid } from '../../core/utils';
import { Badge, Card, ConfirmDialog, EmptyState, Field, Modal, PageHeader, Segmented } from '../../ui/kit';
import { CategorySelect, ManageCategoriesButton } from '../../ui/CategoryManager';
import { sceneLines, sceneToLines } from '../../core/calc';

const VENUES: { id: VenueType; label: string }[] = [
  { id: 'salle', label: 'Salle' },
  { id: 'plein-air', label: 'Plein air' },
  { id: 'chapiteau', label: 'Chapiteau' },
  { id: 'club', label: 'Club' },
  { id: 'eglise', label: 'Église' },
  { id: 'showroom', label: 'Showroom' },
];

const CAMERAS: { id: CameraPreset; label: string; hint: string }[] = [
  { id: 'plan', label: 'Plan', hint: 'Vue de dessus cotée, pour poser l’implantation' },
  { id: 'public', label: 'Œil du public', hint: 'Hauteur 1,70 m au centre de la jauge' },
  { id: 'face', label: 'Face', hint: 'Vue frontale de la scène' },
  { id: 'plongee', label: 'Plongée', hint: 'Vue d’ensemble en hauteur' },
  { id: 'laterale', label: 'Latérale', hint: 'Depuis le côté cour' },
  { id: 'scene', label: 'Depuis la scène', hint: 'Contrechamp vers la salle' },
];

const MODES: { id: TransformMode; label: string; key: string }[] = [
  { id: 'translate', label: 'Déplacer', key: 'D' },
  { id: 'rotate', label: 'Tourner', key: 'R' },
  { id: 'scale', label: 'Dimensionner', key: 'T' },
];

/** Contour effectif d'une scene, quel que soit le preset de forme. */
function outlineOf(scene: Scene): GroundPoint[] {
  const hw = scene.width / 2;
  const hd = scene.depth / 2;
  switch (scene.groundShape) {
    case 'polygone':
      return scene.polygon.length >= 3
        ? scene.polygon
        : [
            { x: -hw, z: -hd },
            { x: hw, z: -hd },
            { x: hw, z: hd },
            { x: -hw, z: hd },
          ];
    case 'l':
      return [
        { x: -hw, z: -hd },
        { x: hw, z: -hd },
        { x: hw, z: 0 },
        { x: 0, z: 0 },
        { x: 0, z: hd },
        { x: -hw, z: hd },
      ];
    case 'cercle':
    case 'ovale': {
      const radius = scene.groundShape === 'cercle' ? Math.min(hw, hd) : 1;
      return Array.from({ length: 24 }, (_, index) => {
        const angle = (index / 24) * Math.PI * 2;
        return scene.groundShape === 'cercle'
          ? { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
          : { x: Math.cos(angle) * hw, z: Math.sin(angle) * hd };
      });
    }
    default:
      return [
        { x: -hw, z: -hd },
        { x: hw, z: -hd },
        { x: hw, z: hd },
        { x: -hw, z: hd },
      ];
  }
}

function emptyScene(entity: EntityId): Scene {
  return {
    id: uid('scn'),
    entity,
    name: 'Nouvelle implantation',
    clientId: null,
    projectId: null,
    venueType: 'plein-air',
    width: 30,
    depth: 24,
    height: 8,
    audience: 250,
    ambient: 0.3,
    haze: 0.18,
    exposure: 1,
    bloom: 0.4,
    timeOfDay: 'jour',
    floorTone: 'gazon-tondu',
    wallTone: '#15181d',
    groundShape: 'rectangle',
    polygon: [
      { x: -15, z: -12 },
      { x: 15, z: -12 },
      { x: 15, z: 12 },
      { x: -15, z: 12 },
    ],
    zones: [],
    gridSnap: 0.25,
    showGrid: true,
    quality: 'equilibre',
    sunAzimuth: 135,
    hiddenFamilies: [],
    items: [],
    notes: '',
    createdAt: today(),
  };
}

export default function Studio() {
  const store = useStore();
  const { db, visible, update, defaultEntity, toast, companyOf, nextNumber, categories } = store;
  const { focus, go } = useNav();
  const scenes = useMemo(() => visible(db.scenes), [db.scenes, visible]);
  const [sceneId, setSceneId] = useState<string | null>(focus ?? scenes[0]?.id ?? null);
  const [selection, setSelection] = useState<string[]>([]);
  const [measure, setMeasure] = useState<{ active: boolean; points: GroundPoint[] }>({ active: false, points: [] });
  const [arraying, setArraying] = useState(false);
  const selected = selection.length === 1 ? selection[0] : null;
  const setSelected = useCallback((id: string | null) => setSelection(id ? [id] : []), []);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState<'objets' | 'terrain' | 'chiffrage'>('objets');
  const [mode, setMode] = useState<TransformMode>('translate');
  const [planMode, setPlanMode] = useState(false);
  const [surfaceTarget, setSurfaceTarget] = useState<SurfaceTarget | null>(null);
  const [history, setHistory] = useState<{ past: Scene[]; future: Scene[] }>({ past: [], future: [] });

  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const scene = scenes.find((entry) => entry.id === sceneId) ?? null;
  const sceneRef = useRef<Scene | null>(scene);
  sceneRef.current = scene;

  useEffect(() => {
    if (!scenes.length) setSceneId(null);
    else if (!scenes.some((entry) => entry.id === sceneId)) setSceneId(scenes[0].id);
  }, [scenes, sceneId]);

  /* ------------------------------------------------------------- mutations */

  const pushHistory = useCallback(() => {
    const current = sceneRef.current;
    if (!current) return;
    setHistory((state) => ({ past: [...state.past.slice(-29), structuredClone(current)], future: [] }));
  }, []);

  const patch = useCallback(
    (changes: Partial<Scene>, snapshot = true) => {
      if (snapshot) pushHistory();
      update((draft) => {
        const target = draft.scenes.find((entry) => entry.id === sceneRef.current?.id);
        if (target) Object.assign(target, changes);
      });
    },
    [pushHistory, update],
  );

  const patchItem = useCallback(
    (itemId: string, changes: Partial<SceneItem>, snapshot = true) => {
      if (snapshot) pushHistory();
      update((draft) => {
        const item = draft.scenes.find((entry) => entry.id === sceneRef.current?.id)?.items.find((entry) => entry.id === itemId);
        if (item) Object.assign(item, changes);
      });
    },
    [pushHistory, update],
  );

  /** Applique en une seule fois les changements issus d'une manipulation. */
  const patchItems = useCallback(
    (changes: { id: string; change: Partial<SceneItem> }[], snapshot = true) => {
      if (!changes.length) return;
      if (snapshot) pushHistory();
      update((draft) => {
        const target = draft.scenes.find((entry) => entry.id === sceneRef.current?.id);
        if (!target) return;
        for (const { id, change } of changes) {
          const item = target.items.find((entry) => entry.id === id);
          if (item) Object.assign(item, change);
        }
      });
    },
    [pushHistory, update],
  );

  const undo = useCallback(() => {
    setHistory((state) => {
      const previous = state.past[state.past.length - 1];
      const current = sceneRef.current;
      if (!previous || !current) return state;
      update((draft) => {
        const index = draft.scenes.findIndex((entry) => entry.id === previous.id);
        if (index >= 0) draft.scenes[index] = previous;
      });
      return { past: state.past.slice(0, -1), future: [structuredClone(current), ...state.future].slice(0, 30) };
    });
  }, [update]);

  const redo = useCallback(() => {
    setHistory((state) => {
      const next = state.future[0];
      const current = sceneRef.current;
      if (!next || !current) return state;
      update((draft) => {
        const index = draft.scenes.findIndex((entry) => entry.id === next.id);
        if (index >= 0) draft.scenes[index] = next;
      });
      return { past: [...state.past, structuredClone(current)], future: state.future.slice(1) };
    });
  }, [update]);

  /* ---------------------------------------------------------------- moteur */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new StudioEngine(host);
    engineRef.current = engine;
    engine.handlers = {
      onSelect: (itemId, additive) => {
        if (!itemId) {
          if (!additive) setSelection([]);
          return;
        }
        setSelection((current) =>
          additive
            ? current.includes(itemId)
              ? current.filter((entry) => entry !== itemId)
              : [...current, itemId]
            : [itemId],
        );
      },
      onTransform: (changes) => patchItems(changes),
      onHover: () => {},
      onMeasure: (points) => setMeasure((state) => ({ ...state, points })),
      onSurfaceChange: (target, points) => {
        if (target.kind === 'site') {
          patch({ groundShape: 'polygone', polygon: points }, false);
        } else {
          update((draft) => {
            const scene2 = draft.scenes.find((entry) => entry.id === sceneRef.current?.id);
            const zone = scene2?.zones.find((entry) => entry.id === target.id);
            if (zone) zone.polygon = points;
          });
        }
      },
    };
    // Point d'accroche de diagnostic : utilise par les tests de rendu et le
    // support pour verifier la chaine (ombres, passes, eclairage) en situation.
    (window as unknown as { irtsStudio?: StudioEngine }).irtsStudio = engine;
    setReady(true);
    return () => {
      engine.dispose();
      engineRef.current = null;
      setReady(false);
    };
  }, [patchItem, patchItems, patch, update]);

  /** Cle de reconstruction : tout ce qui change la geometrie de la scene. */
  const sceneKey = scene
    ? [
        scene.id,
        scene.venueType,
        scene.width,
        scene.depth,
        scene.height,
        scene.audience,
        scene.timeOfDay,
        scene.floorTone,
        scene.wallTone,
        scene.sunAzimuth,
        scene.quality,
        scene.groundShape,
        scene.hiddenFamilies.join('+'),
        scene.polygon.map((point) => `${point.x},${point.z}`).join(';'),
        scene.zones
          .map((zone) => `${zone.id}:${zone.ground}:${zone.elevation}:${zone.visible}:${zone.polygon.map((p) => `${p.x},${p.z}`).join('|')}`)
          .join('~'),
        scene.items
          .map((item) =>
            [item.id, item.model3d, item.x, item.y, item.z, item.rotX, item.rotY, item.scale, item.width, item.height, item.depth, item.color, item.beam, item.qty, item.locked].join(','),
          )
          .join('|'),
      ].join('~')
    : '';

  useEffect(() => {
    if (ready && scene) engineRef.current?.build(scene);
  }, [ready, sceneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ready && scene) engineRef.current?.applySettings(scene);
  }, [ready, scene?.exposure, scene?.bloom, scene?.haze, scene?.ambient, scene?.showGrid, scene?.gridSnap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    engineRef.current?.selectMany(selection);
  }, [selection, sceneKey]);

  useEffect(() => {
    engineRef.current?.setMeasureMode(measure.active);
  }, [measure.active]);

  useEffect(() => {
    engineRef.current?.setTransformMode(mode);
  }, [mode]);

  useEffect(() => {
    engineRef.current?.setSurfaceTarget(surfaceTarget);
  }, [surfaceTarget, sceneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Editer un contour se fait en vue en plan : on y bascule automatiquement. */
  const editSurface = useCallback(
    (target: SurfaceTarget | null) => {
      setSurfaceTarget(target);
      setSelected(null);
      if (target && !engineRef.current?.isPlanMode()) {
        engineRef.current?.setPlanMode(true);
        setPlanMode(true);
      }
    },
    [],
  );

  /* ------------------------------------------------------- raccourcis clavier */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'a') {
        event.preventDefault();
        setSelection(engineRef.current?.allItemIds() ?? []);
        return;
      }
      if (key === 'd') setMode('translate');
      if (key === 'r') setMode('rotate');
      if (key === 't') setMode('scale');
      if (key === 'm') setMeasure((state) => ({ active: !state.active, points: [] }));
      if (key === 'g') patch({ showGrid: !sceneRef.current?.showGrid }, false);
      if (key === 'p') {
        const next = !engineRef.current?.isPlanMode();
        engineRef.current?.setPlanMode(next);
        setPlanMode(next);
      }
      if ((key === 'delete' || key === 'backspace') && engineRef.current?.removeHoveredVertex()) return;
      if ((key === 'delete' || key === 'backspace') && measure.active) {
        engineRef.current?.undoMeasurePoint();
        return;
      }
      if (key === 'escape' && measure.active) {
        setMeasure({ active: false, points: [] });
        return;
      }
      if (key === 'escape' && surfaceTarget) {
        setSurfaceTarget(null);
        return;
      }
      if ((key === 'delete' || key === 'backspace') && selection.length) {
        pushHistory();
        update((draft) => {
          const target2 = draft.scenes.find((entry) => entry.id === sceneRef.current?.id);
          if (target2) target2.items = target2.items.filter((entry) => !selection.includes(entry.id));
        });
        setSelection([]);
      }
      if (key === 'escape') setSelection([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, surfaceTarget, measure.active, undo, redo, patch, pushHistory, update]);

  /* ----------------------------------------------------------- chiffrage */

  const quote = useMemo(() => {
    if (!scene) return { lines: [], extras: [], total: 0 };
    const { lines, extras } = sceneLines(scene, db.products);
    return { lines, extras, total: sum(lines, (line) => line.qty * line.unitPrice) };
  }, [scene, db.products]);

  /** Bilan technique : ce qu'il faut savoir avant de charger le camion. */
  const load = useMemo(() => {
    if (!scene) return { power: 0, weight: 0, surface: 0, seats: 0, volume: 0 };
    let power = 0;
    let weight = 0;
    let surface = 0;
    let seats = 0;
    let volume = 0;
    for (const item of scene.items) {
      const def = objectDef(item.model3d);
      const size = itemSize(item.model3d, item);
      const product =
        db.products.find((entry) => entry.id === item.productId) ??
        (def.product ? db.products.find((entry) => entry.id === productIdForRef(def.product!.ref)) : undefined);
      if (product) {
        const units = billableUnits(item.model3d, size, item.qty);
        power += product.powerW * units;
        weight += product.weightKg * units;
      }
      if (def.family === 'Tentes & abris') surface += size[0] * size[2];
      if (item.model3d === 'seating-block') seats += item.qty;
      if (['chair', 'chaise-napoleon'].includes(item.model3d)) seats += 1;
      if (item.model3d === 'table-brasserie') seats += 8;
      if (item.model3d === 'table-round') seats += 10;
      if (!['person', 'person-seated', 'arbre', 'voiture'].includes(item.model3d)) {
        volume += size[0] * size[1] * size[2] * 0.35;
      }
    }
    return { power, weight, surface, seats, volume };
  }, [scene, db.products]);

  /* -------------------------------------------------------------- exports */

  const exportImage = () => {
    const engine = engineRef.current;
    if (!engine || !scene) return;
    const link = document.createElement('a');
    link.href = engine.screenshot();
    link.download = `${scene.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
    link.click();
    toast('Rendu exporté en PNG.', 'succes');
  };

  const exportSheet = () => {
    const engine = engineRef.current;
    if (!engine || !scene) return;
    const wasPlan = engine.isPlanMode();
    engine.setPlanMode(true);
    const plan = engine.screenshot();
    engine.setPlanMode(false);
    engine.setCamera('face');
    const perspective = engine.screenshot();
    if (wasPlan) engine.setPlanMode(true);

    const company = companyOf(scene.entity);
    const client = db.clients.find((entry) => entry.id === scene.clientId);
    const byFamily = new Map<string, { label: string; qty: number; size: string }[]>();
    for (const item of scene.items) {
      const def = objectDef(item.model3d);
      const [w, h, d] = itemSize(item.model3d, item);
      const list = byFamily.get(def.family) ?? [];
      list.push({ label: item.label, qty: item.qty, size: `${num(w, 2)} × ${num(h, 2)} × ${num(d, 2)} m` });
      byFamily.set(def.family, list);
    }

    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(scene.name)}</title>
<style>
 @page { size: A4 landscape; margin: 10mm; }
 body { font-family: "Helvetica Neue", Arial, sans-serif; color:#16181d; margin:0; font-size:10.5px; }
 header { display:flex; align-items:center; gap:14px; border-bottom:3px solid ${company.accent}; padding-bottom:8px; margin-bottom:10px; }
 .logo { width:40px; height:40px; border-radius:9px; background:${company.accent}; color:#fff; display:grid; place-items:center; font-weight:700; }
 h1 { font-size:16px; margin:0; } .sub { color:#666; font-size:10px; }
 h2 { font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:#7b8089; margin:12px 0 5px; }
 img { width:100%; border-radius:8px; display:block; border:1px solid #dfe2e6; }
 .cols { display:flex; gap:12px; } .cols > div { flex:1; }
 table { border-collapse:collapse; width:100%; } th,td { padding:3px 5px; border-bottom:1px solid #e6e8eb; text-align:left; }
 th { font-size:8px; text-transform:uppercase; letter-spacing:.06em; color:#7b8089; }
 .n { text-align:right; font-variant-numeric: tabular-nums; }
 .meta { display:flex; gap:16px; flex-wrap:wrap; margin:8px 0; }
 .meta div span { display:block; font-size:8px; text-transform:uppercase; color:#7b8089; letter-spacing:.06em; }
 .noprint button { position:fixed; top:10px; right:10px; font:inherit; padding:8px 14px; border:0; border-radius:8px; background:${company.accent}; color:#fff; cursor:pointer; }
 @media print { .noprint { display:none; } }
</style></head><body>
<div class="noprint"><button onclick="window.print()">Imprimer / PDF</button></div>
<header><div class="logo">${esc(company.mark)}</div>
 <div><h1>${esc(scene.name)}</h1>
 <div class="sub">${esc(company.legalName)} — ${client ? esc(client.name) : 'Projet interne'} — ${new Date().toLocaleDateString('fr-FR')}</div></div>
</header>
<div class="meta">
 <div><span>Terrain</span>${num(scene.width)} × ${num(scene.depth)} m</div>
 <div><span>Hauteur</span>${num(scene.height)} m</div>
 <div><span>Type de lieu</span>${esc(scene.venueType)}</div>
 <div><span>Sol</span>${esc(GROUND_KINDS.find((g) => g.id === scene.floorTone)?.label ?? scene.floorTone)}</div>
 <div><span>Jauge</span>${num(scene.audience)} pers.</div>
 <div><span>Surface couverte</span>${num(load.surface)} m²</div>
 <div><span>Puissance</span>${num(load.power / 1000, 1)} kW</div>
 <div><span>Poids matériel</span>${num(load.weight)} kg</div>
 <div><span>Budget location / jour</span>${money(quote.total)}</div>
</div>
<div class="cols">
 <div><h2>Vue en plan</h2><img src="${plan}" alt="Plan d’implantation"></div>
 <div><h2>Perspective</h2><img src="${perspective}" alt="Rendu perspective"></div>
</div>
<div class="cols" style="margin-top:10px">
 <div>
  <h2>Nomenclature</h2>
  <table><thead><tr><th>Famille</th><th>Élément</th><th class="n">Qté</th><th class="n">Dimensions</th></tr></thead><tbody>
  ${[...byFamily.entries()]
    .map(([family, items]) =>
      items
        .map(
          (entry, index) =>
            `<tr><td>${index === 0 ? esc(family) : ''}</td><td>${esc(entry.label)}</td><td class="n">${entry.qty}</td><td class="n">${entry.size}</td></tr>`,
        )
        .join(''),
    )
    .join('')}
  </tbody></table>
 </div>
 <div>
  <h2>Chiffrage indicatif — base une journée</h2>
  <table><thead><tr><th>Matériel</th><th class="n">Qté</th><th class="n">P.U. HT</th><th class="n">Total</th></tr></thead><tbody>
  ${quote.lines
    .map(
      (line) =>
        `<tr><td>${esc(line.designation)}</td><td class="n">${line.qty}</td><td class="n">${money(line.unitPrice)}</td><td class="n">${money(line.qty * line.unitPrice)}</td></tr>`,
    )
    .join('')}
  <tr><td colspan="3"><strong>Total HT / jour</strong></td><td class="n"><strong>${money(quote.total)}</strong></td></tr>
  </tbody></table>
  ${scene.notes ? `<h2>Notes</h2><p style="color:#55595f">${esc(scene.notes)}</p>` : ''}
 </div>
</div>
</body></html>`;
    const win = window.open('', '_blank');
    if (!win) {
      toast('Le navigateur a bloqué la fenêtre.', 'alerte');
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  const createQuote = () => {
    if (!scene) return;
    const client = db.clients.find((entry) => entry.id === scene.clientId) ?? db.clients.find((entry) => entry.entity === scene.entity);
    if (!client) {
      toast('Rattachez un client à la scène avant de générer un devis.', 'alerte');
      return;
    }
    const company = companyOf(scene.entity);
    const number = nextNumber(scene.entity, 'devis');
    const id = uid('doc');
    update((draft) => {
      draft.docs.unshift({
        id,
        entity: scene.entity,
        kind: 'devis',
        number,
        clientId: client.id,
        projectId: scene.projectId,
        dealId: null,
        sceneId: scene.id,
        sourceDocId: null,
        title: scene.name,
        date: today(),
        dueDate: addDays(today(), company.quoteValidityDays),
        status: 'brouillon',
        lines: sceneToLines(scene, draft.products).map((line) => ({ ...line, id: uid('ln') })),
        globalDiscountPct: 0,
        depositPct: 30,
        shipping: 0,
        eventStart: today(),
        eventEnd: today(),
        venue: scene.name,
        notes: scene.notes,
        terms: company.cgv,
        payments: [],
        sentAt: null,
        signedAt: null,
        signedBy: '',
        createdAt: today(),
      });
    });
    toast(`Devis ${number} généré depuis la scène.`, 'succes');
    go('devis', id);
  };

  const addObject = (model3d: string, count: number) => {
    const def = objectDef(model3d);
    const productId = def.product ? productIdForRef(def.product.ref) : null;
    const family = categories('objet3d').find((entry) => entry.label === def.family);
    pushHistory();
    update((draft) => {
      const target = draft.scenes.find((entry) => entry.id === sceneRef.current?.id);
      if (!target) return;
      for (let index = 0; index < count; index += 1) {
        const spread = count === 1 ? 0 : (index / (count - 1) - 0.5) * Math.min(target.width * 0.7, count * (def.size[0] + 0.4));
        target.items.push({
          id: uid('si'),
          productId,
          model3d,
          label: count > 1 ? `${def.label} ${index + 1}` : def.label,
          categoryId: family?.id ?? null,
          qty: def.countable ? (model3d === 'seating-block' ? 120 : 48) : 1,
          x: Number(spread.toFixed(2)),
          y: def.defaultY,
          z: -2,
          rotY: 0,
          rotX: 0,
          scale: 1,
          width: null,
          height: null,
          depth: null,
          color: def.color ?? '#3987e5',
          beam: def.beam ? 0.7 : 0,
          locked: false,
          notes: '',
        });
      }
    });
    setAdding(false);
    toast(`${count} objet(s) ajouté(s).`, 'succes');
  };

  const siteEditing = surfaceTarget?.kind === 'site';
  /* ------------------------------------------------------- duplication */

  /** Emprise de la selection, en metres, pour proposer un pas de reseau juste. */
  const selectionSpan = useMemo(() => {
    const items = (scene?.items ?? []).filter((item) => selection.includes(item.id));
    if (!items.length) return { x: 1, z: 1 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const item of items) {
      const size = itemSize(item.model3d, item);
      minX = Math.min(minX, item.x - size[0] / 2);
      maxX = Math.max(maxX, item.x + size[0] / 2);
      minZ = Math.min(minZ, item.z - size[2] / 2);
      maxZ = Math.max(maxZ, item.z + size[2] / 2);
    }
    return { x: Math.max(0.2, Math.round((maxX - minX) * 100) / 100), z: Math.max(0.2, Math.round((maxZ - minZ) * 100) / 100) };
  }, [scene?.items, selection]);

  /** Copie la selection avec un decalage, et selectionne les copies. */
  const duplicateSelection = useCallback(
    (offsetX = selectionSpan.x + 0.3, offsetZ = 0) => {
      const source = (sceneRef.current?.items ?? []).filter((item) => selection.includes(item.id));
      if (!source.length) return;
      pushHistory();
      const copies = source.map((item) => ({
        ...structuredClone(item),
        id: uid('si'),
        x: Math.round((item.x + offsetX) * 100) / 100,
        z: Math.round((item.z + offsetZ) * 100) / 100,
      }));
      update((draft) => {
        const target = draft.scenes.find((entry) => entry.id === sceneRef.current?.id);
        if (target) target.items.push(...copies);
      });
      setSelection(copies.map((item) => item.id));
    },
    [selection, selectionSpan, pushHistory, update],
  );

  /**
   * Repetition en reseau : la selection est recopiee sur une grille de
   * `countX` par `countZ`, au pas donne. C'est ainsi qu'on pose trente tables
   * ou une rangee de barrieres sans les placer une a une.
   */
  const arraySelection = useCallback(
    (countX: number, stepX: number, countZ: number, stepZ: number) => {
      const source = (sceneRef.current?.items ?? []).filter((item) => selection.includes(item.id));
      if (!source.length || countX * countZ <= 1) return 0;
      pushHistory();
      const copies: SceneItem[] = [];
      for (let ix = 0; ix < countX; ix += 1) {
        for (let iz = 0; iz < countZ; iz += 1) {
          if (!ix && !iz) continue;
          for (const item of source) {
            copies.push({
              ...structuredClone(item),
              id: uid('si'),
              x: Math.round((item.x + ix * stepX) * 100) / 100,
              z: Math.round((item.z + iz * stepZ) * 100) / 100,
            });
          }
        }
      }
      update((draft) => {
        const target = draft.scenes.find((entry) => entry.id === sceneRef.current?.id);
        if (target) target.items.push(...copies);
      });
      return copies.length;
    },
    [selection, pushHistory, update],
  );

  /** Longueur cumulee de la chaine de mesure en cours. */
  const measureTotal = useMemo(() => {
    let total = 0;
    for (let index = 1; index < measure.points.length; index += 1) {
      const a = measure.points[index - 1];
      const b = measure.points[index];
      total += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return total;
  }, [measure.points]);

  /** Familles presentes dans la scene, avec leur effectif. */
  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of scene?.items ?? []) {
      const family = objectDef(item.model3d).family;
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [scene?.items]);

  const selectedItem = scene?.items.find((item) => item.id === selected) ?? null;
  const selectedDef = selectedItem ? objectDef(selectedItem.model3d) : null;
  const selectedSize = selectedItem ? itemSize(selectedItem.model3d, selectedItem) : null;

  return (
    <div className="view">
      <PageHeader
        title="Studio 3D"
        subtitle="Concevoir le terrain, poser le matériel aux bonnes cotes et montrer le rendu au client"
        actions={
          <>
            <select value={sceneId ?? ''} onChange={(event) => setSceneId(event.target.value)} style={{ width: 240 }}>
              {scenes.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
              {!scenes.length ? <option value="">Aucune scène</option> : null}
            </select>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const created = emptyScene(defaultEntity);
                update((draft) => void draft.scenes.unshift(created));
                setSceneId(created.id);
                toast('Nouvelle scène créée.', 'succes');
              }}
            >
              + Nouvelle scène
            </button>
            <button type="button" className="btn btn-primary" onClick={createQuote} disabled={!scene?.items.length}>
              Générer le devis
            </button>
          </>
        }
      />

      {!scene ? (
        <Card>
          <EmptyState
            mark="🎬"
            title="Aucune scène pour cette société"
            hint="Créez un terrain aux dimensions du lieu, puis posez le matériel."
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const created = emptyScene(defaultEntity);
                  update((draft) => void draft.scenes.unshift(created));
                  setSceneId(created.id);
                }}
              >
                + Créer une scène
              </button>
            }
          />
        </Card>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 356px', gap: 14, alignItems: 'start' }}>
          <div className="stack">
            {/* --------------------------------------------------- barre d’outils */}
            <div className="row row-wrap" style={{ gap: 8 }}>
              <Segmented
                value={mode}
                options={MODES.map((entry) => ({ value: entry.id, label: entry.label }))}
                onChange={(value) => setMode(value as TransformMode)}
              />
              <button
                type="button"
                className="btn"
                aria-pressed={planMode}
                style={planMode ? { background: 'var(--accent)', color: '#fff', borderColor: 'transparent' } : undefined}
                onClick={() => {
                  const next = !planMode;
                  engineRef.current?.setPlanMode(next);
                  setPlanMode(next);
                }}
              >
                {planMode ? '⬛ Vue en plan' : '⬜ Vue en plan'}
              </button>
              <button
                type="button"
                className="btn"
                aria-pressed={measure.active}
                title="Mesurer une distance au sol — clic par clic (M)"
                style={measure.active ? { background: '#c9902a', color: '#fff', borderColor: 'transparent' } : undefined}
                onClick={() => setMeasure((state) => ({ active: !state.active, points: [] }))}
              >
                📏 Décamètre
              </button>
              <div className="row" style={{ gap: 4 }}>
                <span className="small muted nowrap">Accrochage</span>
                <select
                  value={scene.gridSnap}
                  onChange={(event) => patch({ gridSnap: Number(event.target.value) }, false)}
                  style={{ width: 96 }}
                >
                  <option value={0}>Libre</option>
                  <option value={0.1}>10 cm</option>
                  <option value={0.25}>25 cm</option>
                  <option value={0.5}>50 cm</option>
                  <option value={1}>1 m</option>
                </select>
              </div>
              <label className="row small nowrap" style={{ gap: 5, cursor: 'pointer' }}>
                <input type="checkbox" checked={scene.showGrid} onChange={(event) => patch({ showGrid: event.target.checked }, false)} />
                Grille
              </label>
              <span className="spacer" />
              <button type="button" className="btn btn-sm" onClick={undo} disabled={!history.past.length} title="Ctrl+Z">
                ↶ Annuler
              </button>
              <button type="button" className="btn btn-sm" onClick={redo} disabled={!history.future.length} title="Ctrl+Maj+Z">
                ↷ Rétablir
              </button>
            </div>

            <div className="viewer" style={{ height: 'min(64vh, 640px)' }}>
              <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
              {!ready ? <div className="viewer-loading">Initialisation du moteur de rendu…</div> : null}
              <div className="viewer-hud">
                <span>{scene.items.length} objets</span>
                <span>
                  {num(scene.width)} × {num(scene.depth)} m
                </span>
                <span>{num(scene.audience)} pers.</span>
                <span>{num(load.power / 1000, 1)} kW</span>
                <span>{num(load.weight)} kg</span>
                {selectedItem && selectedSize ? (
                  <span style={{ color: 'var(--accent)' }}>
                    {selectedItem.label} — {num(selectedSize[0], 2)} × {num(selectedSize[1], 2)} × {num(selectedSize[2], 2)} m
                  </span>
                ) : null}
                {selection.length > 1 ? (
                  <span style={{ color: 'var(--accent)' }}>{selection.length} objets sélectionnés</span>
                ) : null}
                {measure.active ? (
                  <span style={{ color: '#ffc857' }}>
                    {measureTotal > 0
                      ? `Décamètre : ${num(measureTotal, 2)} m sur ${measure.points.length - 1} segment(s)`
                      : 'Décamètre : cliquez le premier point'}
                  </span>
                ) : null}
              </div>
              <div className="viewer-tools">
                {CAMERAS.map((camera) => (
                  <button
                    key={camera.id}
                    type="button"
                    className="btn btn-sm"
                    title={camera.hint}
                    onClick={() => {
                      engineRef.current?.setCamera(camera.id);
                      setPlanMode(camera.id === 'plan');
                    }}
                  >
                    {camera.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="row row-wrap" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={exportImage}>
                📷 Exporter le rendu (PNG)
              </button>
              <button type="button" className="btn" onClick={exportSheet}>
                📄 Dossier d’implantation (plan + rendu + nomenclature)
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  downloadFile(`${scene.name}.json`, JSON.stringify(scene, null, 2), 'application/json');
                  toast('Scène exportée.', 'succes');
                }}
              >
                Exporter la scène
              </button>
              <span className="spacer" />
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                Supprimer la scène
              </button>
            </div>

            <div className="small muted">
              Clic : sélectionner · <strong>Maj+clic</strong> : ajouter à la sélection · Glisser : orbiter ·
              Molette : zoomer · Clic droit : déplacer la vue · <strong>D</strong> déplacer ·
              <strong> R</strong> tourner · <strong>T</strong> dimensionner · <strong>M</strong> décamètre ·
              <strong> P</strong> plan · <strong>G</strong> grille · <strong>Ctrl+A</strong> tout sélectionner ·
              <strong> Suppr</strong> supprimer · <strong>Ctrl+Z</strong> annuler
            </div>
          </div>

          {/* --------------------------------------------------- panneau latéral */}
          <div className="stack">
            <div className="seg" style={{ width: '100%' }}>
              {(['objets', 'terrain', 'chiffrage'] as const).map((id) => (
                <button key={id} type="button" aria-pressed={panel === id} onClick={() => setPanel(id)} style={{ flex: 1 }}>
                  {id === 'objets' ? 'Objets' : id === 'terrain' ? 'Terrain' : 'Chiffrage'}
                </button>
              ))}
            </div>

            {panel === 'terrain' ? (
              <Card>
                <div className="stack" style={{ gap: 12 }}>
                  <Field label="Nom de l’implantation">
                    <input value={scene.name} onChange={(event) => patch({ name: event.target.value }, false)} />
                  </Field>
                  <Field label="Client">
                    <select value={scene.clientId ?? ''} onChange={(event) => patch({ clientId: event.target.value || null }, false)}>
                      <option value="">— interne —</option>
                      {db.clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Type de lieu">
                    <select value={scene.venueType} onChange={(event) => patch({ venueType: event.target.value as VenueType })}>
                      {VENUES.map((venue) => (
                        <option key={venue.id} value={venue.id}>
                          {venue.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Nature du sol">
                    <select value={scene.floorTone} onChange={(event) => patch({ floorTone: event.target.value })}>
                      {GROUND_KINDS.map((ground) => (
                        <option key={ground.id} value={ground.id}>
                          {ground.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Forme de l’emprise" hint="Un terrain réel est rarement un rectangle parfait">
                    <select
                      value={scene.groundShape}
                      onChange={(event) => {
                        const shape = event.target.value as GroundShape;
                        // Passer en polygone fige la forme courante en sommets
                        // editables : on part d'un preset et on le deforme.
                        if (shape === 'polygone') {
                          patch({
                            groundShape: 'polygone',
                            polygon: outlineOf(scene).map((point) => ({
                              x: Math.round(point.x * 100) / 100,
                              z: Math.round(point.z * 100) / 100,
                            })),
                          });
                        } else {
                          patch({ groundShape: shape });
                        }
                      }}
                    >
                      <option value="rectangle">Rectangle</option>
                      <option value="l">Forme en L</option>
                      <option value="cercle">Cercle</option>
                      <option value="ovale">Ovale</option>
                      <option value="polygone">Contour libre</option>
                    </select>
                  </Field>

                  <div className="row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className={siteEditing ? 'btn btn-primary' : 'btn'}
                      style={{ flex: 1 }}
                      onClick={() => {
                        if (siteEditing) {
                          editSurface(null);
                          return;
                        }
                        if (scene.groundShape !== 'polygone') {
                          patch({
                            groundShape: 'polygone',
                            polygon: outlineOf(scene).map((point) => ({
                              x: Math.round(point.x * 100) / 100,
                              z: Math.round(point.z * 100) / 100,
                            })),
                          });
                        }
                        editSurface({ kind: 'site' });
                      }}
                    >
                      {siteEditing ? '✓ Terminer le tracé' : '✎ Dessiner le contour'}
                    </button>
                    {scene.groundShape === 'polygone' ? (
                      <button
                        type="button"
                        className="btn"
                        title="Repartir d’un rectangle aux dimensions saisies"
                        onClick={() =>
                          patch({
                            polygon: [
                              { x: -scene.width / 2, z: -scene.depth / 2 },
                              { x: scene.width / 2, z: -scene.depth / 2 },
                              { x: scene.width / 2, z: scene.depth / 2 },
                              { x: -scene.width / 2, z: scene.depth / 2 },
                            ],
                          })
                        }
                      >
                        ⟲
                      </button>
                    ) : null}
                  </div>
                  {siteEditing ? (
                    <div className="small muted">
                      Glissez un point bleu pour le déplacer, un point clair pour ajouter un sommet,
                      <strong> Suppr</strong> sur un point pour le retirer. L’accrochage suit le pas de la grille.
                    </div>
                  ) : null}

                  <div className="grid g3" style={{ gap: 8 }}>
                    <Field label="Largeur (m)">
                      <input type="number" min={4} max={200} step={0.5} value={scene.width} onChange={(event) => patch({ width: Number(event.target.value) })} />
                    </Field>
                    <Field label="Profondeur">
                      <input type="number" min={4} max={200} step={0.5} value={scene.depth} onChange={(event) => patch({ depth: Number(event.target.value) })} />
                    </Field>
                    <Field label="Hauteur">
                      <input type="number" min={2.5} max={40} step={0.5} value={scene.height} onChange={(event) => patch({ height: Number(event.target.value) })} />
                    </Field>
                  </div>
                  <div className="small dim">
                    Emprise : {num(groundArea(scene))} m² · surface couverte par les abris : {num(load.surface)} m² ·
                    {' '}
                    {num(load.seats)} places assises
                  </div>
                  <hr className="hr" />
                  <div className="row">
                    <h3>Surfaces</h3>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const zone: SurfaceZone = {
                          id: uid('zone'),
                          label: `Surface ${scene.zones.length + 1}`,
                          ground: 'parquet',
                          elevation: 0,
                          visible: true,
                          polygon: [
                            { x: -4, z: -3 },
                            { x: 4, z: -3 },
                            { x: 4, z: 3 },
                            { x: -4, z: 3 },
                          ],
                        };
                        patch({ zones: [...scene.zones, zone] });
                        editSurface({ kind: 'zone', id: zone.id });
                      }}
                    >
                      + Surface
                    </button>
                  </div>
                  <div className="small dim">
                    Plancher, piste de danse, allée gravier, zone bar : chaque surface a son contour libre, sa
                    nature de sol et sa hauteur.
                  </div>
                  <div className="stack-sm">
                    {scene.zones.map((zone) => {
                      const editing = surfaceTarget?.kind === 'zone' && surfaceTarget.id === zone.id;
                      return (
                        <div
                          key={zone.id}
                          className="card"
                          style={{
                            background: 'var(--surface-2)',
                            padding: 10,
                            borderColor: editing ? 'var(--accent)' : undefined,
                          }}
                        >
                          <div className="row" style={{ gap: 6 }}>
                            <input
                              value={zone.label}
                              onChange={(event) =>
                                patch(
                                  {
                                    zones: scene.zones.map((entry) =>
                                      entry.id === zone.id ? { ...entry, label: event.target.value } : entry,
                                    ),
                                  },
                                  false,
                                )
                              }
                            />
                            <button
                              type="button"
                              className="btn btn-sm"
                              title={zone.visible ? 'Masquer' : 'Afficher'}
                              onClick={() =>
                                patch({
                                  zones: scene.zones.map((entry) =>
                                    entry.id === zone.id ? { ...entry, visible: !entry.visible } : entry,
                                  ),
                                })
                              }
                            >
                              {zone.visible ? '👁' : '🚫'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => {
                                if (editing) editSurface(null);
                                patch({ zones: scene.zones.filter((entry) => entry.id !== zone.id) });
                              }}
                            >
                              ✕
                            </button>
                          </div>
                          <div className="grid g2" style={{ gap: 6, marginTop: 8 }}>
                            <Field label="Sol">
                              <select
                                value={zone.ground}
                                onChange={(event) =>
                                  patch({
                                    zones: scene.zones.map((entry) =>
                                      entry.id === zone.id ? { ...entry, ground: event.target.value } : entry,
                                    ),
                                  })
                                }
                              >
                                {GROUND_KINDS.map((ground) => (
                                  <option key={ground.id} value={ground.id}>
                                    {ground.label}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <Field label="Hauteur (m)">
                              <input
                                type="number"
                                min={0}
                                max={2}
                                step={0.05}
                                value={zone.elevation}
                                onChange={(event) =>
                                  patch({
                                    zones: scene.zones.map((entry) =>
                                      entry.id === zone.id
                                        ? { ...entry, elevation: Number(event.target.value) }
                                        : entry,
                                    ),
                                  })
                                }
                              />
                            </Field>
                          </div>
                          <div className="row small muted" style={{ marginTop: 8 }}>
                            <span>
                              {num(polygonArea(zone.polygon))} m² · {zone.polygon.length} sommets
                            </span>
                            <span className="spacer" />
                            <button
                              type="button"
                              className={editing ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                              onClick={() => editSurface(editing ? null : { kind: 'zone', id: zone.id })}
                            >
                              {editing ? '✓ Terminer' : '✎ Dessiner'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {!scene.zones.length ? <span className="small dim">Aucune surface dessinée.</span> : null}
                  </div>

                  <hr className="hr" />
                  <Field label={`Jauge : ${num(scene.audience)} personnes`}>
                    <input type="range" min={0} max={5000} step={25} value={scene.audience} onChange={(event) => patch({ audience: Number(event.target.value) }, false)} />
                  </Field>

                  <hr className="hr" />
                  <h3>Lumière & rendu</h3>
                  <Field label="Moment de la journée">
                    <Segmented
                      value={scene.timeOfDay}
                      options={[
                        { value: 'jour', label: 'Jour' },
                        { value: 'crepuscule', label: 'Crépuscule' },
                        { value: 'nuit', label: 'Nuit' },
                      ]}
                      onChange={(value) => patch({ timeOfDay: value as Scene['timeOfDay'] })}
                    />
                  </Field>
                  <Field label={`Orientation du soleil — ${num(scene.sunAzimuth)}°`}>
                    <input type="range" min={0} max={360} step={5} value={scene.sunAzimuth} onChange={(event) => patch({ sunAzimuth: Number(event.target.value) })} />
                  </Field>
                  <Field label="Qualité de rendu" hint="« Photo » ajoute l’anticrénelage et affine l’occlusion ambiante">
                    <Segmented
                      value={scene.quality}
                      options={[
                        { value: 'rapide', label: 'Rapide' },
                        { value: 'equilibre', label: 'Équilibré' },
                        { value: 'photo', label: 'Photo' },
                      ]}
                      onChange={(value) => patch({ quality: value as Scene['quality'] })}
                    />
                  </Field>
                  <Field label={`Lumière d’ambiance — ${num(scene.ambient * 100)} %`}>
                    <input type="range" min={0} max={1} step={0.02} value={scene.ambient} onChange={(event) => patch({ ambient: Number(event.target.value) }, false)} />
                  </Field>
                  <Field label={`Brouillard — ${num(scene.haze * 100)} %`}>
                    <input type="range" min={0} max={1} step={0.02} value={scene.haze} onChange={(event) => patch({ haze: Number(event.target.value) }, false)} />
                  </Field>
                  <Field label={`Exposition — ${num(scene.exposure, 2)}`}>
                    <input type="range" min={0.4} max={2} step={0.02} value={scene.exposure} onChange={(event) => patch({ exposure: Number(event.target.value) }, false)} />
                  </Field>
                  <Field label={`Halo lumineux — ${num(scene.bloom, 2)}`}>
                    <input type="range" min={0} max={1.6} step={0.02} value={scene.bloom} onChange={(event) => patch({ bloom: Number(event.target.value) }, false)} />
                  </Field>
                  <Field label="Couleur des murs">
                    <input type="color" value={scene.wallTone} onChange={(event) => patch({ wallTone: event.target.value }, false)} />
                  </Field>
                  <Field label="Notes">
                    <textarea rows={3} value={scene.notes} onChange={(event) => patch({ notes: event.target.value }, false)} />
                  </Field>
                </div>
              </Card>
            ) : null}

            {panel === 'objets' ? (
              <div className="stack">
                <Card>
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => setAdding(true)}>
                      + Ajouter un objet
                    </button>
                    <ManageCategoriesButton domain="objet3d" label="Familles" />
                  </div>
                </Card>

                {selectedItem && selectedDef && selectedSize ? (
                  <Card title={selectedItem.label} subtitle={`${selectedDef.family} · ${selectedDef.label}`}>
                    <div className="stack" style={{ gap: 10 }}>
                      <SelectedProductCard item={selectedItem} size={selectedSize} />
                      <Field label="Nom affiché">
                        <input value={selectedItem.label} onChange={(event) => patchItem(selectedItem.id, { label: event.target.value }, false)} />
                      </Field>
                      <Field label="Famille">
                        <CategorySelect
                          domain="objet3d"
                          value={selectedItem.categoryId}
                          onChange={(id) => patchItem(selectedItem.id, { categoryId: id }, false)}
                        />
                      </Field>

                      <h3>Dimensions (m)</h3>
                      <div className="grid g3" style={{ gap: 8 }}>
                        <Field label="Largeur">
                          <input
                            type="number"
                            min={0.05}
                            step={0.05}
                            value={num(selectedSize[0], 2).replace(',', '.')}
                            disabled={!selectedDef.resizable}
                            onChange={(event) => patchItem(selectedItem.id, { width: Number(event.target.value) })}
                          />
                        </Field>
                        <Field label="Hauteur">
                          <input
                            type="number"
                            min={0.05}
                            step={0.05}
                            value={num(selectedSize[1], 2).replace(',', '.')}
                            disabled={!selectedDef.resizable}
                            onChange={(event) => patchItem(selectedItem.id, { height: Number(event.target.value) })}
                          />
                        </Field>
                        <Field label="Profondeur">
                          <input
                            type="number"
                            min={0.05}
                            step={0.05}
                            value={num(selectedSize[2], 2).replace(',', '.')}
                            disabled={!selectedDef.resizable}
                            onChange={(event) => patchItem(selectedItem.id, { depth: Number(event.target.value) })}
                          />
                        </Field>
                      </div>
                      {!selectedDef.resizable ? (
                        <div className="small dim">
                          Matériel au gabarit fixe : ses cotes sont celles du produit réel.
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => patchItem(selectedItem.id, { width: null, height: null, depth: null })}
                        >
                          Revenir aux dimensions d’origine
                        </button>
                      )}

                      <h3>Position (m)</h3>
                      <div className="grid g3" style={{ gap: 8 }}>
                        <Field label="X — cour/jardin">
                          <input type="number" step={0.25} value={selectedItem.x} onChange={(event) => patchItem(selectedItem.id, { x: Number(event.target.value) })} />
                        </Field>
                        <Field label="Y — hauteur">
                          <input type="number" step={0.25} value={selectedItem.y} onChange={(event) => patchItem(selectedItem.id, { y: Number(event.target.value) })} />
                        </Field>
                        <Field label="Z — avant/arrière">
                          <input type="number" step={0.25} value={selectedItem.z} onChange={(event) => patchItem(selectedItem.id, { z: Number(event.target.value) })} />
                        </Field>
                      </div>
                      <Field label={`Rotation — ${num((selectedItem.rotY * 180) / Math.PI)}°`}>
                        <input type="range" min={-3.15} max={3.15} step={0.02} value={selectedItem.rotY} onChange={(event) => patchItem(selectedItem.id, { rotY: Number(event.target.value) }, false)} />
                      </Field>
                      <Field label={`Inclinaison — ${num((selectedItem.rotX * 180) / Math.PI)}°`}>
                        <input type="range" min={-1.2} max={1.2} step={0.02} value={selectedItem.rotX} onChange={(event) => patchItem(selectedItem.id, { rotX: Number(event.target.value) }, false)} />
                      </Field>

                      <div className="grid g2" style={{ gap: 8 }}>
                        <Field label={selectedDef.countable ? 'Quantité (unités)' : 'Quantité facturée'}>
                          <input type="number" min={1} value={selectedItem.qty} onChange={(event) => patchItem(selectedItem.id, { qty: Number(event.target.value) })} />
                        </Field>
                        <Field label="Couleur">
                          <input type="color" value={selectedItem.color} onChange={(event) => patchItem(selectedItem.id, { color: event.target.value })} />
                        </Field>
                      </div>
                      {selectedDef.beam ? (
                        <Field label={`Intensité du faisceau — ${num(selectedItem.beam * 100)} %`}>
                          <input type="range" min={0} max={1} step={0.05} value={selectedItem.beam} onChange={(event) => patchItem(selectedItem.id, { beam: Number(event.target.value) })} />
                        </Field>
                      ) : null}
                      <Field label="Matériel du catalogue" hint="Sert au chiffrage automatique">
                        <select
                          value={selectedItem.productId ?? ''}
                          onChange={(event) => patchItem(selectedItem.id, { productId: event.target.value || null }, false)}
                        >
                          <option value="">— non facturé —</option>
                          {db.products
                            .filter((product) => product.active)
                            .map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                              </option>
                            ))}
                        </select>
                      </Field>

                      <div className="row" style={{ gap: 6 }}>
                        <label className="row small nowrap" style={{ gap: 5, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={selectedItem.locked}
                            onChange={(event) => patchItem(selectedItem.id, { locked: event.target.checked })}
                          />
                          Verrouillé
                        </label>
                        <span className="spacer" />
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            pushHistory();
                            update((draft) => {
                              const target = draft.scenes.find((entry) => entry.id === sceneRef.current?.id);
                              if (!target) return;
                              target.items.push({ ...structuredClone(selectedItem), id: uid('si'), x: selectedItem.x + selectedSize[0] + 0.3 });
                            });
                          }}
                        >
                          Dupliquer
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            pushHistory();
                            update((draft) => {
                              const target = draft.scenes.find((entry) => entry.id === sceneRef.current?.id);
                              if (target) target.items = target.items.filter((item) => item.id !== selectedItem.id);
                            });
                            setSelected(null);
                          }}
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </Card>
                ) : null}

                {selection.length > 1 ? (
                  <Card title={`${selection.length} objets sélectionnés`} subtitle="Le gizmo agit sur l’ensemble">
                    <div className="stack-sm">
                      <div className="small dim">
                        Déplacement et échelle s’appliquent à tout le groupe ; la rotation se fait autour de la
                        verticale, au centre de la sélection.
                      </div>
                      <div className="row row-wrap" style={{ gap: 6 }}>
                        <button type="button" className="btn btn-sm" onClick={() => setArraying(true)}>
                          ⊞ Répéter en réseau
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => duplicateSelection()}>
                          Dupliquer
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            const lock = !scene.items.filter((item) => selection.includes(item.id)).every((item) => item.locked);
                            patchItems(selection.map((id) => ({ id, change: { locked: lock } })));
                          }}
                        >
                          🔒 Verrouiller / libérer
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setSelection([])}>
                          Désélectionner
                        </button>
                        <span className="spacer" />
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            pushHistory();
                            update((draft) => {
                              const target = draft.scenes.find((entry) => entry.id === sceneRef.current?.id);
                              if (target) target.items = target.items.filter((item) => !selection.includes(item.id));
                            });
                            setSelection([]);
                          }}
                        >
                          Supprimer ({selection.length})
                        </button>
                      </div>
                    </div>
                  </Card>
                ) : null}

                {families.length ? (
                  <Card title="Calques" subtitle="Masquer une famille sans la sortir du devis">
                    <div className="stack-sm">
                      {families.map(([family, count]) => {
                        const hidden = scene.hiddenFamilies.includes(family);
                        return (
                          <div key={family} className="row" style={{ gap: 8 }}>
                            <button
                              type="button"
                              className="btn btn-sm"
                              title={hidden ? 'Afficher' : 'Masquer'}
                              onClick={() =>
                                patch({
                                  hiddenFamilies: hidden
                                    ? scene.hiddenFamilies.filter((entry) => entry !== family)
                                    : [...scene.hiddenFamilies, family],
                                })
                              }
                            >
                              {hidden ? '🚫' : '👁'}
                            </button>
                            <span className="truncate" style={{ flex: 1, fontSize: 12.5, opacity: hidden ? 0.5 : 1 }}>
                              {family}
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              title="Sélectionner toute la famille"
                              onClick={() =>
                                setSelection(
                                  scene.items.filter((item) => objectDef(item.model3d).family === family).map((item) => item.id),
                                )
                              }
                            >
                              ⊹
                            </button>
                            <span className="small dim tnum">{count}</span>
                          </div>
                        );
                      })}
                      {scene.hiddenFamilies.length ? (
                        <button type="button" className="btn btn-sm" onClick={() => patch({ hiddenFamilies: [] })}>
                          Tout réafficher
                        </button>
                      ) : null}
                    </div>
                  </Card>
                ) : null}

                <Card title="Objets de la scène" subtitle={`${scene.items.length} élément(s)`} flush>
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {scene.items.map((item) => {
                      const def = objectDef(item.model3d);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="row"
                          style={{
                            width: '100%',
                            gap: 8,
                            padding: '7px 14px',
                            background: selection.includes(item.id) ? 'var(--surface-3)' : 'transparent',
                            border: 0,
                            borderBottom: '1px solid var(--line-soft)',
                            color: 'inherit',
                            font: 'inherit',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                          onClick={(event) =>
                            setSelection((current) =>
                              event.shiftKey
                                ? current.includes(item.id)
                                  ? current.filter((entry) => entry !== item.id)
                                  : [...current, item.id]
                                : [item.id],
                            )
                          }
                        >
                          <span aria-hidden="true">{def.icon}</span>
                          <span className="truncate" style={{ flex: 1, fontSize: 12.5 }}>
                            {item.label}
                          </span>
                          {item.locked ? <span className="small dim">🔒</span> : null}
                          <span className="small dim tnum">{item.qty > 1 ? `×${item.qty}` : ''}</span>
                        </button>
                      );
                    })}
                    {!scene.items.length ? <EmptyState mark="🎚️" title="Scène vide" hint="Ajoutez un objet de la bibliothèque." /> : null}
                  </div>
                </Card>
              </div>
            ) : null}

            {panel === 'chiffrage' ? (
              <div className="stack">
                <Card
                  title="Devis de l’implantation"
                  subtitle="Chaque objet posé, sa description, ses cotes et son prix"
                  flush
                >
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Désignation</th>
                          <th className="num">Qté</th>
                          <th className="num">P.U. HT</th>
                          <th className="num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quote.lines.map((line) => {
                          const product = db.products.find((entry) => entry.id === line.productId);
                          return (
                            <tr
                              key={line.id}
                              className="clickable"
                              onClick={() => setSelected(line.itemIds[0] ?? null)}
                            >
                              <td>
                                <div style={{ fontSize: 12.5 }}>{line.designation}</div>
                                <div className="small dim">{line.description}</div>
                                {product?.unit ? <div className="small dim">Unité de facturation : {product.unit}</div> : null}
                              </td>
                              <td className="num tnum">{num(line.qty)}</td>
                              <td className="num tnum">{money(line.unitPrice)}</td>
                              <td className="num tnum" style={{ fontWeight: 600 }}>
                                {money(line.qty * line.unitPrice)}
                              </td>
                            </tr>
                          );
                        })}
                        {!quote.lines.length ? (
                          <tr>
                            <td colSpan={4} className="center dim" style={{ padding: 20 }}>
                              Aucun matériel facturable dans cette scène.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3}>Total HT pour une journée</td>
                          <td className="num tnum">{money(quote.total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Card>

                {quote.extras.length ? (
                  <Card title="Éléments non facturés" subtitle="Décor du site et repères d’échelle">
                    <div className="stack-sm">
                      {quote.extras.map((extra) => (
                        <button
                          key={extra.itemId}
                          type="button"
                          className="row small"
                          style={{
                            gap: 8,
                            background: 'transparent',
                            border: 0,
                            padding: '4px 0',
                            color: 'inherit',
                            font: 'inherit',
                            width: '100%',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                          onClick={() => setSelected(extra.itemId)}
                        >
                          <span className="truncate" style={{ flex: 1 }}>
                            {extra.label}
                          </span>
                          <span className="dim tnum">
                            {num(extra.size[0], 2)} × {num(extra.size[1], 2)} × {num(extra.size[2], 2)} m
                          </span>
                        </button>
                      ))}
                    </div>
                  </Card>
                ) : null}

                <Card title="Bilan technique">
                  <div className="totals">
                    <div className="totals-row">
                      <span className="muted">Surface du terrain</span>
                      <span className="tnum">{num(groundArea(scene))} m²</span>
                    </div>
                    <div className="totals-row">
                      <span className="muted">Surface couverte</span>
                      <span className="tnum">{num(load.surface)} m²</span>
                    </div>
                    <div className="totals-row">
                      <span className="muted">Places assises</span>
                      <span className="tnum">{num(load.seats)}</span>
                    </div>
                    <div className="totals-row">
                      <span className="muted">Puissance appelée</span>
                      <span className="tnum">{num(load.power / 1000, 1)} kW</span>
                    </div>
                    <div className="totals-row">
                      <span className="muted">Poids matériel</span>
                      <span className="tnum">{num(load.weight)} kg</span>
                    </div>
                    <div className="totals-row">
                      <span className="muted">Volume de transport estimé</span>
                      <span className="tnum">{num(load.volume, 1)} m³</span>
                    </div>
                    <div className="totals-row grand">
                      <span>Total / jour HT</span>
                      <span className="tnum">{money0(quote.total)}</span>
                    </div>
                  </div>
                  {load.power > 32000 ? (
                    <div style={{ marginTop: 10 }}>
                      <Badge tone="warning" icon="⚡">
                        Au-delà de 32 kW : prévoir un groupe électrogène ou une armoire dédiée
                      </Badge>
                    </div>
                  ) : null}
                  {load.volume > 20 ? (
                    <div style={{ marginTop: 8 }}>
                      <Badge tone="info" icon="🚚">
                        Plus de 20 m³ : prévoir deux rotations ou un porteur
                      </Badge>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    style={{ marginTop: 12 }}
                    onClick={createQuote}
                    disabled={!quote.lines.length}
                  >
                    Générer le devis
                  </button>
                </Card>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {adding && scene ? <ObjectLibraryDialog onClose={() => setAdding(false)} onAdd={addObject} /> : null}

      {arraying && scene ? (
        <ArrayDialog
          count={selection.length}
          span={selectionSpan}
          onClose={() => setArraying(false)}
          onApply={(countX, stepX, countZ, stepZ) => {
            const created = arraySelection(countX, stepX, countZ, stepZ);
            setArraying(false);
            toast(created ? `${created} copie(s) posée(s).` : 'Rien à répéter.', created ? 'succes' : 'alerte');
          }}
        />
      ) : null}

      {confirmDelete && scene ? (
        <ConfirmDialog
          title="Supprimer cette scène ?"
          message={`« ${scene.name} » et son implantation seront définitivement supprimées.`}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            update((draft) => {
              draft.scenes = draft.scenes.filter((entry) => entry.id !== scene.id);
            });
            setConfirmDelete(false);
            toast('Scène supprimée.', 'alerte');
          }}
        />
      ) : null}
    </div>
  );
}

/** Rappel commercial de l'objet selectionne : ce qui partira dans le devis. */
/**
 * Repetition en reseau.
 *
 * Le pas est propose a l'emprise de la selection : c'est la valeur juste dans
 * la quasi-totalite des cas — des tables alignees, une rangee de barrieres —
 * et elle reste modifiable pour menager un passage entre les rangees.
 */
function ArrayDialog({
  count,
  span,
  onClose,
  onApply,
}: {
  count: number;
  span: { x: number; z: number };
  onClose: () => void;
  onApply: (countX: number, stepX: number, countZ: number, stepZ: number) => void;
}) {
  const [countX, setCountX] = useState(3);
  const [stepX, setStepX] = useState(span.x + 0.3);
  const [countZ, setCountZ] = useState(1);
  const [stepZ, setStepZ] = useState(span.z + 0.3);
  const copies = Math.max(0, countX * countZ - 1) * count;

  return (
    <Modal
      title="Répéter en réseau"
      subtitle={`${count} objet(s) recopiés sur une grille`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={copies <= 0}
            onClick={() => onApply(countX, stepX, countZ, stepZ)}
          >
            Poser {copies} copie(s)
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="grid g2" style={{ gap: 10 }}>
          <Field label="Colonnes (axe X)">
            <input type="number" min={1} max={60} step={1} value={countX} onChange={(event) => setCountX(Math.max(1, Number(event.target.value)))} />
          </Field>
          <Field label="Pas en X (m)">
            <input type="number" step={0.1} value={stepX} onChange={(event) => setStepX(Number(event.target.value))} />
          </Field>
          <Field label="Rangées (axe Z)">
            <input type="number" min={1} max={60} step={1} value={countZ} onChange={(event) => setCountZ(Math.max(1, Number(event.target.value)))} />
          </Field>
          <Field label="Pas en Z (m)">
            <input type="number" step={0.1} value={stepZ} onChange={(event) => setStepZ(Number(event.target.value))} />
          </Field>
        </div>
        <div className="small dim">
          Emprise de la sélection : {num(span.x, 2)} × {num(span.z, 2)} m. Un pas inférieur à l’emprise fait se
          chevaucher les copies.
        </div>
      </div>
    </Modal>
  );
}

function SelectedProductCard({ item, size }: { item: SceneItem; size: [number, number, number] }) {
  const { db } = useStore();
  const def = objectDef(item.model3d);
  const product =
    db.products.find((entry) => entry.id === item.productId) ??
    (def.product ? db.products.find((entry) => entry.id === productIdForRef(def.product!.ref)) : undefined);

  if (!product) {
    return (
      <div className="card" style={{ background: 'var(--surface-2)', padding: 10 }}>
        <div className="small dim">Élément de décor — non facturé</div>
        <div className="small muted" style={{ marginTop: 4 }}>
          {num(size[0], 2)} × {num(size[1], 2)} × {num(size[2], 2)} m
        </div>
      </div>
    );
  }

  const units = billableUnits(item.model3d, size, item.qty);
  const unitPrice = product.mode === 'vente' ? product.priceSale : product.priceDay;
  return (
    <div className="card" style={{ background: 'var(--surface-2)', padding: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 570 }}>{product.name}</div>
      <div className="small dim">
        {product.brand} {product.model} · réf. {product.ref}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        L {num(size[0], 2)} × H {num(size[1], 2)} × P {num(size[2], 2)} m
      </div>
      {Object.entries(product.specs).slice(0, 3).map(([key, value]) => (
        <div className="small dim" key={key}>
          {key} : {value}
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <span className="small muted">
          {num(units)} {product.unit}
          {units > 1 ? 's' : ''} × {money(unitPrice)}
        </span>
        <span className="spacer" />
        <span className="tnum" style={{ fontWeight: 600, color: 'var(--accent)' }}>
          {money(units * unitPrice)}
        </span>
      </div>
      {product.powerW ? (
        <div className="small dim" style={{ marginTop: 2 }}>
          {num(product.powerW * units)} W · {num(product.weightKg * units)} kg
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------- bibliothèque d’objets */

function ObjectLibraryDialog({
  onAdd,
  onClose,
}: {
  onAdd: (model3d: string, count: number) => void;
  onClose: () => void;
}) {
  const { categories } = useStore();
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('toutes');
  const [count, setCount] = useState(1);

  const families = categories('objet3d');
  const items = OBJECT_LIBRARY.filter((entry) => (family === 'toutes' ? true : entry.family === family)).filter((entry) =>
    `${entry.label} ${entry.family} ${entry.product?.brand ?? ''} ${entry.product?.name ?? ''} ${entry.hint ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <Modal
      title="Bibliothèque d’objets"
      subtitle={`${OBJECT_LIBRARY.length} références — son, lumière, vidéo, structure, mobilier, bar, abris, sanitaires, décor, logistique et sécurité`}
      size="xl"
      onClose={onClose}
    >
      <div className="row row-wrap" style={{ gap: 10, marginBottom: 12 }}>
        <div className="search" style={{ flex: 1, minWidth: 220 }}>
          <input autoFocus placeholder="Rechercher un objet…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <select value={family} onChange={(event) => setFamily(event.target.value)} style={{ width: 210 }}>
          <option value="toutes">Toutes les familles</option>
          {families.map((category) => (
            <option key={category.id} value={category.label}>
              {category.icon} {category.label}
            </option>
          ))}
        </select>
        <div className="row" style={{ gap: 6 }}>
          <span className="small muted nowrap">Quantité</span>
          <input type="number" min={1} max={64} value={count} onChange={(event) => setCount(Number(event.target.value))} style={{ width: 78 }} />
        </div>
        <ManageCategoriesButton domain="objet3d" label="Familles" />
      </div>

      <div className="grid g4" style={{ maxHeight: '58vh', overflowY: 'auto', gap: 8 }}>
        {items.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="card"
            style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}
            onClick={() => onAdd(entry.id, count)}
          >
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontSize: 22 }}>{entry.icon}</span>
              <div style={{ minWidth: 0 }}>
                <div className="truncate" style={{ fontSize: 12.5, fontWeight: 570 }}>
                  {entry.label}
                </div>
                <div className="small dim truncate">{entry.family}</div>
              </div>
            </div>
            {entry.product ? (
              <div className="small dim truncate" style={{ marginTop: 6 }}>
                {entry.product.brand} {entry.product.model}
              </div>
            ) : null}
            <div className="small muted" style={{ marginTop: 4 }}>
              {num(entry.size[0], 2)} × {num(entry.size[1], 2)} × {num(entry.size[2], 2)} m
              {entry.resizable ? <span className="dim"> · redimensionnable</span> : null}
            </div>
            {entry.hint ? <div className="small dim" style={{ marginTop: 4 }}>{entry.hint}</div> : null}
            {entry.product ? (
              <div className="small" style={{ marginTop: 6, color: 'var(--accent)' }}>
                {money(entry.product.mode === 'vente' ? entry.product.priceSale : entry.product.priceDay)} / {entry.product.unit}
                {entry.product.mode === 'location' ? ' / jour' : ''}
              </div>
            ) : (
              <div className="small dim" style={{ marginTop: 6 }}>Décor — non facturé</div>
            )}
          </button>
        ))}
        {!items.length ? <EmptyState mark="🔍" title="Aucun objet ne correspond" /> : null}
      </div>
    </Modal>
  );
}
