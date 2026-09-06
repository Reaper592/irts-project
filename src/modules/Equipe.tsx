import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import type { Assignment, EntityId, Staff, StaffStatus } from '../core/types';
import { addDays, daysBetween, formatDate, money, money0, num, pct, sum, today, uid } from '../core/utils';
import { Badge, Card, ConfirmDialog, DataTable, EmptyState, Field, Modal, PageHeader, Tabs, type Column } from '../ui/kit';
import { BarList, StatTile } from '../ui/charts';
import { EntityChip } from '../ui/shared';

const STATUS_LABEL: Record<StaffStatus, string> = {
  salarie: 'Salarié',
  intermittent: 'Intermittent',
  freelance: 'Freelance',
  apprenti: 'Apprenti',
};

function emptyStaff(entity: EntityId): Staff {
  return {
    id: uid('stf'),
    entity,
    name: '',
    role: '',
    status: 'intermittent',
    dailyCost: 260,
    dailyRate: 400,
    skills: [],
    email: '',
    phone: '',
    active: true,
  };
}

export default function Equipe() {
  const { db, scope, visible, update, defaultEntity, toast } = useStore();
  const [tab, setTab] = useState('equipe');
  const [draft, setDraft] = useState<Staff | null>(null);
  const [assignDraft, setAssignDraft] = useState<Assignment | null>(null);

  const staff = useMemo(() => visible(db.staff), [db.staff, visible]);
  const assignments = useMemo(() => visible(db.assignments), [db.assignments, visible]);

  const rows = useMemo(
    () =>
      staff.map((member) => {
        const missions = assignments.filter((entry) => entry.staffId === member.id);
        const days = sum(missions, (entry) => Math.max(1, daysBetween(entry.start, entry.end) + 1));
        return {
          member,
          missions: missions.length,
          days,
          cost: days * member.dailyCost,
          billed: days * member.dailyRate,
          margin: days * (member.dailyRate - member.dailyCost),
        };
      }),
    [staff, assignments],
  );

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'name',
      header: 'Personne',
      sort: (row) => row.member.name,
      cell: (row) => (
        <div className="row" style={{ gap: 8 }}>
          {scope === 'groupe' ? <EntityChip entity={row.member.entity} /> : null}
          <div style={{ minWidth: 0 }}>
            <div className="truncate">{row.member.name}</div>
            <div className="small dim truncate">{row.member.role}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Statut',
      sort: (row) => row.member.status,
      cell: (row) => <Badge tone={row.member.status === 'salarie' ? 'accent' : 'info'}>{STATUS_LABEL[row.member.status]}</Badge>,
    },
    {
      key: 'skills',
      header: 'Compétences',
      cell: (row) => (
        <div className="row row-wrap" style={{ gap: 4 }}>
          {row.member.skills.slice(0, 3).map((skill) => (
            <span className="chip" key={skill}>
              {skill}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'cost',
      header: 'Coût / jour',
      align: 'right',
      sort: (row) => row.member.dailyCost,
      cell: (row) => <span className="tnum">{money(row.member.dailyCost)}</span>,
    },
    {
      key: 'rate',
      header: 'Tarif facturé',
      align: 'right',
      sort: (row) => row.member.dailyRate,
      cell: (row) => <span className="tnum">{money(row.member.dailyRate)}</span>,
    },
    {
      key: 'markup',
      header: 'Marge',
      align: 'right',
      sort: (row) => row.member.dailyRate - row.member.dailyCost,
      cell: (row) => (
        <span className="tnum">
          {pct(row.member.dailyRate ? (row.member.dailyRate - row.member.dailyCost) / row.member.dailyRate : 0, 0)}
        </span>
      ),
    },
    {
      key: 'days',
      header: 'Jours affectés',
      align: 'right',
      sort: (row) => row.days,
      cell: (row) => <span className="tnum">{row.days}</span>,
    },
  ];

  const upcoming = assignments
    .filter((entry) => entry.end >= today())
    .sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="view">
      <PageHeader
        title="Équipe"
        subtitle="Permanents, intermittents et prestataires — compétences, coûts et affectations"
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={() =>
                setAssignDraft({
                  id: uid('asg'),
                  entity: defaultEntity,
                  projectId: db.projects[0]?.id ?? '',
                  staffId: db.staff[0]?.id ?? '',
                  start: today(),
                  end: addDays(today(), 1),
                  role: '',
                })
              }
            >
              + Affecter à un projet
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setDraft(emptyStaff(defaultEntity))}>
              + Nouvelle personne
            </button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <StatTile label="Personnes" value={String(staff.length)} deltaLabel={`${staff.filter((m) => m.status === 'salarie').length} salariés`} />
        <StatTile label="Jours affectés" value={String(sum(rows, (row) => row.days))} deltaLabel="Toutes missions confondues" />
        <StatTile label="Coût main-d’œuvre" value={money0(sum(rows, (row) => row.cost))} deltaLabel="Coût chargé estimé" />
        <StatTile label="Marge sur main-d’œuvre" value={money0(sum(rows, (row) => row.margin))} deltaLabel="Facturé − coût chargé" />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'equipe', label: 'Équipe', count: staff.length },
          { id: 'affectations', label: 'Affectations', count: upcoming.length },
          { id: 'competences', label: 'Compétences' },
        ]}
      />

      {tab === 'equipe' ? (
        <Card title="Répertoire" flush>
          <DataTable
            rows={rows}
            columns={columns}
            onRowClick={(row) => setDraft(structuredClone(row.member))}
            empty={<EmptyState mark="👷" title="Aucune personne enregistrée" />}
          />
        </Card>
      ) : null}

      {tab === 'affectations' ? (
        <Card title="Missions à venir" subtitle="Par date de début">
          {upcoming.length ? (
            <div className="stack-sm">
              {upcoming.map((entry) => {
                const member = db.staff.find((person) => person.id === entry.staffId);
                const project = db.projects.find((item) => item.id === entry.projectId);
                const days = Math.max(1, daysBetween(entry.start, entry.end) + 1);
                return (
                  <div key={entry.id} className="row" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
                    <span className="avatar">{member?.name.slice(0, 2).toUpperCase() ?? '??'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate">
                        {member?.name ?? '—'} <span className="dim">— {entry.role}</span>
                      </div>
                      <div className="small dim truncate">{project?.name ?? 'Projet supprimé'}</div>
                    </div>
                    <span className="small muted nowrap">
                      {formatDate(entry.start)} → {formatDate(entry.end)}
                    </span>
                    <span className="small tnum" style={{ minWidth: 54, textAlign: 'right' }}>
                      {days} j
                    </span>
                    <span className="tnum" style={{ minWidth: 84, textAlign: 'right' }}>
                      {money(days * (member?.dailyRate ?? 0))}
                    </span>
                    <button type="button" className="btn btn-sm" onClick={() => setAssignDraft(structuredClone(entry))}>
                      Modifier
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState mark="📆" title="Aucune mission planifiée" />
          )}
        </Card>
      ) : null}

      {tab === 'competences' ? (
        <div className="grid g2">
          <Card title="Couverture des compétences" subtitle="Nombre de personnes mobilisables par compétence">
            <BarList
              items={Object.entries(
                staff.reduce<Record<string, number>>((acc, member) => {
                  for (const skill of member.skills) acc[skill] = (acc[skill] ?? 0) + 1;
                  return acc;
                }, {}),
              )
                .map(([label, value]) => ({ label, value }))
                .sort((a, b) => b.value - a.value)}
              format={(value) => `${num(value)} pers.`}
              colorIndex={2}
            />
          </Card>
          <Card title="Points de fragilité" subtitle="Compétences portées par une seule personne">
            {(() => {
              const counts = staff.reduce<Record<string, string[]>>((acc, member) => {
                for (const skill of member.skills) (acc[skill] ||= []).push(member.name);
                return acc;
              }, {});
              const fragile = Object.entries(counts).filter(([, people]) => people.length === 1);
              if (!fragile.length) return <EmptyState mark="✔" title="Aucune compétence isolée" />;
              return (
                <div className="stack-sm">
                  {fragile.map(([skill, people]) => (
                    <div key={skill} className="row" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
                      <Badge tone="warning" icon="⚠">
                        1 personne
                      </Badge>
                      <span style={{ flex: 1 }}>{skill}</span>
                      <span className="small dim">{people[0]}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Card>
        </div>
      ) : null}

      {draft ? (
        <StaffForm
          value={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => {
            update((db2) => {
              const index = db2.staff.findIndex((member) => member.id === draft.id);
              if (index >= 0) db2.staff[index] = draft;
              else db2.staff.unshift(draft);
            });
            toast('Fiche enregistrée.', 'succes');
            setDraft(null);
          }}
        />
      ) : null}

      {assignDraft ? (
        <Modal
          title="Affectation"
          onClose={() => setAssignDraft(null)}
          footer={
            <>
              {db.assignments.some((entry) => entry.id === assignDraft.id) ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    update((draft2) => {
                      draft2.assignments = draft2.assignments.filter((entry) => entry.id !== assignDraft.id);
                    });
                    setAssignDraft(null);
                    toast('Affectation supprimée.', 'alerte');
                  }}
                >
                  Supprimer
                </button>
              ) : null}
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => setAssignDraft(null)}>
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  update((draft2) => {
                    const index = draft2.assignments.findIndex((entry) => entry.id === assignDraft.id);
                    if (index >= 0) draft2.assignments[index] = assignDraft;
                    else draft2.assignments.push(assignDraft);
                  });
                  toast('Affectation enregistrée.', 'succes');
                  setAssignDraft(null);
                }}
              >
                Enregistrer
              </button>
            </>
          }
        >
          <div className="grid g2">
            <Field label="Personne">
              <select value={assignDraft.staffId} onChange={(event) => setAssignDraft({ ...assignDraft, staffId: event.target.value })}>
                {db.staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} — {member.role}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Projet">
              <select
                value={assignDraft.projectId}
                onChange={(event) => {
                  const project = db.projects.find((entry) => entry.id === event.target.value);
                  setAssignDraft({
                    ...assignDraft,
                    projectId: event.target.value,
                    entity: project?.entity ?? assignDraft.entity,
                    start: project?.start ?? assignDraft.start,
                    end: project?.end ?? assignDraft.end,
                  });
                }}
              >
                {db.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Début">
              <input type="date" value={assignDraft.start} onChange={(event) => setAssignDraft({ ...assignDraft, start: event.target.value })} />
            </Field>
            <Field label="Fin">
              <input type="date" value={assignDraft.end} onChange={(event) => setAssignDraft({ ...assignDraft, end: event.target.value })} />
            </Field>
            <Field label="Rôle sur la mission" span={2}>
              <input value={assignDraft.role} onChange={(event) => setAssignDraft({ ...assignDraft, role: event.target.value })} placeholder="Régie générale, son façade, accroche…" />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function StaffForm({
  value,
  onChange,
  onSave,
  onClose,
}: {
  value: Staff;
  onChange: (staff: Staff) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { db, update, toast } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exists = db.staff.some((member) => member.id === value.id);
  const set = <K extends keyof Staff>(key: K, next: Staff[K]) => onChange({ ...value, [key]: next });

  return (
    <>
      <Modal
        title={exists ? 'Modifier la fiche' : 'Nouvelle personne'}
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
        <div className="grid g2">
          <Field label="Nom">
            <input value={value.name} onChange={(event) => set('name', event.target.value)} autoFocus />
          </Field>
          <Field label="Fonction">
            <input value={value.role} onChange={(event) => set('role', event.target.value)} />
          </Field>
          <Field label="Société">
            <select value={value.entity} onChange={(event) => set('entity', event.target.value as EntityId)}>
              {db.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Statut">
            <select value={value.status} onChange={(event) => set('status', event.target.value as StaffStatus)}>
              {Object.entries(STATUS_LABEL).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Coût journalier chargé HT">
            <input type="number" min={0} step={10} value={value.dailyCost} onChange={(event) => set('dailyCost', Number(event.target.value))} />
          </Field>
          <Field label="Tarif journalier facturé HT" hint={`Marge : ${pct(value.dailyRate ? (value.dailyRate - value.dailyCost) / value.dailyRate : 0, 0)}`}>
            <input type="number" min={0} step={10} value={value.dailyRate} onChange={(event) => set('dailyRate', Number(event.target.value))} />
          </Field>
          <Field label="E-mail">
            <input value={value.email} onChange={(event) => set('email', event.target.value)} />
          </Field>
          <Field label="Téléphone">
            <input value={value.phone} onChange={(event) => set('phone', event.target.value)} />
          </Field>
          <Field label="Compétences" span={2} hint="Séparées par des virgules">
            <input
              value={value.skills.join(', ')}
              onChange={(event) => set('skills', event.target.value.split(',').map((skill) => skill.trim()).filter(Boolean))}
            />
          </Field>
        </div>
      </Modal>

      {confirmDelete ? (
        <ConfirmDialog
          title="Supprimer cette personne ?"
          message="Ses affectations passées resteront enregistrées."
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            update((draft) => {
              draft.staff = draft.staff.filter((member) => member.id !== value.id);
            });
            toast('Fiche supprimée.', 'alerte');
            setConfirmDelete(false);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
