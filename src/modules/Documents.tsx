import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { useNav } from '../core/nav';
import { docTotals, effectiveStatus, lateFees } from '../core/calc';
import type { BusinessDoc, DocKind, DocStatus, EntityId } from '../core/types';
import { addDays, downloadFile, formatDate, money, money0, sum, toCSV, today, uid } from '../core/utils';
import { Badge, Card, DataTable, EmptyState, Field, Modal, PageHeader, Segmented, type Column } from '../ui/kit';
import { StatTile } from '../ui/charts';
import { DocStatusBadge, EntityChip } from '../ui/shared';
import { DocEditor } from './DocEditor';

export default function Documents({ kind }: { kind: DocKind }) {
  const store = useStore();
  const { db, scope, visible, update, nextNumber, toast, defaultEntity, companyOf } = store;
  const { focus, go } = useNav();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'tous' | DocStatus>('tous');

  useEffect(() => {
    if (focus && db.docs.some((doc) => doc.id === focus)) setOpenId(focus);
  }, [focus, db.docs]);

  const rows = useMemo(() => {
    const all = visible(db.docs).filter((doc) => (kind === 'facture' ? doc.kind !== 'devis' : doc.kind === 'devis'));
    return all
      .map((doc) => {
        const totals = docTotals(doc, db.products);
        return {
          doc,
          totals,
          effective: effectiveStatus(doc, totals),
          client: db.clients.find((entry) => entry.id === doc.clientId),
        };
      })
      .filter((row) => (status === 'tous' ? true : row.effective === status))
      .filter((row) => {
        if (!query.trim()) return true;
        const haystack = `${row.doc.number} ${row.doc.title} ${row.client?.name ?? ''} ${row.doc.venue}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
      .sort((a, b) => b.doc.date.localeCompare(a.doc.date));
  }, [db, visible, kind, status, query]);

  const stats = useMemo(() => {
    const totalTTC = sum(rows, (row) => row.totals.totalTTC);
    const balance = sum(rows, (row) => row.totals.balance);
    const late = rows.filter((row) => row.effective === 'retard');
    const accepted = rows.filter((row) => row.effective === 'accepte');
    return {
      totalTTC,
      balance,
      late,
      lateAmount: sum(late, (row) => row.totals.balance),
      lateFeesTotal: sum(late, (row) =>
        lateFees(row.doc, row.totals, companyOf(row.doc.entity).lateFeeRate, companyOf(row.doc.entity).recoveryFee),
      ),
      accepted,
      acceptedAmount: sum(accepted, (row) => row.totals.totalTTC),
    };
  }, [rows, companyOf]);

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'number',
      header: 'Numéro',
      sort: (row) => row.doc.number,
      cell: (row) => (
        <div className="row" style={{ gap: 8 }}>
          {scope === 'groupe' ? <EntityChip entity={row.doc.entity} /> : null}
          <div style={{ minWidth: 0 }}>
            <div className="mono">{row.doc.number}</div>
            <div className="small dim truncate" style={{ maxWidth: 260 }}>
              {row.doc.title || '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      sort: (row) => row.client?.name ?? '',
      cell: (row) => <span className="truncate">{row.client?.name ?? '—'}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      sort: (row) => row.doc.date,
      cell: (row) => <span className="small">{formatDate(row.doc.date)}</span>,
    },
    {
      key: 'due',
      header: kind === 'devis' ? 'Validité' : 'Échéance',
      sort: (row) => row.doc.dueDate,
      cell: (row) => (
        <span className={`small ${row.effective === 'retard' ? 'delta-down' : ''}`}>{formatDate(row.doc.dueDate)}</span>
      ),
    },
    {
      key: 'ht',
      header: 'Total HT',
      align: 'right',
      sort: (row) => row.totals.netHT,
      cell: (row) => <span className="tnum">{money(row.totals.netHT)}</span>,
    },
    {
      key: 'ttc',
      header: 'Total TTC',
      align: 'right',
      sort: (row) => row.totals.totalTTC,
      cell: (row) => <span className="tnum" style={{ fontWeight: 600 }}>{money(row.totals.totalTTC)}</span>,
    },
    ...(kind === 'facture'
      ? [
          {
            key: 'balance',
            header: 'Reste dû',
            align: 'right' as const,
            sort: (row: (typeof rows)[number]) => row.totals.balance,
            cell: (row: (typeof rows)[number]) => (
              <span className="tnum">{row.totals.balance > 0.01 ? money(row.totals.balance) : '—'}</span>
            ),
          },
        ]
      : []),
    {
      key: 'status',
      header: 'Statut',
      sort: (row) => row.effective,
      cell: (row) => <DocStatusBadge status={row.effective} />,
    },
  ];

  const statuses: (DocStatus | 'tous')[] =
    kind === 'devis'
      ? ['tous', 'brouillon', 'envoye', 'accepte', 'refuse', 'expire']
      : ['tous', 'envoye', 'partiel', 'paye', 'retard'];

  const exportCSV = () => {
    downloadFile(
      `${kind}-${today()}.csv`,
      toCSV(
        rows.map((row) => ({
          Numero: row.doc.number,
          Societe: companyOf(row.doc.entity).name,
          Client: row.client?.name ?? '',
          Objet: row.doc.title,
          Date: row.doc.date,
          Echeance: row.doc.dueDate,
          'Total HT': row.totals.netHT,
          TVA: row.totals.totalVat,
          'Total TTC': row.totals.totalTTC,
          Regle: row.totals.paid,
          'Reste du': row.totals.balance,
          Statut: row.effective,
        })),
      ),
      'text/csv',
    );
    toast('Export CSV téléchargé.', 'succes');
  };

  /** Cree une relance : une tache datee, tracee et affectee. */
  const remind = (row: (typeof rows)[number]) => {
    update((draft) => {
      draft.tasks.unshift({
        id: uid('tsk'),
        entity: row.doc.entity,
        label: `Relancer ${row.client?.name ?? 'le client'} — ${row.doc.number}`,
        detail: `Reste dû ${money(row.totals.balance)}, échéance du ${formatDate(row.doc.dueDate)}.`,
        due: addDays(today(), 2),
        done: false,
        priority: 'haute',
        owner: draft.settings.operator,
        linkKind: row.doc.kind === 'devis' ? 'devis' : 'facture',
        linkId: row.doc.id,
      });
    });
    toast('Relance planifiée dans les tâches.', 'succes');
  };

  return (
    <div className="view">
      <PageHeader
        title={kind === 'devis' ? 'Devis' : 'Factures & avoirs'}
        subtitle={
          kind === 'devis'
            ? 'Chiffrage, dégressivité de location, signature et conversion en facture'
            : 'Facturation, encaissements, relances et avoirs'
        }
        actions={
          <>
            <button type="button" className="btn" onClick={exportCSV}>
              Exporter CSV
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              + Nouveau {kind === 'devis' ? 'devis' : 'document'}
            </button>
          </>
        }
      />

      <div className="stack">
        <div className="grid g4">
          <StatTile label={`${rows.length} document(s)`} value={money0(stats.totalTTC)} deltaLabel="Total TTC filtré" />
          {kind === 'devis' ? (
            <>
              <StatTile
                label="Devis acceptés"
                value={money0(stats.acceptedAmount)}
                deltaLabel={`${stats.accepted.length} devis signés`}
              />
              <StatTile
                label="En attente de décision"
                value={money0(sum(rows.filter((row) => row.effective === 'envoye'), (row) => row.totals.totalTTC))}
                deltaLabel={`${rows.filter((row) => row.effective === 'envoye').length} envoyés`}
              />
              <StatTile
                label="Expirés / refusés"
                value={money0(
                  sum(rows.filter((row) => ['expire', 'refuse'].includes(row.effective)), (row) => row.totals.totalTTC),
                )}
                deltaLabel="À réactiver ou archiver"
              />
            </>
          ) : (
            <>
              <StatTile label="Encours total" value={money0(stats.balance)} deltaLabel="Reste dû, toutes échéances" />
              <StatTile
                label="Impayés échus"
                value={money0(stats.lateAmount)}
                deltaLabel={`${stats.late.length} facture(s)`}
                foot={
                  stats.late.length ? (
                    <Badge tone="critical" icon="⚠">
                      Recouvrement
                    </Badge>
                  ) : null
                }
              />
              <StatTile
                label="Pénalités exigibles"
                value={money0(stats.lateFeesTotal)}
                deltaLabel="Taux légal + indemnité de 40 €"
              />
            </>
          )}
        </div>

        <Card
          title="Liste"
          flush
          actions={
            <>
              <div className="search" style={{ width: 240 }}>
                <input placeholder="Numéro, client, objet…" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} style={{ width: 150 }}>
                {statuses.map((value) => (
                  <option key={value} value={value}>
                    {value === 'tous' ? 'Tous les statuts' : value}
                  </option>
                ))}
              </select>
            </>
          }
        >
          <DataTable
            rows={rows}
            columns={columns}
            onRowClick={(row) => setOpenId(row.doc.id)}
            initialSort={{ key: 'date', dir: -1 }}
            empty={
              <EmptyState
                mark="📄"
                title="Aucun document"
                hint="Créez un devis pour démarrer une affaire."
                action={
                  <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                    + Nouveau document
                  </button>
                }
              />
            }
            footer={
              <tr>
                <td colSpan={4}>{rows.length} ligne(s)</td>
                <td className="num tnum">{money(sum(rows, (row) => row.totals.netHT))}</td>
                <td className="num tnum">{money(stats.totalTTC)}</td>
                {kind === 'facture' ? <td className="num tnum">{money(stats.balance)}</td> : null}
                <td />
              </tr>
            }
          />
        </Card>

        {kind === 'facture' && stats.late.length ? (
          <Card title="Recouvrement" subtitle="Factures échues non soldées, pénalités calculées au taux légal">
            <div className="stack-sm">
              {stats.late.map((row) => (
                <div key={row.doc.id} className="row" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  <Badge tone="critical" icon="⚠">
                    {Math.abs(Math.round((new Date(today()).getTime() - new Date(row.doc.dueDate).getTime()) / 86400000))} j
                  </Badge>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="truncate">{row.client?.name}</div>
                    <div className="small dim">
                      {row.doc.number} · échue le {formatDate(row.doc.dueDate)}
                    </div>
                  </div>
                  <div className="right">
                    <div className="tnum">{money(row.totals.balance)}</div>
                    <div className="small dim tnum">
                      + {money(lateFees(row.doc, row.totals, companyOf(row.doc.entity).lateFeeRate, companyOf(row.doc.entity).recoveryFee))} de pénalités
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => remind(row)}>
                    Planifier une relance
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setOpenId(row.doc.id)}>
                    Ouvrir
                  </button>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      {openId ? <DocEditor docId={openId} onClose={() => setOpenId(null)} /> : null}

      {creating ? (
        <NewDocDialog
          kind={kind}
          defaultEntity={defaultEntity}
          onClose={() => setCreating(false)}
          onCreate={(entity, clientId, docKind, title) => {
            const number = nextNumber(entity, docKind);
            const id = uid('doc');
            const company = db.companies.find((entry) => entry.id === entity)!;
            const client = db.clients.find((entry) => entry.id === clientId);
            const doc: BusinessDoc = {
              id,
              entity,
              kind: docKind,
              number,
              clientId,
              projectId: null,
              dealId: null,
              sceneId: null,
              sourceDocId: null,
              title,
              date: today(),
              dueDate: addDays(
                today(),
                docKind === 'devis' ? company.quoteValidityDays : client?.paymentTermsDays ?? company.paymentTermsDays,
              ),
              status: 'brouillon',
              lines: [],
              globalDiscountPct: 0,
              depositPct: docKind === 'devis' ? 30 : 0,
              shipping: 0,
              eventStart: today(),
              eventEnd: today(),
              venue: '',
              notes: '',
              terms: company.cgv,
              payments: [],
              sentAt: null,
              signedAt: null,
              signedBy: '',
              createdAt: today(),
            };
            update((draft) => void draft.docs.unshift(doc));
            setCreating(false);
            setOpenId(id);
            if (docKind !== 'devis' && kind === 'devis') go('factures', id);
          }}
        />
      ) : null}
    </div>
  );
}

function NewDocDialog({
  kind,
  defaultEntity,
  onCreate,
  onClose,
}: {
  kind: DocKind;
  defaultEntity: EntityId;
  onCreate: (entity: EntityId, clientId: string, kind: DocKind, title: string) => void;
  onClose: () => void;
}) {
  const { db } = useStore();
  const [entity, setEntity] = useState<EntityId>(defaultEntity);
  const [docKind, setDocKind] = useState<DocKind>(kind === 'devis' ? 'devis' : 'facture');
  const [clientId, setClientId] = useState(db.clients.find((client) => client.entity === defaultEntity)?.id ?? db.clients[0]?.id ?? '');
  const [title, setTitle] = useState('');

  const clients = db.clients.filter((client) => client.entity === entity);
  const list = clients.length ? clients : db.clients;

  return (
    <Modal
      title={`Nouveau ${docKind}`}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!clientId}
            onClick={() => onCreate(entity, clientId, docKind, title)}
          >
            Créer le document
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Société émettrice">
          <div className="row row-wrap" style={{ gap: 6 }}>
            {db.companies.map((company) => (
              <button
                key={company.id}
                type="button"
                className="scope-btn"
                aria-pressed={entity === company.id}
                style={{ width: 'auto', flex: '1 1 140px' }}
                onClick={() => {
                  setEntity(company.id);
                  const first = db.clients.find((client) => client.entity === company.id);
                  if (first) setClientId(first.id);
                }}
              >
                <span className="scope-dot" style={{ background: company.accent }} />
                <span>
                  <span style={{ display: 'block' }}>{company.name}</span>
                  <span className="small dim">{company.activity}</span>
                </span>
              </button>
            ))}
          </div>
        </Field>

        {kind === 'facture' ? (
          <Field label="Type de document">
            <Segmented
              value={docKind}
              options={[
                { value: 'facture', label: 'Facture' },
                { value: 'avoir', label: 'Avoir' },
              ]}
              onChange={(value) => setDocKind(value as DocKind)}
            />
          </Field>
        ) : null}

        <Field label="Client">
          <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            {list.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} — {client.city}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Objet" hint="Apparaît en tête du document imprimé">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ex. : Convention annuelle — plénière et ateliers"
            autoFocus
          />
        </Field>
      </div>
    </Modal>
  );
}
