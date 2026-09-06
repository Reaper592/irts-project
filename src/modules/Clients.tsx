import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { useNav } from '../core/nav';
import { clientBalance, docTotals, effectiveStatus } from '../core/calc';
import type { Client, ClientKind, ClientStatus, EntityId } from '../core/types';
import { downloadFile, formatDate, initials, money, money0, sum, toCSV, today, uid } from '../core/utils';
import { Badge, Card, ConfirmDialog, DataTable, EmptyState, Field, Modal, PageHeader, Tabs, type Column } from '../ui/kit';
import { StatTile } from '../ui/charts';
import { ClientCell, DocStatusBadge, EntityChip, KeyValue, Stars } from '../ui/shared';

const KIND_LABEL: Record<ClientKind, string> = {
  pro: 'Entreprise',
  particulier: 'Particulier',
  collectivite: 'Collectivité',
  association: 'Association',
};

const STATUS_TONE: Record<ClientStatus, 'good' | 'info' | 'neutre' | 'critical'> = {
  actif: 'good',
  prospect: 'info',
  inactif: 'neutre',
  bloque: 'critical',
};

function emptyClient(entity: EntityId): Client {
  return {
    id: uid('cli'),
    entity,
    kind: 'pro',
    name: '',
    status: 'prospect',
    contacts: [],
    email: '',
    phone: '',
    address: '',
    zip: '',
    city: '',
    country: 'France',
    siret: '',
    vatNumber: '',
    source: '',
    tags: [],
    discountRate: 0,
    paymentTermsDays: 30,
    creditLimit: 10000,
    rating: 3,
    notes: '',
    createdAt: today(),
  };
}

export default function Clients() {
  const { db, scope, visible, update, defaultEntity, toast } = useStore();
  const { focus, go } = useNav();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Client | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'tous' | ClientStatus>('tous');

  useEffect(() => {
    if (focus && db.clients.some((client) => client.id === focus)) setOpenId(focus);
  }, [focus, db.clients]);

  const rows = useMemo(() => {
    return visible(db.clients)
      .map((client) => {
        const docs = db.docs.filter((doc) => doc.clientId === client.id);
        const invoices = docs.filter((doc) => doc.kind !== 'devis' && doc.status !== 'annule');
        return {
          client,
          revenue: sum(invoices, (doc) => docTotals(doc, db.products).netHT),
          balance: clientBalance(client, db.docs, db.products),
          docCount: docs.length,
          lastDoc: docs.map((doc) => doc.date).sort().pop() ?? '',
        };
      })
      .filter((row) => (statusFilter === 'tous' ? true : row.client.status === statusFilter))
      .filter((row) => {
        if (!query.trim()) return true;
        const haystack = `${row.client.name} ${row.client.city} ${row.client.email} ${row.client.tags.join(' ')}`;
        return haystack.toLowerCase().includes(query.toLowerCase());
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [db, visible, query, statusFilter]);

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'name',
      header: 'Client',
      sort: (row) => row.client.name,
      cell: (row) => (
        <div className="row" style={{ gap: 8 }}>
          {scope === 'groupe' ? <EntityChip entity={row.client.entity} /> : null}
          <ClientCell client={row.client} />
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
      sort: (row) => row.client.kind,
      cell: (row) => <span className="small muted">{KIND_LABEL[row.client.kind]}</span>,
    },
    {
      key: 'status',
      header: 'Statut',
      sort: (row) => row.client.status,
      cell: (row) => (
        <Badge tone={STATUS_TONE[row.client.status]} icon={row.client.status === 'actif' ? '✔' : '•'}>
          {row.client.status}
        </Badge>
      ),
    },
    {
      key: 'revenue',
      header: 'CA cumulé HT',
      align: 'right',
      sort: (row) => row.revenue,
      cell: (row) => <span className="tnum">{money(row.revenue)}</span>,
    },
    {
      key: 'balance',
      header: 'Encours',
      align: 'right',
      sort: (row) => row.balance,
      cell: (row) =>
        row.balance > 0.01 ? (
          <span className={`tnum ${row.balance > row.client.creditLimit ? 'delta-down' : ''}`}>{money(row.balance)}</span>
        ) : (
          <span className="dim">—</span>
        ),
    },
    {
      key: 'docs',
      header: 'Documents',
      align: 'right',
      sort: (row) => row.docCount,
      cell: (row) => <span className="tnum">{row.docCount}</span>,
    },
    {
      key: 'last',
      header: 'Dernier document',
      sort: (row) => row.lastDoc,
      cell: (row) => <span className="small muted">{row.lastDoc ? formatDate(row.lastDoc) : '—'}</span>,
    },
    {
      key: 'rating',
      header: 'Note',
      cell: (row) => <Stars value={row.client.rating} />,
    },
  ];

  const totals = {
    count: rows.length,
    revenue: sum(rows, (row) => row.revenue),
    balance: sum(rows, (row) => row.balance),
    overLimit: rows.filter((row) => row.balance > row.client.creditLimit).length,
  };

  return (
    <div className="view">
      <PageHeader
        title="Clients"
        subtitle="Fiches, encours, historique commercial et conditions négociées"
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                downloadFile(
                  `clients-${today()}.csv`,
                  toCSV(
                    rows.map((row) => ({
                      Nom: row.client.name,
                      Type: KIND_LABEL[row.client.kind],
                      Statut: row.client.status,
                      Ville: row.client.city,
                      Email: row.client.email,
                      Telephone: row.client.phone,
                      SIRET: row.client.siret,
                      'CA HT': row.revenue,
                      Encours: row.balance,
                    })),
                  ),
                  'text/csv',
                );
                toast('Export CSV téléchargé.', 'succes');
              }}
            >
              Exporter CSV
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setDraft(emptyClient(defaultEntity))}>
              + Nouveau client
            </button>
          </>
        }
      />

      <div className="stack">
        <div className="grid g4">
          <StatTile label="Clients suivis" value={String(totals.count)} deltaLabel={`${rows.filter((r) => r.client.status === 'actif').length} actifs`} />
          <StatTile label="Chiffre d’affaires cumulé" value={money0(totals.revenue)} deltaLabel="Toutes périodes, HT" />
          <StatTile label="Encours total" value={money0(totals.balance)} deltaLabel="Factures non soldées" />
          <StatTile
            label="Dépassements d’encours"
            value={String(totals.overLimit)}
            deltaLabel="Au-delà de la limite négociée"
            foot={
              totals.overLimit ? (
                <Badge tone="critical" icon="⚠">
                  À surveiller
                </Badge>
              ) : (
                <Badge tone="good" icon="✔">
                  Sous contrôle
                </Badge>
              )
            }
          />
        </div>

        <Card
          title="Portefeuille"
          flush
          actions={
            <>
              <div className="search" style={{ width: 240 }}>
                <input placeholder="Nom, ville, étiquette…" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} style={{ width: 140 }}>
                <option value="tous">Tous statuts</option>
                <option value="actif">Actifs</option>
                <option value="prospect">Prospects</option>
                <option value="inactif">Inactifs</option>
                <option value="bloque">Bloqués</option>
              </select>
            </>
          }
        >
          <DataTable
            rows={rows}
            columns={columns}
            onRowClick={(row) => setOpenId(row.client.id)}
            empty={<EmptyState mark="👥" title="Aucun client" hint="Créez une première fiche client." />}
          />
        </Card>
      </div>

      {openId ? (
        <ClientDetail
          clientId={openId}
          onClose={() => setOpenId(null)}
          onEdit={(client) => {
            setDraft(structuredClone(client));
            setOpenId(null);
          }}
          onOpenDoc={(id, kind) => {
            setOpenId(null);
            go(kind === 'devis' ? 'devis' : 'factures', id);
          }}
        />
      ) : null}

      {draft ? (
        <ClientForm
          value={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => {
            update((db2) => {
              const index = db2.clients.findIndex((client) => client.id === draft.id);
              if (index >= 0) db2.clients[index] = draft;
              else db2.clients.unshift(draft);
            });
            toast('Fiche client enregistrée.', 'succes');
            setDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- fiche client */

function ClientDetail({
  clientId,
  onClose,
  onEdit,
  onOpenDoc,
}: {
  clientId: string;
  onClose: () => void;
  onEdit: (client: Client) => void;
  onOpenDoc: (id: string, kind: string) => void;
}) {
  const { db, companyOf } = useStore();
  const [tab, setTab] = useState('fiche');
  const client = db.clients.find((entry) => entry.id === clientId);
  if (!client) return null;

  const docs = db.docs
    .filter((doc) => doc.clientId === client.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const projects = db.projects.filter((project) => project.clientId === client.id);
  const deals = db.deals.filter((deal) => deal.clientId === client.id);
  const balance = clientBalance(client, db.docs, db.products);
  const revenue = sum(
    docs.filter((doc) => doc.kind !== 'devis' && doc.status !== 'annule'),
    (doc) => docTotals(doc, db.products).netHT,
  );

  return (
    <Modal
      title={client.name}
      subtitle={`${KIND_LABEL[client.kind]} · ${companyOf(client.entity).name}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onEdit(client)}>
            Modifier la fiche
          </button>
        </>
      }
    >
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <StatTile label="CA cumulé HT" value={money0(revenue)} />
        <StatTile label="Encours" value={money0(balance)} deltaLabel={`Limite ${money0(client.creditLimit)}`} />
        <StatTile label="Documents" value={String(docs.length)} deltaLabel={`${projects.length} projet(s)`} />
        <StatTile label="Conditions" value={`${client.paymentTermsDays} j`} deltaLabel={`Remise ${client.discountRate} %`} />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'fiche', label: 'Fiche' },
          { id: 'documents', label: 'Documents', count: docs.length },
          { id: 'projets', label: 'Projets', count: projects.length },
          { id: 'affaires', label: 'Affaires', count: deals.length },
        ]}
      />

      {tab === 'fiche' ? (
        <div className="grid g2" style={{ gap: 20 }}>
          <div>
            <KeyValue label="Raison sociale">{client.name}</KeyValue>
            <KeyValue label="Adresse">
              {client.address}
              <br />
              {client.zip} {client.city}, {client.country}
            </KeyValue>
            <KeyValue label="Téléphone">{client.phone || '—'}</KeyValue>
            <KeyValue label="E-mail">
              {client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : '—'}
            </KeyValue>
            <KeyValue label="SIRET">{client.siret || '—'}</KeyValue>
            <KeyValue label="TVA intracom.">{client.vatNumber || '—'}</KeyValue>
          </div>
          <div>
            <KeyValue label="Statut">
              <Badge tone={STATUS_TONE[client.status]}>{client.status}</Badge>
            </KeyValue>
            <KeyValue label="Origine">{client.source || '—'}</KeyValue>
            <KeyValue label="Satisfaction">
              <Stars value={client.rating} />
            </KeyValue>
            <KeyValue label="Étiquettes">
              <div className="row row-wrap" style={{ gap: 4 }}>
                {client.tags.length ? client.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>) : '—'}
              </div>
            </KeyValue>
            <KeyValue label="Client depuis">{formatDate(client.createdAt)}</KeyValue>
            <KeyValue label="Notes">{client.notes || '—'}</KeyValue>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <h3 style={{ margin: '10px 0 6px' }}>Contacts</h3>
            {client.contacts.length ? (
              <div className="stack-sm">
                {client.contacts.map((contact) => (
                  <div key={contact.id} className="row" style={{ gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
                    <span className="avatar">{initials(contact.name)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div>{contact.name}</div>
                      <div className="small dim">{contact.role || 'Contact'}</div>
                    </div>
                    <a href={`mailto:${contact.email}`} className="small">
                      {contact.email}
                    </a>
                    <span className="small muted">{contact.phone}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="small dim">Aucun contact enregistré.</span>
            )}
          </div>
        </div>
      ) : null}

      {tab === 'documents' ? (
        docs.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Numéro</th>
                  <th>Objet</th>
                  <th>Date</th>
                  <th className="num">Total TTC</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => {
                  const totals = docTotals(doc, db.products);
                  return (
                    <tr key={doc.id} className="clickable" onClick={() => onOpenDoc(doc.id, doc.kind)}>
                      <td className="mono">{doc.number}</td>
                      <td className="truncate" style={{ maxWidth: 240 }}>
                        {doc.title || '—'}
                      </td>
                      <td className="small">{formatDate(doc.date)}</td>
                      <td className="num tnum">{money(totals.totalTTC)}</td>
                      <td>
                        <DocStatusBadge status={effectiveStatus(doc, totals)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState mark="📄" title="Aucun document" />
        )
      ) : null}

      {tab === 'projets' ? (
        projects.length ? (
          <div className="stack-sm">
            {projects.map((project) => (
              <div key={project.id} className="row" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate">{project.name}</div>
                  <div className="small dim">
                    {formatDate(project.start)} → {formatDate(project.end)} · {project.venue}
                  </div>
                </div>
                <span className="tnum small">{money0(project.budget)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState mark="📁" title="Aucun projet" />
        )
      ) : null}

      {tab === 'affaires' ? (
        deals.length ? (
          <div className="stack-sm">
            {deals.map((deal) => (
              <div key={deal.id} className="row" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate">{deal.title}</div>
                  <div className="small dim">
                    {deal.stage} · {deal.probability} % · clôture prévue {formatDate(deal.expectedDate)}
                  </div>
                </div>
                <span className="tnum small">{money0(deal.value)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState mark="🎯" title="Aucune affaire en cours" />
        )
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------ formulaire */

function ClientForm({
  value,
  onChange,
  onSave,
  onClose,
}: {
  value: Client;
  onChange: (client: Client) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { db } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { update, toast } = useStore();
  const exists = db.clients.some((client) => client.id === value.id);
  const set = <K extends keyof Client>(key: K, next: Client[K]) => onChange({ ...value, [key]: next });

  return (
    <>
      <Modal
        title={exists ? 'Modifier la fiche client' : 'Nouveau client'}
        size="lg"
        onClose={onClose}
        footer={
          <>
            {exists ? (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                Supprimer
              </button>
            ) : null}
            <div className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
            <button type="button" className="btn btn-primary" disabled={!value.name.trim()} onClick={onSave}>
              Enregistrer
            </button>
          </>
        }
      >
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
          <Field label="Société de rattachement">
            <select value={value.entity} onChange={(event) => set('entity', event.target.value as EntityId)}>
              {db.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select value={value.kind} onChange={(event) => set('kind', event.target.value as ClientKind)}>
              {Object.entries(KIND_LABEL).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Statut">
            <select value={value.status} onChange={(event) => set('status', event.target.value as ClientStatus)}>
              <option value="prospect">Prospect</option>
              <option value="actif">Actif</option>
              <option value="inactif">Inactif</option>
              <option value="bloque">Bloqué</option>
            </select>
          </Field>

          <Field label="Nom / raison sociale" span={3}>
            <input value={value.name} onChange={(event) => set('name', event.target.value)} autoFocus />
          </Field>

          <Field label="Adresse" span={3}>
            <input value={value.address} onChange={(event) => set('address', event.target.value)} />
          </Field>
          <Field label="Code postal">
            <input value={value.zip} onChange={(event) => set('zip', event.target.value)} />
          </Field>
          <Field label="Ville">
            <input value={value.city} onChange={(event) => set('city', event.target.value)} />
          </Field>
          <Field label="Pays">
            <input value={value.country} onChange={(event) => set('country', event.target.value)} />
          </Field>

          <Field label="E-mail">
            <input type="email" value={value.email} onChange={(event) => set('email', event.target.value)} />
          </Field>
          <Field label="Téléphone">
            <input value={value.phone} onChange={(event) => set('phone', event.target.value)} />
          </Field>
          <Field label="Origine">
            <input value={value.source} onChange={(event) => set('source', event.target.value)} placeholder="Salon, site web, recommandation…" />
          </Field>

          <Field label="SIRET">
            <input value={value.siret} onChange={(event) => set('siret', event.target.value)} />
          </Field>
          <Field label="TVA intracommunautaire">
            <input value={value.vatNumber} onChange={(event) => set('vatNumber', event.target.value)} />
          </Field>
          <Field label="Étiquettes" hint="Séparées par des virgules">
            <input
              value={value.tags.join(', ')}
              onChange={(event) => set('tags', event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))}
            />
          </Field>

          <Field label="Délai de paiement (jours)">
            <input type="number" min={0} value={value.paymentTermsDays} onChange={(event) => set('paymentTermsDays', Number(event.target.value))} />
          </Field>
          <Field label="Remise permanente (%)">
            <input type="number" min={0} max={50} step={0.5} value={value.discountRate} onChange={(event) => set('discountRate', Number(event.target.value))} />
          </Field>
          <Field label="Encours autorisé (€ TTC)">
            <input type="number" min={0} step={500} value={value.creditLimit} onChange={(event) => set('creditLimit', Number(event.target.value))} />
          </Field>

          <Field label="Satisfaction (1 à 5)">
            <input type="number" min={1} max={5} value={value.rating} onChange={(event) => set('rating', Number(event.target.value))} />
          </Field>
          <Field label="Notes internes" span={2}>
            <textarea value={value.notes} onChange={(event) => set('notes', event.target.value)} rows={2} />
          </Field>

          <div style={{ gridColumn: '1 / -1' }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <h3>Contacts</h3>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  set('contacts', [
                    ...value.contacts,
                    { id: uid('ct'), name: '', role: '', email: '', phone: '', primary: !value.contacts.length },
                  ])
                }
              >
                + Contact
              </button>
            </div>
            <div className="stack-sm">
              {value.contacts.map((contact, index) => (
                <div key={contact.id} className="row" style={{ gap: 6 }}>
                  <input
                    placeholder="Nom"
                    value={contact.name}
                    onChange={(event) => {
                      const next = [...value.contacts];
                      next[index] = { ...contact, name: event.target.value };
                      set('contacts', next);
                    }}
                  />
                  <input
                    placeholder="Fonction"
                    value={contact.role}
                    onChange={(event) => {
                      const next = [...value.contacts];
                      next[index] = { ...contact, role: event.target.value };
                      set('contacts', next);
                    }}
                  />
                  <input
                    placeholder="E-mail"
                    value={contact.email}
                    onChange={(event) => {
                      const next = [...value.contacts];
                      next[index] = { ...contact, email: event.target.value };
                      set('contacts', next);
                    }}
                  />
                  <input
                    placeholder="Téléphone"
                    value={contact.phone}
                    onChange={(event) => {
                      const next = [...value.contacts];
                      next[index] = { ...contact, phone: event.target.value };
                      set('contacts', next);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => set('contacts', value.contacts.filter((entry) => entry.id !== contact.id))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {!value.contacts.length ? <span className="small dim">Aucun contact.</span> : null}
            </div>
          </div>
        </div>
      </Modal>

      {confirmDelete ? (
        <ConfirmDialog
          title="Supprimer ce client ?"
          message="Les devis et factures rattachés seront conservés mais orphelins."
          danger
          confirmLabel="Supprimer"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            update((draft) => {
              draft.clients = draft.clients.filter((client) => client.id !== value.id);
            });
            toast('Client supprimé.', 'alerte');
            setConfirmDelete(false);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
