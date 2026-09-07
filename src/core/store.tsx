import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Category, Company, Database, DocKind, EntityId, Scope, TaxonomyDomain } from './types';
import { createSeedDatabase } from './seed';
import { inScope } from './utils';
import {
  computeOps,
  openStream,
  probeServer,
  pullState,
  pushOps,
  seedServer,
  stationId,
  stripLocalSettings,
  type Presence,
  type SyncOp,
  type SyncStatus,
} from './sync';

const STORAGE_KEY = 'irts.suite.v1';

function loadDatabase(): Database {
  if (typeof localStorage === 'undefined') return createSeedDatabase();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedDatabase();
    const parsed = JSON.parse(raw) as Database;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.clients)) {
      return createSeedDatabase();
    }
    return migrate(parsed);
  } catch {
    return createSeedDatabase();
  }
}

/**
 * Compatibilite ascendante : une base enregistree par une version anterieure
 * doit continuer a s'ouvrir, avec les collections et champs manquants remplis
 * par leurs valeurs par defaut.
 */
export function migrate(db: Partial<Database>): Database {
  const seed = createSeedDatabase();
  const merged: Database = {
    ...seed,
    ...db,
    companies: db.companies?.length ? db.companies : seed.companies,
    categories: db.categories?.length ? db.categories : seed.categories,
    settings: { ...seed.settings, ...db.settings },
  } as Database;

  merged.products = (merged.products ?? []).map((product) => ({
    ...product,
    categoryId: product.categoryId ?? null,
    attributes: product.attributes ?? {},
  }));
  merged.projects = (merged.projects ?? []).map((project) => ({
    ...project,
    categoryId: project.categoryId ?? null,
  }));
  merged.scenes = (merged.scenes ?? []).map((scene) => ({
    ...scene,
    groundShape: scene.groundShape ?? 'rectangle',
    polygon: scene.polygon?.length ? scene.polygon : defaultPolygon(scene.width ?? 20, scene.depth ?? 16),
    zones: (scene.zones ?? []).map((zone) => ({
      ...zone,
      elevation: zone.elevation ?? 0,
      visible: zone.visible ?? true,
      polygon: zone.polygon ?? [],
    })),
    gridSnap: scene.gridSnap ?? 0.25,
    showGrid: scene.showGrid ?? true,
    quality: scene.quality ?? 'equilibre',
    // Le sol etait une couleur ; il designe maintenant une nature de surface.
    floorTone: scene.floorTone?.startsWith('#') ? 'beton' : scene.floorTone ?? 'beton',
    sunAzimuth: scene.sunAzimuth ?? 135,
    items: (scene.items ?? []).map((item) => ({
      ...item,
      categoryId: item.categoryId ?? null,
      rotX: item.rotX ?? 0,
      width: item.width ?? null,
      height: item.height ?? null,
      depth: item.depth ?? null,
      locked: item.locked ?? false,
      notes: item.notes ?? '',
    })),
  }));
  return merged;
}

/** Emprise par defaut : le rectangle du terrain, prete a etre deformee. */
function defaultPolygon(width: number, depth: number) {
  return [
    { x: -width / 2, z: -depth / 2 },
    { x: width / 2, z: -depth / 2 },
    { x: width / 2, z: depth / 2 },
    { x: -width / 2, z: depth / 2 },
  ];
}

export interface StoreApi {
  db: Database;
  scope: Scope;
  setScope: (scope: Scope) => void;
  /** Societe active, ou null en vue consolidee « groupe ». */
  company: Company | null;
  companyOf: (entity: EntityId) => Company;
  /** Societe a utiliser par defaut a la creation d'un document. */
  defaultEntity: EntityId;
  update: (mutate: (draft: Database) => void) => void;
  /** Reserve le prochain numero de document et l'incremente. */
  nextNumber: (entity: EntityId, kind: DocKind) => string;
  reset: () => void;
  replace: (next: Database) => void;
  visible: <T extends { entity: EntityId }>(items: T[]) => T[];
  toast: (message: string, tone?: 'info' | 'succes' | 'alerte') => void;
  toasts: { id: number; message: string; tone: 'info' | 'succes' | 'alerte' }[];
  dismissToast: (id: number) => void;

  /* ------------------------------------------------------------ taxonomie */
  categories: (domain: TaxonomyDomain, entity?: EntityId | 'groupe') => Category[];
  categoryById: (id: string | null | undefined) => Category | null;
  saveCategory: (category: Category) => void;
  deleteCategory: (id: string, reassignTo: string | null) => void;

  /* --------------------------------------------------------- partage reseau */
  sync: {
    status: SyncStatus;
    /** Nombre de postes connectes au serveur partage, ce poste compris. */
    presence: Presence[];
    revision: number;
    lastError: string | null;
    /** Renvoie la base locale au serveur comme base de reference. */
    publishLocal: () => Promise<void>;
    refresh: () => Promise<void>;
  };
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database>(loadDatabase);
  const [toasts, setToasts] = useState<StoreApi['toasts']>([]);
  const [status, setStatus] = useState<SyncStatus>('local');
  const [presence, setPresence] = useState<Presence[]>([]);
  const [revision, setRevision] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const toastSeq = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const pushTimer = useRef<number | null>(null);
  const dbRef = useRef(db);
  /** Derniere base connue du serveur : base de calcul des operations a envoyer. */
  const syncedRef = useRef<Database | null>(null);
  const statusRef = useRef<SyncStatus>('local');
  const station = useMemo(() => stationId(), []);

  dbRef.current = db;
  statusRef.current = status;

  /* ------------------------------------------------------ persistance locale */

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      } catch {
        /* quota depasse : l'application continue en memoire */
      }
    }, 250);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [db]);

  const toast = useCallback((message: string, tone: 'info' | 'succes' | 'alerte' = 'info') => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((list) => [...list, { id, message, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((entry) => entry.id !== id)), 4200);
  }, []);

  /* ---------------------------------------------------------- synchronisation */

  /** Adopte la base du serveur en conservant les reglages propres au poste. */
  const adoptRemote = useCallback((remote: Database) => {
    const migrated = migrate(remote);
    setDb((current) => {
      const next: Database = {
        ...migrated,
        settings: {
          ...migrated.settings,
          activeScope: current.settings.activeScope,
          operator: current.settings.operator,
          station: current.settings.station,
        },
      };
      syncedRef.current = next;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const remote = await pullState();
      setRevision(remote.revision);
      setPresence(remote.postes ?? []);
      if (remote.db) adoptRemote(remote.db);
      setLastError(null);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    }
  }, [adoptRemote]);

  const publishLocal = useCallback(async () => {
    const next = await seedServer(dbRef.current, true);
    syncedRef.current = dbRef.current;
    setRevision(next);
    setStatus('connecte');
    toast('Base locale publiée sur le serveur partagé.', 'succes');
  }, [toast]);

  useEffect(() => {
    let closed = false;
    let closeStream: (() => void) | null = null;

    (async () => {
      setStatus('connexion');
      const info = await probeServer();
      if (closed) return;
      if (!info) {
        setStatus('local');
        return;
      }
      try {
        if (!info.initialisee) {
          // Premier poste a se connecter : il fournit la base de depart.
          await seedServer(dbRef.current);
          syncedRef.current = dbRef.current;
        } else {
          const remote = await pullState();
          if (remote.db) adoptRemote(remote.db);
          setRevision(remote.revision);
          setPresence(remote.postes ?? []);
        }
        if (closed) return;
        setStatus('connecte');
        setLastError(null);
        closeStream = openStream(station, dbRef.current.settings.station || dbRef.current.settings.operator, {
          onRevision: (next) => {
            setRevision((current) => {
              if (next > current) void refresh();
              return Math.max(current, next);
            });
          },
          onPresence: setPresence,
          onError: () => setStatus((current) => (current === 'connecte' ? 'connexion' : current)),
        });
      } catch (error) {
        if (closed) return;
        setStatus('erreur');
        setLastError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      closed = true;
      closeStream?.();
    };
  }, [adoptRemote, refresh, station]);

  /** Envoie au serveur ce qui a change depuis la derniere synchronisation. */
  const schedulePush = useCallback(() => {
    if (statusRef.current !== 'connecte') return;
    if (pushTimer.current) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(async () => {
      const base = syncedRef.current;
      const current = dbRef.current;
      if (!base) return;
      const ops: SyncOp[] = computeOps(base, current).filter((op) => {
        if (op.kind !== 'settings') return true;
        const before = JSON.stringify(stripLocalSettings(base.settings));
        const after = JSON.stringify(stripLocalSettings(current.settings));
        if (before === after) return false;
        op.value = stripLocalSettings(current.settings);
        return true;
      });
      if (!ops.length) return;
      try {
        const next = await pushOps(ops, station);
        syncedRef.current = current;
        setRevision(next);
        setLastError(null);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : String(error));
      }
    }, 400);
  }, [station]);

  const update = useCallback(
    (mutate: (draft: Database) => void) => {
      setDb((current) => {
        const draft = structuredClone(current) as Database;
        mutate(draft);
        return draft;
      });
      schedulePush();
    },
    [schedulePush],
  );

  const replace = useCallback(
    (next: Database) => {
      setDb(migrate(next));
      schedulePush();
    },
    [schedulePush],
  );

  const setScope = useCallback(
    (scope: Scope) => update((draft) => void (draft.settings.activeScope = scope)),
    [update],
  );

  const dismissToast = useCallback(
    (id: number) => setToasts((list) => list.filter((entry) => entry.id !== id)),
    [],
  );

  const nextNumber = useCallback(
    (entity: EntityId, kind: DocKind) => {
      const company = db.companies.find((item) => item.id === entity)!;
      const prefix =
        kind === 'devis' ? company.quotePrefix : kind === 'facture' ? company.invoicePrefix : company.creditPrefix;
      const current = db.settings.numbering[entity]?.[kind] ?? 0;
      const next = current + 1;
      update((draft) => {
        draft.settings.numbering[entity] ||= { devis: 0, facture: 0, avoir: 0 };
        draft.settings.numbering[entity][kind] = next;
      });
      return `${prefix}-${new Date().getFullYear()}-${String(next).padStart(4, '0')}`;
    },
    [db.companies, db.settings.numbering, update],
  );

  const scope = db.settings.activeScope;

  const api = useMemo<StoreApi>(() => {
    const companyOf = (entity: EntityId) =>
      db.companies.find((item) => item.id === entity) ?? db.companies[0];

    const categories = (domain: TaxonomyDomain, entity?: EntityId | 'groupe') =>
      db.categories
        .filter((category) => category.domain === domain && !category.archived)
        .filter((category) => {
          if (!entity || entity === 'groupe') return true;
          return category.entity === 'groupe' || category.entity === entity;
        })
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

    return {
      db,
      scope,
      setScope,
      company: scope === 'groupe' ? null : companyOf(scope),
      companyOf,
      defaultEntity: scope === 'groupe' ? 'msr' : scope,
      update,
      nextNumber,
      reset: () => {
        localStorage.removeItem(STORAGE_KEY);
        const seed = createSeedDatabase();
        setDb(seed);
        schedulePush();
      },
      replace,
      visible: <T extends { entity: EntityId }>(items: T[]) =>
        items.filter((entry) => inScope(entry.entity, scope)),
      toast,
      toasts,
      dismissToast,

      categories,
      categoryById: (id) => (id ? db.categories.find((category) => category.id === id) ?? null : null),
      saveCategory: (category) =>
        update((draft) => {
          const index = draft.categories.findIndex((entry) => entry.id === category.id);
          if (index >= 0) draft.categories[index] = category;
          else draft.categories.push(category);
        }),
      deleteCategory: (id, reassignTo) =>
        update((draft) => {
          const target = draft.categories.find((entry) => entry.id === id);
          if (!target) return;
          const replacement = reassignTo ? draft.categories.find((entry) => entry.id === reassignTo) : null;
          // Rien n'est laisse orphelin : les elements basculent sur la categorie choisie.
          for (const product of draft.products) {
            if (product.categoryId === id) {
              product.categoryId = replacement?.id ?? null;
              product.category = replacement?.label ?? '';
            }
          }
          for (const expense of draft.expenses) if (expense.category === id) expense.category = replacement?.id ?? '';
          for (const project of draft.projects) if (project.categoryId === id) project.categoryId = replacement?.id ?? null;
          for (const scene of draft.scenes) {
            for (const item of scene.items) if (item.categoryId === id) item.categoryId = replacement?.id ?? null;
          }
          for (const child of draft.categories) if (child.parentId === id) child.parentId = replacement?.id ?? null;
          draft.categories = draft.categories.filter((entry) => entry.id !== id);
        }),

      sync: { status, presence, revision, lastError, publishLocal, refresh },
    };
  }, [
    db,
    scope,
    setScope,
    update,
    replace,
    nextNumber,
    toast,
    toasts,
    dismissToast,
    schedulePush,
    status,
    presence,
    revision,
    lastError,
    publishLocal,
    refresh,
  ]);

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore doit être utilisé à l’intérieur de <StoreProvider>');
  return store;
}
