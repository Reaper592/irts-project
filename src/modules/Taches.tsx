import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { useNav } from '../core/nav';
import type { EntityId, TaskItem } from '../core/types';
import { addDays, formatDate, today, uid } from '../core/utils';
import { Badge, Card, EmptyState, Field, Modal, PageHeader, Segmented } from '../ui/kit';
import { StatTile } from '../ui/charts';
import { EntityChip } from '../ui/shared';

function emptyTask(entity: EntityId, owner: string): TaskItem {
  return {
    id: uid('tsk'),
    entity,
    label: '',
    detail: '',
    due: addDays(today(), 1),
    done: false,
    priority: 'normale',
    owner,
    linkKind: null,
    linkId: null,
  };
}

export default function Taches() {
  const { db, scope, visible, update, defaultEntity, toast } = useStore();
  const { go } = useNav();
  const [filter, setFilter] = useState<'ouvertes' | 'toutes' | 'retard'>('ouvertes');
  const [draft, setDraft] = useState<TaskItem | null>(null);

  const tasks = useMemo(() => {
    const all = visible(db.tasks);
    const filtered =
      filter === 'toutes'
        ? all
        : filter === 'retard'
          ? all.filter((task) => !task.done && task.due < today())
          : all.filter((task) => !task.done);
    return filtered.sort((a, b) => Number(a.done) - Number(b.done) || a.due.localeCompare(b.due));
  }, [db.tasks, visible, filter]);

  const stats = useMemo(() => {
    const all = visible(db.tasks);
    return {
      open: all.filter((task) => !task.done).length,
      late: all.filter((task) => !task.done && task.due < today()).length,
      todayCount: all.filter((task) => !task.done && task.due === today()).length,
      week: all.filter((task) => !task.done && task.due <= addDays(today(), 7)).length,
    };
  }, [db.tasks, visible]);

  const toggle = (taskId: string) =>
    update((draft2) => {
      const task = draft2.tasks.find((entry) => entry.id === taskId);
      if (task) task.done = !task.done;
    });

  const openLink = (task: TaskItem) => {
    if (!task.linkKind || !task.linkId) return;
    const map = { client: 'clients', devis: 'devis', facture: 'factures', projet: 'projets', lead: 'prospection' } as const;
    go(map[task.linkKind], task.linkId);
  };

  return (
    <div className="view view-narrow">
      <PageHeader
        title="Tâches"
        subtitle="Relances, préparations et engagements pris — toutes sociétés confondues"
        actions={
          <>
            <Segmented
              value={filter}
              options={[
                { value: 'ouvertes', label: 'Ouvertes' },
                { value: 'retard', label: 'En retard' },
                { value: 'toutes', label: 'Toutes' },
              ]}
              onChange={(value) => setFilter(value as typeof filter)}
            />
            <button type="button" className="btn btn-primary" onClick={() => setDraft(emptyTask(defaultEntity, db.settings.operator))}>
              + Nouvelle tâche
            </button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <StatTile label="Tâches ouvertes" value={String(stats.open)} />
        <StatTile label="Pour aujourd’hui" value={String(stats.todayCount)} />
        <StatTile label="Cette semaine" value={String(stats.week)} />
        <StatTile
          label="En retard"
          value={String(stats.late)}
          foot={stats.late ? <Badge tone="critical" icon="⚠">À traiter</Badge> : <Badge tone="good" icon="✔">À jour</Badge>}
        />
      </div>

      <Card title="Liste" flush>
        {tasks.length ? (
          <div>
            {tasks.map((task) => (
              <div
                key={task.id}
                className="row"
                style={{
                  gap: 10,
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--line-soft)',
                  opacity: task.done ? 0.5 : 1,
                }}
              >
                <input type="checkbox" checked={task.done} onChange={() => toggle(task.id)} aria-label="Terminer la tâche" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ textDecoration: task.done ? 'line-through' : 'none' }}>
                    {task.label}
                  </div>
                  {task.detail ? <div className="small dim truncate">{task.detail}</div> : null}
                </div>
                {scope === 'groupe' ? <EntityChip entity={task.entity} /> : null}
                <span className="small dim nowrap" style={{ minWidth: 110 }}>
                  {task.owner}
                </span>
                <Badge
                  tone={task.done ? 'neutre' : task.due < today() ? 'critical' : task.priority === 'haute' ? 'warning' : 'info'}
                  icon={task.due < today() && !task.done ? '⚠' : '⏱'}
                >
                  {formatDate(task.due)}
                </Badge>
                {task.linkKind ? (
                  <button type="button" className="btn btn-sm" onClick={() => openLink(task)}>
                    Ouvrir
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(structuredClone(task))}>
                  ✎
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState mark="✔" title="Rien à faire" hint="Aucune tâche ne correspond à ce filtre." />
        )}
      </Card>

      {draft ? (
        <Modal
          title={db.tasks.some((task) => task.id === draft.id) ? 'Modifier la tâche' : 'Nouvelle tâche'}
          onClose={() => setDraft(null)}
          footer={
            <>
              {db.tasks.some((task) => task.id === draft.id) ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    update((db2) => {
                      db2.tasks = db2.tasks.filter((task) => task.id !== draft.id);
                    });
                    toast('Tâche supprimée.', 'alerte');
                    setDraft(null);
                  }}
                >
                  Supprimer
                </button>
              ) : null}
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!draft.label.trim()}
                onClick={() => {
                  update((db2) => {
                    const index = db2.tasks.findIndex((task) => task.id === draft.id);
                    if (index >= 0) db2.tasks[index] = draft;
                    else db2.tasks.unshift(draft);
                  });
                  toast('Tâche enregistrée.', 'succes');
                  setDraft(null);
                }}
              >
                Enregistrer
              </button>
            </>
          }
        >
          <div className="grid g2">
            <Field label="Intitulé" span={2}>
              <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} autoFocus />
            </Field>
            <Field label="Détail" span={2}>
              <textarea rows={3} value={draft.detail} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} />
            </Field>
            <Field label="Échéance">
              <input type="date" value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} />
            </Field>
            <Field label="Priorité">
              <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskItem['priority'] })}>
                <option value="basse">Basse</option>
                <option value="normale">Normale</option>
                <option value="haute">Haute</option>
              </select>
            </Field>
            <Field label="Société">
              <select value={draft.entity} onChange={(event) => setDraft({ ...draft, entity: event.target.value as EntityId })}>
                {db.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Responsable">
              <select value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })}>
                <option value="">— à affecter —</option>
                {db.staff.map((member) => (
                  <option key={member.id} value={member.name}>
                    {member.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
