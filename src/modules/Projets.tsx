import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { useNav } from '../core/nav';
import { docTotals } from '../core/calc';
import type { EntityId, Project, ProjectStatus } from '../core/types';
import { formatDate, money, money0, pct, sum, today, uid } from '../core/utils';
import { Badge, Card, ConfirmDialog, DataTable, EmptyState, Field, Modal, PageHeader, type Column } from '../ui/kit';
import { StatTile } from '../ui/charts';
import { EntityChip, ProjectStatusBadge } from '../ui/shared';

function emptyProject(entity: EntityId, clientId: string): Project {
  return {
    id: uid('prj'),
    entity,
    name: '',
    clientId,
    status: 'preparation',
    start: today(),
    end: today(),
    venue: '',
    address: '',
    budget: 0,
    manager: '',
    checklist: [],
    notes: '',
  };
}

export default function Projets() {
  const { db, scope, visible, update, defaultEntity, toast } = useStore();
  const { focus, go } = useNav();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Project | null>(null);
  const [status, setStatus] = useState<'tous' | ProjectStatus>('tous');

  useEffect(() => {
    if (focus && db.projects.some((project) => project.id === focus)) setOpenId(focus);
  }, [focus, db.projects]);

  const rows = useMemo(
    () =>
      visible(db.projects)
        .filter((project) => (status === 'tous' ? true : project.status === status))
        .map((project) => {
          const docs = db.docs.filter((doc) => doc.projectId === project.id);
          const invoiced = sum(
            docs.filter((doc) => doc.kind !== 'devis' && doc.status !== 'annule'),
            (doc) => docTotals(doc, db.products).netHT,
          );
          const staff = db.assignments.filter((entry) => entry.projectId === project.id);
          const staffCost = sum(staff, (entry) => {
            const member = db.staff.find((person) => person.id === entry.staffId);
            const days = Math.max(1, (new Date(entry.end).getTime() - new Date(entry.start).getTime()) / 86400000 + 1);
            return (member?.dailyCost ?? 0) * days;
          });
          const expenses = sum(
            db.expenses.filter((expense) => expense.projectId === project.id),
            (expense) => expense.amountHT,
          );
          const done = project.checklist.filter((item) => item.done).length;
          return {
            project,
            docs,
            invoiced,
            staffCost,
            expenses,
            margin: invoiced - staffCost - expenses,
            progress: project.checklist.length ? done / project.checklist.length : 0,
            staffCount: staff.length,
          };
        })
        .sort((a, b) => b.project.start.localeCompare(a.project.start)),
    [db, visible, status],
  );

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'name',
      header: 'Projet',
      sort: (row) => row.project.name,
      cell: (row) => (
        <div className="row" style={{ gap: 8 }}>
          {scope === 'groupe' ? <EntityChip entity={row.project.entity} /> : null}
          <div style={{ minWidth: 0 }}>
            <div className="truncate">{row.project.name}</div>
            <div className="small dim truncate">
              {db.clients.find((client) => client.id === row.project.clientId)?.name ?? '—'} · {row.project.venue}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'dates',
      header: 'Période',
      sort: (row) => row.project.start,
      cell: (row) => (
        <span className="small">
          {formatDate(row.project.start)} → {formatDate(row.project.end)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Statut',
      sort: (row) => row.project.status,
      cell: (row) => <ProjectStatusBadge status={row.project.status} />,
    },
    {
      key: 'budget',
      header: 'Budget HT',
      align: 'right',
      sort: (row) => row.project.budget,
      cell: (row) => <span className="tnum">{money0(row.project.budget)}</span>,
    },
    {
      key: 'invoiced',
      header: 'Facturé HT',
      align: 'right',
      sort: (row) => row.invoiced,
      cell: (row) => <span className="tnum">{money0(row.invoiced)}</span>,
    },
    {
      key: 'margin',
      header: 'Marge',
      align: 'right',
      sort: (row) => row.margin,
      cell: (row) => (
        <span className={`tnum ${row.margin < 0 ? 'delta-down' : 'delta-up'}`}>{money0(row.margin)}</span>
      ),
    },
    {
      key: 'progress',
      header: 'Préparation',
      cell: (row) => (
        <div style={{ minWidth: 90 }}>
          <div className="meter">
            <span style={{ width: `${row.progress * 100}%` }} />
          </div>
          <span className="small dim tnum">{pct(row.progress, 0)}</span>
        </div>
      ),
    },
  ];

  return (
    <div className="view">
      <PageHeader
        title="Projets & affaires"
        subtitle="Chaque événement de sa préparation à son bilan financier"
        actions={
          <>
            <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} style={{ width: 160 }}>
              <option value="tous">Tous les statuts</option>
              <option value="preparation">En préparation</option>
              <option value="confirme">Confirmés</option>
              <option value="en-cours">En cours</option>
              <option value="termine">Terminés</option>
            </select>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setDraft(emptyProject(defaultEntity, db.clients[0]?.id ?? ''))}
            >
              + Nouveau projet
            </button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <StatTile label="Projets suivis" value={String(rows.length)} deltaLabel={`${rows.filter((row) => row.project.status === 'en-cours').length} en cours`} />
        <StatTile label="Budget engagé" value={money0(sum(rows, (row) => row.project.budget))} deltaLabel="Cumul des budgets HT" />
        <StatTile label="Facturé" value={money0(sum(rows, (row) => row.invoiced))} deltaLabel="Documents rattachés" />
        <StatTile label="Marge cumulée" value={money0(sum(rows, (row) => row.margin))} deltaLabel="Après main-d’œuvre et frais" />
      </div>

      <Card title="Liste des projets" flush>
        <DataTable
          rows={rows}
          columns={columns}
          onRowClick={(row) => setOpenId(row.project.id)}
          empty={<EmptyState mark="📁" title="Aucun projet" hint="Créez un projet pour regrouper devis, équipes et frais." />}
        />
      </Card>

      {openId ? (
        <ProjectDetail
          projectId={openId}
          onClose={() => setOpenId(null)}
          onEdit={(project) => {
            setDraft(structuredClone(project));
            setOpenId(null);
          }}
          onOpenDoc={(id, kind) => {
            setOpenId(null);
            go(kind === 'devis' ? 'devis' : 'factures', id);
          }}
        />
      ) : null}

      {draft ? (
        <ProjectForm
          value={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => {
            update((db2) => {
              const index = db2.projects.findIndex((project) => project.id === draft.id);
              if (index >= 0) db2.projects[index] = draft;
              else db2.projects.unshift(draft);
            });
            toast('Projet enregistré.', 'succes');
            setDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ProjectDetail({
  projectId,
  onClose,
  onEdit,
  onOpenDoc,
}: {
  projectId: string;
  onClose: () => void;
  onEdit: (project: Project) => void;
  onOpenDoc: (id: string, kind: string) => void;
}) {
  const { db, update, companyOf } = useStore();
  const project = db.projects.find((entry) => entry.id === projectId);
  if (!project) return null;

  const client = db.clients.find((entry) => entry.id === project.clientId);
  const docs = db.docs.filter((doc) => doc.projectId === project.id);
  const assignments = db.assignments.filter((entry) => entry.projectId === project.id);
  const expenses = db.expenses.filter((expense) => expense.projectId === project.id);
  const invoiced = sum(
    docs.filter((doc) => doc.kind !== 'devis' && doc.status !== 'annule'),
    (doc) => docTotals(doc, db.products).netHT,
  );
  const staffCost = sum(assignments, (entry) => {
    const member = db.staff.find((person) => person.id === entry.staffId);
    const days = Math.max(1, (new Date(entry.end).getTime() - new Date(entry.start).getTime()) / 86400000 + 1);
    return (member?.dailyCost ?? 0) * days;
  });

  return (
    <Modal
      title={project.name}
      subtitle={`${companyOf(project.entity).name} · ${client?.name ?? '—'} · ${project.venue}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onEdit(project)}>
            Modifier
          </button>
        </>
      }
    >
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <StatTile label="Budget HT" value={money0(project.budget)} />
        <StatTile label="Facturé HT" value={money0(invoiced)} deltaLabel={`${docs.length} document(s)`} />
        <StatTile label="Main-d’œuvre" value={money0(staffCost)} deltaLabel={`${assignments.length} affectation(s)`} />
        <StatTile
          label="Marge estimée"
          value={money0(invoiced - staffCost - sum(expenses, (expense) => expense.amountHT))}
          deltaLabel="Facturé − coûts directs"
        />
      </div>

      <div className="grid g2" style={{ gap: 18 }}>
        <div>
          <h3 style={{ marginBottom: 8 }}>Check-list de préparation</h3>
          <div className="stack-sm">
            {project.checklist.map((item) => (
              <label key={item.id} className="row" style={{ gap: 8, cursor: 'pointer', padding: '5px 0' }}>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() =>
                    update((draft) => {
                      const target = draft.projects
                        .find((entry) => entry.id === projectId)
                        ?.checklist.find((entry) => entry.id === item.id);
                      if (target) target.done = !target.done;
                    })
                  }
                />
                <span style={{ flex: 1, textDecoration: item.done ? 'line-through' : 'none', opacity: item.done ? 0.55 : 1 }}>
                  {item.label}
                </span>
                <span className="small dim">{item.owner}</span>
              </label>
            ))}
            {!project.checklist.length ? <span className="small dim">Aucune tâche de préparation.</span> : null}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const label = window.prompt('Nouvelle tâche de préparation :');
                if (!label) return;
                update((draft) => {
                  draft.projects
                    .find((entry) => entry.id === projectId)
                    ?.checklist.push({ id: uid('ck'), label, done: false, owner: draft.settings.operator });
                });
              }}
            >
              + Ajouter une tâche
            </button>
          </div>

          <h3 style={{ margin: '16px 0 8px' }}>Équipe affectée</h3>
          {assignments.length ? (
            <div className="stack-sm small">
              {assignments.map((entry) => {
                const member = db.staff.find((person) => person.id === entry.staffId);
                return (
                  <div key={entry.id} className="row" style={{ gap: 8 }}>
                    <span>{member?.name ?? '—'}</span>
                    <span className="dim">{entry.role}</span>
                    <span className="spacer" />
                    <span className="muted">
                      {formatDate(entry.start)} → {formatDate(entry.end)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="small dim">Aucune affectation.</span>
          )}
        </div>

        <div>
          <h3 style={{ marginBottom: 8 }}>Documents rattachés</h3>
          {docs.length ? (
            <div className="stack-sm">
              {docs.map((doc) => {
                const totals = docTotals(doc, db.products);
                return (
                  <button
                    key={doc.id}
                    type="button"
                    className="row"
                    style={{
                      gap: 8,
                      background: 'transparent',
                      border: 0,
                      borderBottom: '1px solid var(--line-soft)',
                      padding: '7px 0',
                      cursor: 'pointer',
                      color: 'inherit',
                      font: 'inherit',
                      width: '100%',
                      textAlign: 'left',
                    }}
                    onClick={() => onOpenDoc(doc.id, doc.kind)}
                  >
                    <span className="mono small">{doc.number}</span>
                    <span className="spacer" />
                    <span className="tnum small">{money(totals.totalTTC)}</span>
                    <Badge tone={doc.kind === 'devis' ? 'info' : 'accent'}>{doc.kind}</Badge>
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="small dim">Aucun document.</span>
          )}

          <h3 style={{ margin: '16px 0 8px' }}>Frais imputés</h3>
          {expenses.length ? (
            <div className="stack-sm small">
              {expenses.map((expense) => (
                <div key={expense.id} className="row">
                  <span className="truncate">{expense.label}</span>
                  <span className="spacer" />
                  <span className="tnum">{money(expense.amountHT)}</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="small dim">Aucun frais imputé.</span>
          )}

          {project.notes ? (
            <>
              <h3 style={{ margin: '16px 0 8px' }}>Notes</h3>
              <p className="small muted">{project.notes}</p>
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function ProjectForm({
  value,
  onChange,
  onSave,
  onClose,
}: {
  value: Project;
  onChange: (project: Project) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { db, update, toast } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exists = db.projects.some((project) => project.id === value.id);
  const set = <K extends keyof Project>(key: K, next: Project[K]) => onChange({ ...value, [key]: next });

  return (
    <>
      <Modal
        title={exists ? 'Modifier le projet' : 'Nouveau projet'}
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
          <Field label="Société">
            <select value={value.entity} onChange={(event) => set('entity', event.target.value as EntityId)}>
              {db.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Client">
            <select value={value.clientId} onChange={(event) => set('clientId', event.target.value)}>
              {db.clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Statut">
            <select value={value.status} onChange={(event) => set('status', event.target.value as ProjectStatus)}>
              <option value="preparation">En préparation</option>
              <option value="confirme">Confirmé</option>
              <option value="en-cours">En cours</option>
              <option value="termine">Terminé</option>
              <option value="annule">Annulé</option>
            </select>
          </Field>
          <Field label="Nom du projet" span={3}>
            <input value={value.name} onChange={(event) => set('name', event.target.value)} autoFocus />
          </Field>
          <Field label="Début">
            <input type="date" value={value.start} onChange={(event) => set('start', event.target.value)} />
          </Field>
          <Field label="Fin">
            <input type="date" value={value.end} onChange={(event) => set('end', event.target.value)} />
          </Field>
          <Field label="Budget HT">
            <input type="number" min={0} step={100} value={value.budget} onChange={(event) => set('budget', Number(event.target.value))} />
          </Field>
          <Field label="Lieu">
            <input value={value.venue} onChange={(event) => set('venue', event.target.value)} />
          </Field>
          <Field label="Adresse">
            <input value={value.address} onChange={(event) => set('address', event.target.value)} />
          </Field>
          <Field label="Responsable">
            <select value={value.manager} onChange={(event) => set('manager', event.target.value)}>
              <option value="">— à définir —</option>
              {db.staff.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes" span={3}>
            <textarea rows={3} value={value.notes} onChange={(event) => set('notes', event.target.value)} />
          </Field>
        </div>
      </Modal>

      {confirmDelete ? (
        <ConfirmDialog
          title="Supprimer ce projet ?"
          message="Les documents et frais rattachés seront conservés mais orphelins."
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            update((draft) => {
              draft.projects = draft.projects.filter((project) => project.id !== value.id);
            });
            toast('Projet supprimé.', 'alerte');
            setConfirmDelete(false);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
