import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { StoreProvider, useStore } from './core/store';
import { NavContext, type ViewId } from './core/nav';
import { docTotals, effectiveStatus } from './core/calc';
import { money, today } from './core/utils';
import type { Scope } from './core/types';
import Dashboard from './modules/Dashboard';
import Prospection from './modules/Prospection';
import Clients from './modules/Clients';
import Documents from './modules/Documents';
import Projets from './modules/Projets';
import Planning from './modules/Planning';
import Catalogue from './modules/Catalogue';
import Maintenance from './modules/Maintenance';
import SiteProspection from './modules/SiteProspection';
import Finance from './modules/Finance';
import Equipe from './modules/Equipe';
import Taches from './modules/Taches';
import Parametres from './modules/Parametres';

// Le Studio embarque le moteur 3D : il n'est charge que lorsqu'on l'ouvre.
const Studio = lazy(() => import('./modules/studio/Studio'));

interface NavEntry {
  id: ViewId;
  label: string;
  icon: string;
  group: string;
}

const NAV: NavEntry[] = [
  { id: 'pilotage', label: 'Pilotage', icon: '◎', group: 'Direction' },
  { id: 'taches', label: 'Tâches', icon: '✓', group: 'Direction' },
  { id: 'prospection', label: 'Prospection', icon: '◈', group: 'Commerce' },
  { id: 'site', label: 'Site de prospection', icon: '⬡', group: 'Commerce' },
  { id: 'clients', label: 'Clients', icon: '☺', group: 'Commerce' },
  { id: 'devis', label: 'Devis', icon: '▤', group: 'Commerce' },
  { id: 'factures', label: 'Factures', icon: '▦', group: 'Commerce' },
  { id: 'studio', label: 'Studio 3D', icon: '◱', group: 'Production' },
  { id: 'projets', label: 'Projets', icon: '▣', group: 'Production' },
  { id: 'planning', label: 'Planning', icon: '▩', group: 'Production' },
  { id: 'catalogue', label: 'Catalogue & parc', icon: '▥', group: 'Production' },
  { id: 'maintenance', label: 'Maintenance', icon: '⚙', group: 'Production' },
  { id: 'equipe', label: 'Équipe', icon: '⚇', group: 'Ressources' },
  { id: 'finance', label: 'Finance', icon: '€', group: 'Ressources' },
  { id: 'parametres', label: 'Paramètres', icon: '⚒', group: 'Ressources' },
];

const TITLES: Record<ViewId, string> = {
  pilotage: 'Pilotage',
  taches: 'Tâches',
  prospection: 'Prospection',
  site: 'Site de prospection',
  clients: 'Clients',
  devis: 'Devis',
  factures: 'Factures',
  studio: 'Studio 3D',
  projets: 'Projets',
  planning: 'Planning',
  catalogue: 'Catalogue & parc',
  maintenance: 'Maintenance',
  equipe: 'Équipe',
  finance: 'Finance',
  parametres: 'Paramètres',
};

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

/** Etat du partage reseau, visible en permanence dans la barre du haut. */
function SyncIndicator() {
  const { sync } = useStore();
  const config =
    sync.status === 'connecte'
      ? { icon: '🟢', label: `Partagé · ${sync.presence.length || 1} poste${sync.presence.length > 1 ? 's' : ''}`, tone: 'good' as const }
      : sync.status === 'connexion'
        ? { icon: '🟡', label: 'Connexion…', tone: 'warning' as const }
        : sync.status === 'erreur'
          ? { icon: '🔴', label: 'Serveur injoignable', tone: 'critical' as const }
          : { icon: '💾', label: 'Local', tone: 'neutre' as const };
  return (
    <span
      className="badge"
      title={
        sync.status === 'connecte'
          ? `Base partagée — révision ${sync.revision}${sync.presence.length ? ` — ${sync.presence.map((poste) => poste.nom).join(', ')}` : ''}`
          : 'Base locale à ce poste. Lancez « npm start » pour partager la base sur le réseau.'
      }
      style={{
        borderColor: config.tone === 'good' ? 'rgba(12,163,12,0.35)' : undefined,
      }}
    >
      <span aria-hidden="true">{config.icon}</span>
      {config.label}
    </span>
  );
}

function Shell() {
  const store = useStore();
  const { db, scope, setScope, company, visible, toasts, dismissToast, sync } = store;
  const [view, setView] = useState<ViewId>('pilotage');
  const [focus, setFocus] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const go = (next: ViewId, id: string | null = null) => {
    setView(next);
    setFocus(id);
    window.scrollTo({ top: 0 });
  };

  /* L'accent de l'interface suit la societe active : le contexte reste lisible. */
  useEffect(() => {
    const root = document.documentElement;
    const accent = company?.accent ?? '#3987e5';
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-soft', company?.accentSoft ?? 'rgba(57,135,229,0.16)');
    root.style.setProperty('--accent-line', `${accent}6b`);
  }, [company]);

  const counts = useMemo(() => {
    const docs = visible(db.docs);
    const quotes = docs.filter((doc) => doc.kind === 'devis' && ['envoye', 'brouillon'].includes(doc.status));
    const late = docs.filter((doc) => {
      if (doc.kind === 'devis') return false;
      const totals = docTotals(doc, db.products);
      return effectiveStatus(doc, totals) === 'retard';
    });
    return {
      devis: quotes.length,
      factures: late.length,
      taches: visible(db.tasks).filter((task) => !task.done && task.due <= today()).length,
      prospection: visible(db.deals).filter((deal) => !['gagne', 'perdu'].includes(deal.stage)).length,
      maintenance: visible(db.tickets).filter((ticket) => ticket.status !== 'clos').length,
    } as Partial<Record<ViewId, number>>;
  }, [db, visible]);

  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length < 2) return [];
    const out: { label: string; hint: string; view: ViewId; id: string }[] = [];
    for (const client of visible(db.clients)) {
      if (client.name.toLowerCase().includes(query)) {
        out.push({ label: client.name, hint: `Client · ${client.city}`, view: 'clients', id: client.id });
      }
    }
    for (const doc of visible(db.docs)) {
      if (`${doc.number} ${doc.title}`.toLowerCase().includes(query)) {
        out.push({
          label: `${doc.number} — ${doc.title || 'sans objet'}`,
          hint: `${doc.kind} · ${money(docTotals(doc, db.products).totalTTC)}`,
          view: doc.kind === 'devis' ? 'devis' : 'factures',
          id: doc.id,
        });
      }
    }
    for (const product of visible(db.products)) {
      if (`${product.name} ${product.ref}`.toLowerCase().includes(query)) {
        out.push({ label: product.name, hint: `Catalogue · ${product.category}`, view: 'catalogue', id: product.id });
      }
    }
    for (const project of visible(db.projects)) {
      if (project.name.toLowerCase().includes(query)) {
        out.push({ label: project.name, hint: `Projet · ${project.venue}`, view: 'projets', id: project.id });
      }
    }
    return out.slice(0, 8);
  }, [search, db, visible]);

  const groups = [...new Set(NAV.map((entry) => entry.group))];

  return (
    <NavContext.Provider value={{ view, focus, go }}>
      <div className="app">
        <nav className="nav">
          <div className="nav-brand">
            <div className="nav-logo">IRTS</div>
            <div style={{ minWidth: 0 }}>
              <div className="nav-brand-name">IRTS Suite</div>
              <div className="nav-brand-sub truncate">Marée Sonore · MSR · Owlaris</div>
            </div>
          </div>

          <div className="nav-scope">
            <div className="nav-scope-label">Périmètre</div>
            <button type="button" className="scope-btn" aria-pressed={scope === 'groupe'} onClick={() => setScope('groupe')}>
              <span className="scope-dot" style={{ background: 'linear-gradient(90deg,#3987e5,#199e70,#9085e9)' }} />
              <span>
                <span style={{ display: 'block' }}>Groupe</span>
                <span className="small dim">Vue consolidée</span>
              </span>
            </button>
            {db.companies.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="scope-btn"
                aria-pressed={scope === entry.id}
                onClick={() => setScope(entry.id as Scope)}
              >
                <span className="scope-dot" style={{ background: entry.accent }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block' }}>{entry.name}</span>
                  <span className="small dim truncate" style={{ display: 'block' }}>
                    {entry.activity}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="nav-sections">
            {groups.map((group) => (
              <div key={group}>
                <div className="nav-group-label">{group}</div>
                {NAV.filter((entry) => entry.group === group).map((entry) => {
                  const count = counts[entry.id];
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="nav-item"
                      aria-current={view === entry.id ? 'page' : undefined}
                      onClick={() => go(entry.id)}
                    >
                      <span className="nav-icon" aria-hidden="true">
                        {entry.icon}
                      </span>
                      <span className="truncate">{entry.label}</span>
                      {count ? (
                        <span className={`nav-count${entry.id === 'factures' ? ' alert' : ''}`}>{count}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="nav-foot">
            <div>{db.settings.operator}</div>
            <div className="dim">
              {sync.status === 'connecte'
                ? `${db.settings.station} · base partagée`
                : 'Base locale — pensez à exporter'}
            </div>
          </div>
        </nav>

        <div className="main">
          <header className="topbar">
            <div className="topbar-title">
              <strong>{TITLES[view]}</strong>
              <span>{company ? `${company.legalName} · ${company.city}` : 'Vue consolidée des trois sociétés'}</span>
            </div>
            <div className="topbar-actions">
              <SyncIndicator />
              <div className="search" style={{ width: 300, position: 'relative' }}>
                <input
                  placeholder="Rechercher un client, un devis, du matériel…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {results.length ? (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      marginTop: 6,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-md)',
                      boxShadow: 'var(--shadow-2)',
                      overflow: 'hidden',
                      zIndex: 40,
                    }}
                  >
                    {results.map((result) => (
                      <button
                        key={`${result.view}_${result.id}`}
                        type="button"
                        className="row"
                        style={{
                          width: '100%',
                          gap: 8,
                          padding: '8px 12px',
                          background: 'transparent',
                          border: 0,
                          borderBottom: '1px solid var(--line-soft)',
                          color: 'inherit',
                          font: 'inherit',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                        onClick={() => {
                          go(result.view, result.id);
                          setSearch('');
                        }}
                      >
                        <span className="truncate" style={{ flex: 1, fontSize: 12.5 }}>
                          {result.label}
                        </span>
                        <span className="small dim nowrap">{result.hint}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <main>
            {view === 'pilotage' ? <Dashboard /> : null}
            {view === 'taches' ? <Taches /> : null}
            {view === 'prospection' ? <Prospection /> : null}
            {view === 'site' ? <SiteProspection /> : null}
            {view === 'clients' ? <Clients /> : null}
            {view === 'devis' ? <Documents kind="devis" /> : null}
            {view === 'factures' ? <Documents kind="facture" /> : null}
            {view === 'studio' ? (
              <Suspense
                fallback={
                  <div className="view">
                    <div className="card center muted" style={{ padding: 48 }}>
                      Chargement du moteur de rendu 3D…
                    </div>
                  </div>
                }
              >
                <Studio />
              </Suspense>
            ) : null}
            {view === 'projets' ? <Projets /> : null}
            {view === 'planning' ? <Planning /> : null}
            {view === 'catalogue' ? <Catalogue /> : null}
            {view === 'maintenance' ? <Maintenance /> : null}
            {view === 'equipe' ? <Equipe /> : null}
            {view === 'finance' ? <Finance /> : null}
            {view === 'parametres' ? <Parametres /> : null}
          </main>
        </div>

        <div className="toasts">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast ${toast.tone}`}>
              <span aria-hidden="true">{toast.tone === 'succes' ? '✔' : toast.tone === 'alerte' ? '⚠' : 'ℹ'}</span>
              <span>{toast.message}</span>
              <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Fermer">
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </NavContext.Provider>
  );
}
