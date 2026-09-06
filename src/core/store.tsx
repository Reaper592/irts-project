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
import type { Company, Database, DocKind, EntityId, Scope } from './types';
import { createSeedDatabase } from './seed';
import { inScope } from './utils';

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
    // Le jeu de demonstration fait foi pour les societes : on garde les reglages edites.
    return { ...createSeedDatabase(), ...parsed };
  } catch {
    return createSeedDatabase();
  }
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
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database>(loadDatabase);
  const [toasts, setToasts] = useState<StoreApi['toasts']>([]);
  const toastSeq = useRef(0);
  const saveTimer = useRef<number | null>(null);

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

  const update = useCallback((mutate: (draft: Database) => void) => {
    setDb((current) => {
      const draft = structuredClone(current) as Database;
      mutate(draft);
      return draft;
    });
  }, []);

  const setScope = useCallback(
    (scope: Scope) => update((draft) => void (draft.settings.activeScope = scope)),
    [update],
  );

  const toast = useCallback((message: string, tone: 'info' | 'succes' | 'alerte' = 'info') => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((list) => [...list, { id, message, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((entry) => entry.id !== id)), 4200);
  }, []);

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
        setDb(createSeedDatabase());
      },
      replace: (next: Database) => setDb(next),
      visible: <T extends { entity: EntityId }>(items: T[]) =>
        items.filter((entry) => inScope(entry.entity, scope)),
      toast,
      toasts,
      dismissToast,
    };
  }, [db, scope, setScope, update, nextNumber, toast, toasts, dismissToast]);

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore doit être utilisé à l’intérieur de <StoreProvider>');
  return store;
}
