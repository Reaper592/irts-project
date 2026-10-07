/**
 * Synchronisation multi-postes.
 *
 * Le magasin local reste la source de verite de l'affichage ; quand un serveur
 * IRTS est joignable, chaque modification est envoyee enregistrement par
 * enregistrement et les autres postes sont prevenus par un flux SSE.
 *
 * La fusion se fait par fiche : deux personnes qui editent deux clients
 * differents ne s'ecrasent jamais ; sur la meme fiche, la derniere ecriture
 * l'emporte, ce qui reste le comportement attendu d'un outil de gestion a
 * quelques utilisateurs.
 */
import type { Database } from './types';

export type SyncStatus = 'local' | 'connexion' | 'connecte' | 'erreur';

export interface Presence {
  id: string;
  nom: string;
  depuis: string;
}

export interface SyncOp {
  kind: 'upsert' | 'delete' | 'settings' | 'company';
  collection?: string;
  id?: string;
  value?: unknown;
}

/** Collections fusionnees fiche par fiche. */
const COLLECTIONS = [
  'clients',
  'deals',
  'products',
  'packs',
  'docs',
  'projects',
  'staff',
  'assignments',
  'expenses',
  'tickets',
  'pages',
  'scenes',
  'tasks',
  'categories',
] as const;

/**
 * Operations a envoyer pour passer de `prev` a `next`.
 * On compare par identifiant et par contenu serialise : c'est suffisant pour
 * des collections de quelques milliers de fiches et cela evite toute
 * dependance a une bibliotheque de diff.
 */
export function computeOps(prev: Database, next: Database): SyncOp[] {
  const ops: SyncOp[] = [];

  for (const collection of COLLECTIONS) {
    const before = new Map(((prev[collection] ?? []) as { id: string }[]).map((entry) => [entry.id, entry]));
    const after = new Map(((next[collection] ?? []) as { id: string }[]).map((entry) => [entry.id, entry]));

    for (const [id, entry] of after) {
      const previous = before.get(id);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(entry)) {
        ops.push({ kind: 'upsert', collection, id, value: entry });
      }
    }
    for (const id of before.keys()) {
      if (!after.has(id)) ops.push({ kind: 'delete', collection, id });
    }
  }

  for (const company of next.companies) {
    const previous = prev.companies.find((entry) => entry.id === company.id);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(company)) {
      ops.push({ kind: 'company', id: company.id, value: company });
    }
  }

  if (JSON.stringify(prev.settings) !== JSON.stringify(next.settings)) {
    ops.push({ kind: 'settings', value: next.settings });
  }

  return ops;
}

/** Reglages purement locaux : ils ne doivent pas voyager d'un poste a l'autre. */
export const LOCAL_SETTINGS: (keyof Database['settings'])[] = ['activeScope', 'operator', 'station'];

export function stripLocalSettings(settings: Database['settings']): Partial<Database['settings']> {
  const copy: Record<string, unknown> = { ...settings };
  for (const key of LOCAL_SETTINGS) delete copy[key];
  return copy as Partial<Database['settings']>;
}

export interface ServerInfo {
  revision: number;
  initialisee: boolean;
  postes: number;
}

const BASE = '/api';

export async function probeServer(signal?: AbortSignal): Promise<ServerInfo | null> {
  try {
    const response = await fetch(`${BASE}/sante`, { signal, cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as ServerInfo & { service?: string };
    return body.service === 'irts-suite' ? body : null;
  } catch {
    return null;
  }
}

export async function pullState(): Promise<{ revision: number; db: Database | null; postes: Presence[] }> {
  const response = await fetch(`${BASE}/etat`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`lecture impossible (${response.status})`);
  return (await response.json()) as { revision: number; db: Database | null; postes: Presence[] };
}

/** Depose la base locale comme base de reference du serveur. */
export async function seedServer(db: Database, forcer = false): Promise<number> {
  const response = await fetch(`${BASE}/etat`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ db, forcer }),
  });
  const body = (await response.json()) as { revision?: number; erreur?: string };
  if (!response.ok) throw new Error(body.erreur ?? `initialisation refusée (${response.status})`);
  return body.revision ?? 0;
}

export async function pushOps(ops: SyncOp[], poste: string): Promise<number> {
  const response = await fetch(`${BASE}/ops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops, poste }),
  });
  const body = (await response.json()) as { revision?: number; erreur?: string };
  if (!response.ok) throw new Error(body.erreur ?? `envoi refusé (${response.status})`);
  return body.revision ?? 0;
}

/** Flux d'evenements du serveur. Renvoie la fonction de fermeture. */
export function openStream(
  poste: string,
  nom: string,
  handlers: { onRevision: (revision: number) => void; onPresence: (postes: Presence[]) => void; onError: () => void },
): () => void {
  const source = new EventSource(`${BASE}/flux?poste=${encodeURIComponent(poste)}&nom=${encodeURIComponent(nom)}`);
  source.addEventListener('revision', (event) => {
    try {
      handlers.onRevision((JSON.parse((event as MessageEvent).data) as { revision: number }).revision);
    } catch {
      /* trame illisible : ignoree */
    }
  });
  source.addEventListener('presence', (event) => {
    try {
      handlers.onPresence(JSON.parse((event as MessageEvent).data) as Presence[]);
    } catch {
      /* trame illisible : ignoree */
    }
  });
  source.onerror = () => handlers.onError();
  return () => source.close();
}

/** Identifiant stable du poste, conserve d'une session a l'autre. */
export function stationId(): string {
  const key = 'irts.poste';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = `poste_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, created);
    return created;
  } catch {
    return `poste_${Math.random().toString(36).slice(2, 10)}`;
  }
}
