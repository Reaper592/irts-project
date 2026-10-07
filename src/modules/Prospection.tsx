import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { useNav } from '../core/nav';
import type { Activity, Deal, DealStage, EntityId } from '../core/types';
import { addDays, formatDate, money0, num, pct, sum, today, uid } from '../core/utils';
import { Badge, Card, ConfirmDialog, EmptyState, Field, Modal, PageHeader, Segmented, Tabs } from '../ui/kit';
import { BarList, ColumnChart, DonutChart, StatTile, seriesColor } from '../ui/charts';
import { EntityChip, STAGES, StageBadge } from '../ui/shared';
import { CategoryManager, ManageCategoriesButton } from '../ui/CategoryManager';

const ACTIVITY_ICON: Record<Activity['type'], string> = {
  appel: '📞',
  email: '✉️',
  rdv: '🤝',
  note: '📝',
  relance: '🔔',
  visite: '📍',
};

function emptyDeal(entity: EntityId): Deal {
  return {
    id: uid('deal'),
    entity,
    title: '',
    clientId: null,
    prospectName: '',
    contactEmail: '',
    contactPhone: '',
    stage: 'nouveau',
    value: 0,
    probability: 15,
    source: '',
    owner: '',
    expectedDate: addDays(today(), 30),
    nextAction: '',
    nextActionDate: addDays(today(), 3),
    lostReason: '',
    landingPageId: null,
    activities: [],
    createdAt: today(),
  };
}

export default function Prospection() {
  const { db, visible, update, defaultEntity, toast, scope } = useStore();
  const { go } = useNav();
  const [tab, setTab] = useState('pipeline');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Deal | null>(null);
  const [dragOver, setDragOver] = useState<DealStage | null>(null);

  const deals = useMemo(() => visible(db.deals), [db.deals, visible]);
  const open = deals.filter((deal) => !['gagne', 'perdu'].includes(deal.stage));

  const stats = useMemo(() => {
    const won = deals.filter((deal) => deal.stage === 'gagne');
    const lost = deals.filter((deal) => deal.stage === 'perdu');
    const decided = won.length + lost.length;
    const bySource = new Map<string, number>();
    for (const deal of deals) bySource.set(deal.source || 'Non renseignée', (bySource.get(deal.source || 'Non renseignée') ?? 0) + deal.value);
    return {
      pipeline: sum(open, (deal) => deal.value),
      weighted: sum(open, (deal) => (deal.value * deal.probability) / 100),
      winRate: decided ? won.length / decided : 0,
      wonValue: sum(won, (deal) => deal.value),
      averageTicket: won.length ? sum(won, (deal) => deal.value) / won.length : 0,
      sources: [...bySource.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      overdue: open.filter((deal) => deal.nextActionDate && deal.nextActionDate < today()),
    };
  }, [deals, open]);

  const funnel = STAGES.filter((stage) => !['gagne', 'perdu'].includes(stage.id)).map((stage) => ({
    label: stage.label,
    value: sum(deals.filter((deal) => deal.stage === stage.id), (deal) => deal.value),
    count: deals.filter((deal) => deal.stage === stage.id).length,
  }));

  const move = (dealId: string, stage: DealStage) =>
    update((db2) => {
      const deal = db2.deals.find((entry) => entry.id === dealId);
      if (!deal || deal.stage === stage) return;
      deal.stage = stage;
      deal.probability = stage === 'gagne' ? 100 : stage === 'perdu' ? 0 : PROBABILITY[stage];
      deal.activities.unshift({
        id: uid('act'),
        date: today(),
        type: 'note',
        summary: `Passage à l’étape « ${STAGES.find((entry) => entry.id === stage)?.label} ».`,
        author: db2.settings.operator,
      });
    });

  return (
    <div className="view">
      <PageHeader
        title="Prospection"
        subtitle="Pipeline commercial des trois sociétés, de la demande entrante à la signature"
        actions={
          <>
            <ManageCategoriesButton domain="source" label="Origines" />
            <button type="button" className="btn" onClick={() => go('site')}>
              Site de prospection
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setDraft(emptyDeal(defaultEntity))}>
              + Nouvelle affaire
            </button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <StatTile label="Pipeline ouvert" value={money0(stats.pipeline)} deltaLabel={`${open.length} affaire(s)`} />
        <StatTile label="Prévision pondérée" value={money0(stats.weighted)} deltaLabel="Valeur × probabilité" />
        <StatTile label="Taux de réussite" value={pct(stats.winRate, 0)} deltaLabel={`${money0(stats.wonValue)} signés`} />
        <StatTile
          label="Relances en retard"
          value={String(stats.overdue.length)}
          deltaLabel="Prochaine action dépassée"
          foot={
            stats.overdue.length ? (
              <Badge tone="warning" icon="⚠">
                À traiter
              </Badge>
            ) : (
              <Badge tone="good" icon="✔">
                À jour
              </Badge>
            )
          }
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'pipeline', label: 'Pipeline', count: open.length },
          { id: 'analyse', label: 'Analyse' },
          { id: 'relances', label: 'Relances', count: stats.overdue.length },
        ]}
      />

      {tab === 'pipeline' ? (
        <div className="kanban">
          {STAGES.map((stage) => {
            const items = deals.filter((deal) => deal.stage === stage.id);
            return (
              <div
                key={stage.id}
                className={`kanban-col${dragOver === stage.id ? ' drop' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(stage.id);
                }}
                onDragLeave={() => setDragOver((current) => (current === stage.id ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(null);
                  const dealId = event.dataTransfer.getData('text/plain');
                  if (dealId) move(dealId, stage.id);
                }}
              >
                <div className="kanban-head">
                  <strong>{stage.label}</strong>
                  <span className="spacer" />
                  <span className="small dim tnum">{items.length}</span>
                </div>
                <div className="kanban-body">
                  {items.map((deal) => (
                    <div
                      key={deal.id}
                      className="deal-card"
                      draggable
                      onDragStart={(event) => event.dataTransfer.setData('text/plain', deal.id)}
                      onClick={() => setOpenId(deal.id)}
                    >
                      <div className="row" style={{ gap: 6 }}>
                        {scope === 'groupe' ? <EntityChip entity={deal.entity} /> : null}
                        <span className="spacer" />
                        <span className="small tnum muted">{deal.probability} %</span>
                      </div>
                      <strong>{deal.title}</strong>
                      <span className="small dim truncate">{deal.prospectName}</span>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="tnum" style={{ fontSize: 12.5 }}>
                          {money0(deal.value)}
                        </span>
                        <span className="spacer" />
                        {deal.nextActionDate && deal.nextActionDate < today() && !['gagne', 'perdu'].includes(deal.stage) ? (
                          <Badge tone="warning" icon="⚠">
                            {formatDate(deal.nextActionDate)}
                          </Badge>
                        ) : (
                          <span className="small dim">{formatDate(deal.expectedDate)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {!items.length ? <span className="small dim center" style={{ padding: 12 }}>—</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {tab === 'analyse' ? (
        <div className="stack">
          <div className="grid g-2-1">
            <Card title="Entonnoir de conversion" subtitle="Montant HT en jeu par étape">
              <ColumnChart
                categories={funnel.map((step) => step.label)}
                series={[{ label: 'Pipeline', values: funnel.map((step) => step.value) }]}
                height={230}
              />
              <div className="row row-wrap" style={{ gap: 12, marginTop: 10 }}>
                {funnel.map((step, index) => (
                  <span key={step.label} className="small muted">
                    <span className="legend-key" style={{ background: seriesColor(0), display: 'inline-block', marginRight: 5 }} />
                    {step.label} : <span className="tnum">{step.count}</span>
                    {index < funnel.length - 1 && funnel[index].count ? (
                      <span className="dim"> → {num((funnel[index + 1].count / funnel[index].count) * 100, 0)} %</span>
                    ) : null}
                  </span>
                ))}
              </div>
            </Card>
            <Card title="Origine des affaires" subtitle="Valeur du pipeline par canal">
              <DonutChart parts={stats.sources.slice(0, 6)} centerLabel="pipeline" centerValue={money0(stats.pipeline)} />
            </Card>
          </div>
          <div className="grid g2">
            <Card title="Affaires par responsable">
              <BarList
                items={Object.entries(
                  deals.reduce<Record<string, number>>((acc, deal) => {
                    acc[deal.owner || 'Non affecté'] = (acc[deal.owner || 'Non affecté'] ?? 0) + deal.value;
                    return acc;
                  }, {}),
                ).map(([label, value]) => ({ label, value }))}
                colorIndex={2}
              />
            </Card>
            <Card title="Motifs de perte">
              {deals.filter((deal) => deal.stage === 'perdu').length ? (
                <div className="stack-sm">
                  {deals
                    .filter((deal) => deal.stage === 'perdu')
                    .map((deal) => (
                      <div key={deal.id} className="row" style={{ gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="truncate">{deal.title}</div>
                          <div className="small dim">{deal.lostReason || 'Motif non renseigné'}</div>
                        </div>
                        <span className="tnum small">{money0(deal.value)}</span>
                      </div>
                    ))}
                </div>
              ) : (
                <EmptyState mark="✔" title="Aucune affaire perdue" />
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {tab === 'relances' ? (
        <Card title="Prochaines actions" subtitle="Triées par échéance, les plus urgentes d’abord">
          {open.length ? (
            <div className="stack-sm">
              {[...open]
                .sort((a, b) => (a.nextActionDate || '9999').localeCompare(b.nextActionDate || '9999'))
                .map((deal) => (
                  <button
                    key={deal.id}
                    type="button"
                    className="row"
                    style={{
                      gap: 10,
                      background: 'transparent',
                      border: 0,
                      borderBottom: '1px solid var(--line-soft)',
                      padding: '9px 0',
                      cursor: 'pointer',
                      color: 'inherit',
                      font: 'inherit',
                      width: '100%',
                      textAlign: 'left',
                    }}
                    onClick={() => setOpenId(deal.id)}
                  >
                    <Badge tone={deal.nextActionDate && deal.nextActionDate < today() ? 'critical' : 'info'} icon="⏱">
                      {deal.nextActionDate ? formatDate(deal.nextActionDate) : '—'}
                    </Badge>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate">{deal.nextAction || 'Action à définir'}</div>
                      <div className="small dim truncate">
                        {deal.title} · {deal.prospectName}
                      </div>
                    </div>
                    <StageBadge stage={deal.stage} />
                    <span className="tnum small" style={{ minWidth: 80, textAlign: 'right' }}>
                      {money0(deal.value)}
                    </span>
                    <span className="small dim" style={{ minWidth: 110 }}>
                      {deal.owner}
                    </span>
                  </button>
                ))}
            </div>
          ) : (
            <EmptyState mark="✔" title="Aucune affaire ouverte" />
          )}
        </Card>
      ) : null}

      {openId ? (
        <DealDetail
          dealId={openId}
          onClose={() => setOpenId(null)}
          onEdit={(deal) => {
            setDraft(structuredClone(deal));
            setOpenId(null);
          }}
        />
      ) : null}

      {draft ? (
        <DealForm
          value={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => {
            update((db2) => {
              const index = db2.deals.findIndex((deal) => deal.id === draft.id);
              if (index >= 0) db2.deals[index] = draft;
              else db2.deals.unshift(draft);
            });
            toast('Affaire enregistrée.', 'succes');
            setDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Origine d'une affaire, choisie dans la taxonomie « source ». */
function SourceSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { categories } = useStore();
  const [manage, setManage] = useState(false);
  const list = categories('source');
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">— non renseignée —</option>
          {list.map((entry) => (
            <option key={entry.id} value={entry.label}>
              {entry.icon} {entry.label}
            </option>
          ))}
          {value && !list.some((entry) => entry.label === value) ? <option value={value}>{value}</option> : null}
        </select>
        <button type="button" className="btn btn-sm" title="Gérer les origines" onClick={() => setManage(true)}>
          ⚙
        </button>
      </div>
      {manage ? <ManageCategoriesModal onClose={() => setManage(false)} /> : null}
    </>
  );
}

function ManageCategoriesModal({ onClose }: { onClose: () => void }) {
  return <CategoryManager domain="source" onClose={onClose} />;
}

const PROBABILITY: Record<DealStage, number> = {
  nouveau: 10,
  contacte: 20,
  qualifie: 40,
  devis: 60,
  negociation: 75,
  gagne: 100,
  perdu: 0,
};

/* --------------------------------------------------------------- détail */

function DealDetail({ dealId, onClose, onEdit }: { dealId: string; onClose: () => void; onEdit: (deal: Deal) => void }) {
  const { db, update, toast, nextNumber, companyOf } = useStore();
  const { go } = useNav();
  const [note, setNote] = useState('');
  const [noteType, setNoteType] = useState<Activity['type']>('appel');
  const deal = db.deals.find((entry) => entry.id === dealId);
  if (!deal) return null;

  const client = db.clients.find((entry) => entry.id === deal.clientId);
  const company = companyOf(deal.entity);

  const addActivity = () => {
    if (!note.trim()) return;
    update((draft) => {
      const target = draft.deals.find((entry) => entry.id === dealId);
      target?.activities.unshift({
        id: uid('act'),
        date: today(),
        type: noteType,
        summary: note.trim(),
        author: draft.settings.operator,
      });
    });
    setNote('');
    toast('Activité enregistrée.', 'succes');
  };

  /** Cree un devis pre-rempli et bascule l'affaire a l'etape « devis ». */
  const createQuote = () => {
    if (!deal.clientId) {
      toast('Rattachez d’abord un client à cette affaire.', 'alerte');
      return;
    }
    const number = nextNumber(deal.entity, 'devis');
    const id = uid('doc');
    update((draft) => {
      draft.docs.unshift({
        id,
        entity: deal.entity,
        kind: 'devis',
        number,
        clientId: deal.clientId!,
        projectId: null,
        dealId: deal.id,
        sceneId: null,
        sourceDocId: null,
        title: deal.title,
        date: today(),
        dueDate: addDays(today(), company.quoteValidityDays),
        status: 'brouillon',
        lines: [],
        globalDiscountPct: 0,
        depositPct: 30,
        shipping: 0,
        eventStart: deal.expectedDate,
        eventEnd: deal.expectedDate,
        venue: '',
        notes: '',
        terms: company.cgv,
        payments: [],
        sentAt: null,
        signedAt: null,
        signedBy: '',
        createdAt: today(),
      });
      const target = draft.deals.find((entry) => entry.id === dealId);
      if (target) {
        target.stage = 'devis';
        target.probability = PROBABILITY.devis;
      }
    });
    toast(`Devis ${number} créé.`, 'succes');
    onClose();
    go('devis', id);
  };

  return (
    <Modal
      title={deal.title}
      subtitle={`${deal.prospectName} · ${company.name}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={createQuote}>
            Créer un devis
          </button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onEdit(deal)}>
            Modifier
          </button>
        </>
      }
    >
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <StatTile label="Valeur estimée" value={money0(deal.value)} />
        <StatTile label="Probabilité" value={`${deal.probability} %`} deltaLabel={money0((deal.value * deal.probability) / 100)} />
        <StatTile label="Clôture prévue" value={formatDate(deal.expectedDate)} />
        <StatTile label="Étape" value={STAGES.find((stage) => stage.id === deal.stage)?.label ?? '—'} />
      </div>

      <div className="grid g2" style={{ gap: 18 }}>
        <div>
          <h3 style={{ marginBottom: 8 }}>Contact</h3>
          <div className="stack-sm small">
            <div className="row">
              <span className="muted" style={{ minWidth: 110 }}>
                Prospect
              </span>
              <span>{deal.prospectName || '—'}</span>
            </div>
            <div className="row">
              <span className="muted" style={{ minWidth: 110 }}>
                Client lié
              </span>
              <span>{client?.name ?? 'Non rattaché'}</span>
            </div>
            <div className="row">
              <span className="muted" style={{ minWidth: 110 }}>
                E-mail
              </span>
              <span>{deal.contactEmail ? <a href={`mailto:${deal.contactEmail}`}>{deal.contactEmail}</a> : '—'}</span>
            </div>
            <div className="row">
              <span className="muted" style={{ minWidth: 110 }}>
                Téléphone
              </span>
              <span>{deal.contactPhone || '—'}</span>
            </div>
            <div className="row">
              <span className="muted" style={{ minWidth: 110 }}>
                Origine
              </span>
              <span>{deal.source || '—'}</span>
            </div>
            <div className="row">
              <span className="muted" style={{ minWidth: 110 }}>
                Responsable
              </span>
              <span>{deal.owner || '—'}</span>
            </div>
            <div className="row">
              <span className="muted" style={{ minWidth: 110 }}>
                Prochaine action
              </span>
              <span>
                {deal.nextAction || '—'}
                {deal.nextActionDate ? <span className="dim"> — {formatDate(deal.nextActionDate)}</span> : null}
              </span>
            </div>
          </div>

          <h3 style={{ margin: '16px 0 8px' }}>Ajouter une activité</h3>
          <div className="stack-sm">
            <Segmented
              value={noteType}
              options={[
                { value: 'appel', label: 'Appel' },
                { value: 'email', label: 'E-mail' },
                { value: 'rdv', label: 'RDV' },
                { value: 'note', label: 'Note' },
              ]}
              onChange={(value) => setNoteType(value as Activity['type'])}
            />
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Compte rendu, décision, prochaine étape…" />
            <button type="button" className="btn btn-primary" onClick={addActivity} disabled={!note.trim()}>
              Enregistrer l’activité
            </button>
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 8 }}>Historique</h3>
          {deal.activities.length ? (
            <div className="timeline">
              {deal.activities.map((activity) => (
                <div className="timeline-item" key={activity.id}>
                  <div className="timeline-mark" aria-hidden="true">
                    {ACTIVITY_ICON[activity.type]}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="small muted">
                      {formatDate(activity.date)} · {activity.author}
                    </div>
                    <div style={{ fontSize: 12.5 }}>{activity.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState mark="📝" title="Aucune activité" hint="Consignez chaque échange pour garder la trace." />
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ formulaire */

function DealForm({
  value,
  onChange,
  onSave,
  onClose,
}: {
  value: Deal;
  onChange: (deal: Deal) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { db, update, toast } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exists = db.deals.some((deal) => deal.id === value.id);
  const set = <K extends keyof Deal>(key: K, next: Deal[K]) => onChange({ ...value, [key]: next });

  return (
    <>
      <Modal
        title={exists ? 'Modifier l’affaire' : 'Nouvelle affaire'}
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
            <button type="button" className="btn btn-primary" disabled={!value.title.trim()} onClick={onSave}>
              Enregistrer
            </button>
          </>
        }
      >
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
          <Field label="Société">
            <select value={value.entity} onChange={(event) => set('entity', event.target.value as EntityId)}>
              {db.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Étape">
            <select
              value={value.stage}
              onChange={(event) => {
                const stage = event.target.value as DealStage;
                onChange({ ...value, stage, probability: PROBABILITY[stage] });
              }}
            >
              {STAGES.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Responsable">
            <select value={value.owner} onChange={(event) => set('owner', event.target.value)}>
              <option value="">— à affecter —</option>
              {db.staff.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Intitulé de l’affaire" span={3}>
            <input value={value.title} onChange={(event) => set('title', event.target.value)} autoFocus />
          </Field>

          <Field label="Prospect / société">
            <input value={value.prospectName} onChange={(event) => set('prospectName', event.target.value)} />
          </Field>
          <Field label="Client existant">
            <select value={value.clientId ?? ''} onChange={(event) => set('clientId', event.target.value || null)}>
              <option value="">— aucun —</option>
              {db.clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Origine">
            <SourceSelect value={value.source} onChange={(next) => set('source', next)} />
          </Field>

          <Field label="E-mail">
            <input value={value.contactEmail} onChange={(event) => set('contactEmail', event.target.value)} />
          </Field>
          <Field label="Téléphone">
            <input value={value.contactPhone} onChange={(event) => set('contactPhone', event.target.value)} />
          </Field>
          <Field label="Page de prospection liée">
            <select value={value.landingPageId ?? ''} onChange={(event) => set('landingPageId', event.target.value || null)}>
              <option value="">— aucune —</option>
              {db.pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Valeur estimée (€ HT)">
            <input type="number" min={0} step={100} value={value.value} onChange={(event) => set('value', Number(event.target.value))} />
          </Field>
          <Field label="Probabilité (%)">
            <input type="number" min={0} max={100} step={5} value={value.probability} onChange={(event) => set('probability', Number(event.target.value))} />
          </Field>
          <Field label="Clôture prévue">
            <input type="date" value={value.expectedDate} onChange={(event) => set('expectedDate', event.target.value)} />
          </Field>

          <Field label="Prochaine action" span={2}>
            <input value={value.nextAction} onChange={(event) => set('nextAction', event.target.value)} />
          </Field>
          <Field label="Échéance de l’action">
            <input type="date" value={value.nextActionDate} onChange={(event) => set('nextActionDate', event.target.value)} />
          </Field>

          {value.stage === 'perdu' ? (
            <Field label="Motif de perte" span={3}>
              <input value={value.lostReason} onChange={(event) => set('lostReason', event.target.value)} placeholder="Prix, délai, concurrent, projet abandonné…" />
            </Field>
          ) : null}
        </div>
      </Modal>

      {confirmDelete ? (
        <ConfirmDialog
          title="Supprimer cette affaire ?"
          message="L’historique d’activité sera perdu."
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            update((draft) => {
              draft.deals = draft.deals.filter((deal) => deal.id !== value.id);
            });
            toast('Affaire supprimée.', 'alerte');
            setConfirmDelete(false);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
