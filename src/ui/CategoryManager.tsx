import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import type { Category, CategoryField, EntityId, FieldKind, TaxonomyDomain } from '../core/types';
import { uid } from '../core/utils';
import { Badge, Field, Modal } from './kit';

export const DOMAIN_LABEL: Record<TaxonomyDomain, string> = {
  catalogue: 'Catégories du catalogue',
  objet3d: 'Familles d’objets 3D',
  charge: 'Catégories de charges',
  source: 'Origines des affaires',
  competence: 'Compétences',
  projet: 'Types de projets',
  client: 'Segments clients',
  etiquette: 'Étiquettes',
};

const ICONS = ['📦', '🔊', '💡', '🟥', '🏗️', '🪑', '⛺', '🌳', '⚡', '🚶', '🎪', '🎧', '🎛️', '🚚', '👷', '📐', '🔧', '🛡️', '💍', '🏢', '🏛️', '🤝', '📣', '💻', '🌐', '★', '↻', '•'];
const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#8592a3', '#9c6b3f'];

function emptyCategory(domain: TaxonomyDomain, order: number): Category {
  return {
    id: uid('cat'),
    domain,
    entity: 'groupe',
    label: '',
    color: COLORS[order % COLORS.length],
    icon: '📦',
    parentId: null,
    order,
    fields: [],
    archived: false,
    notes: '',
  };
}

/**
 * Gestion des categories d'un domaine : creation, renommage, couleur, ordre,
 * parametres imposes et suppression avec reaffectation des elements.
 */
export function CategoryManager({ domain, onClose }: { domain: TaxonomyDomain; onClose: () => void }) {
  const { db, saveCategory, deleteCategory, toast } = useStore();
  const [draft, setDraft] = useState<Category | null>(null);
  const [confirm, setConfirm] = useState<Category | null>(null);
  const [reassign, setReassign] = useState<string>('');

  const list = useMemo(
    () => db.categories.filter((entry) => entry.domain === domain).sort((a, b) => a.order - b.order),
    [db.categories, domain],
  );

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (id: string | null | undefined) => {
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    };
    if (domain === 'catalogue') for (const product of db.products) bump(product.categoryId);
    if (domain === 'charge') for (const expense of db.expenses) bump(expense.category);
    if (domain === 'projet') for (const project of db.projects) bump(project.categoryId);
    if (domain === 'objet3d') for (const scene of db.scenes) for (const item of scene.items) bump(item.categoryId);
    if (domain === 'source') {
      for (const deal of db.deals) {
        const match = db.categories.find((entry) => entry.domain === 'source' && entry.label === deal.source);
        bump(match?.id);
      }
    }
    if (domain === 'competence') {
      for (const member of db.staff) {
        for (const skill of member.skills) {
          const match = db.categories.find((entry) => entry.domain === 'competence' && entry.label === skill);
          bump(match?.id);
        }
      }
    }
    return counts;
  }, [db, domain]);

  const move = (category: Category, delta: number) => {
    const index = list.findIndex((entry) => entry.id === category.id);
    const target = list[index + delta];
    if (!target) return;
    saveCategory({ ...category, order: target.order });
    saveCategory({ ...target, order: category.order });
  };

  return (
    <>
      <Modal
        title={DOMAIN_LABEL[domain]}
        subtitle="Ajoutez, renommez, réordonnez ou supprimez — les éléments suivent"
        size="lg"
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setDraft(emptyCategory(domain, list.length))}
            >
              + Nouvelle catégorie
            </button>
            <div className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              Fermer
            </button>
          </>
        }
      >
        {list.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Catégorie</th>
                  <th>Portée</th>
                  <th className="num">Paramètres</th>
                  <th className="num">Éléments</th>
                  <th style={{ width: 130 }} />
                </tr>
              </thead>
              <tbody>
                {list.map((category, index) => (
                  <tr key={category.id}>
                    <td className="center" style={{ fontSize: 16 }}>
                      {category.icon}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="scope-dot" style={{ background: category.color }} />
                        <span>{category.label}</span>
                        {category.archived ? <Badge>archivée</Badge> : null}
                      </div>
                      {category.notes ? <div className="small dim">{category.notes}</div> : null}
                    </td>
                    <td className="small muted">
                      {category.entity === 'groupe' ? 'Toutes sociétés' : db.companies.find((c) => c.id === category.entity)?.name}
                    </td>
                    <td className="num tnum">{category.fields.length || '—'}</td>
                    <td className="num tnum">{usage.get(category.id) ?? 0}</td>
                    <td>
                      <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => move(category, -1)}>
                          ↑
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={index === list.length - 1} onClick={() => move(category, 1)}>
                          ↓
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setDraft(structuredClone(category))}>
                          ✎
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setConfirm(category);
                            setReassign(list.find((entry) => entry.id !== category.id)?.id ?? '');
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Aucune catégorie dans ce domaine. Créez la première.</p>
        )}
      </Modal>

      {draft ? (
        <CategoryForm
          value={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => {
            saveCategory(draft);
            toast('Catégorie enregistrée.', 'succes');
            setDraft(null);
          }}
        />
      ) : null}

      {confirm ? (
        <Modal
          title={`Supprimer « ${confirm.label} » ?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  deleteCategory(confirm.id, reassign || null);
                  toast('Catégorie supprimée.', 'alerte');
                  setConfirm(null);
                }}
              >
                Supprimer
              </button>
            </>
          }
        >
          <p className="muted">
            {usage.get(confirm.id)
              ? `${usage.get(confirm.id)} élément(s) utilisent cette catégorie. Choisissez la catégorie qui les reprendra.`
              : 'Aucun élément n’utilise cette catégorie.'}
          </p>
          <Field label="Reclasser les éléments dans">
            <select value={reassign} onChange={(event) => setReassign(event.target.value)}>
              <option value="">— aucune catégorie —</option>
              {list
                .filter((entry) => entry.id !== confirm.id)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
            </select>
          </Field>
        </Modal>
      ) : null}
    </>
  );
}

function CategoryForm({
  value,
  onChange,
  onSave,
  onClose,
}: {
  value: Category;
  onChange: (category: Category) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { db } = useStore();
  const set = <K extends keyof Category>(key: K, next: Category[K]) => onChange({ ...value, [key]: next });

  const setField = (id: string, changes: Partial<CategoryField>) =>
    set('fields', value.fields.map((field) => (field.id === id ? { ...field, ...changes } : field)));

  return (
    <Modal
      title={value.label ? `Catégorie « ${value.label} »` : 'Nouvelle catégorie'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" disabled={!value.label.trim()} onClick={onSave}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="grid g2" style={{ gap: 12 }}>
        <Field label="Nom">
          <input value={value.label} onChange={(event) => set('label', event.target.value)} autoFocus />
        </Field>
        <Field label="Portée">
          <select value={value.entity} onChange={(event) => set('entity', event.target.value as EntityId | 'groupe')}>
            <option value="groupe">Toutes les sociétés</option>
            {db.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Couleur">
          <div className="row row-wrap" style={{ gap: 5 }}>
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={value.color === color}
                onClick={() => set('color', color)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: color,
                  border: value.color === color ? '2px solid var(--ink)' : '1px solid var(--line)',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </Field>
        <Field label="Pictogramme">
          <div className="row row-wrap" style={{ gap: 4 }}>
            {ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                aria-pressed={value.icon === icon}
                onClick={() => set('icon', icon)}
                className="btn btn-sm"
                style={{ background: value.icon === icon ? 'var(--accent-soft)' : undefined }}
              >
                {icon}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Catégorie parente" hint="Pour organiser les listes en arborescence">
          <select value={value.parentId ?? ''} onChange={(event) => set('parentId', event.target.value || null)}>
            <option value="">— aucune —</option>
            {db.categories
              .filter((entry) => entry.domain === value.domain && entry.id !== value.id)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Archivée" hint="Masquée dans les listes, conservée sur les fiches existantes">
          <label className="row" style={{ gap: 8, cursor: 'pointer', padding: '7px 0' }}>
            <input type="checkbox" checked={value.archived} onChange={(event) => set('archived', event.target.checked)} />
            <span className="small">Ne plus proposer cette catégorie</span>
          </label>
        </Field>

        <Field label="Note interne" span={2}>
          <input value={value.notes} onChange={(event) => set('notes', event.target.value)} />
        </Field>

        <div style={{ gridColumn: '1 / -1' }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <h3>Paramètres imposés</h3>
            <span className="small dim">— champs supplémentaires portés par les éléments de cette catégorie</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                set('fields', [
                  ...value.fields,
                  { id: uid('f'), label: '', kind: 'texte', options: [], unit: '', defaultValue: '', required: false },
                ])
              }
            >
              + Paramètre
            </button>
          </div>
          <div className="stack-sm">
            {value.fields.map((field) => (
              <div key={field.id} className="row" style={{ gap: 6 }}>
                <input
                  placeholder="Nom du paramètre"
                  value={field.label}
                  onChange={(event) => setField(field.id, { label: event.target.value })}
                />
                <select
                  value={field.kind}
                  style={{ width: 120 }}
                  onChange={(event) => setField(field.id, { kind: event.target.value as FieldKind })}
                >
                  <option value="texte">Texte</option>
                  <option value="nombre">Nombre</option>
                  <option value="booleen">Oui / non</option>
                  <option value="liste">Liste</option>
                </select>
                <input
                  placeholder={field.kind === 'liste' ? 'Options, séparées par des virgules' : 'Unité'}
                  style={{ width: 200 }}
                  value={field.kind === 'liste' ? field.options.join(', ') : field.unit}
                  onChange={(event) =>
                    field.kind === 'liste'
                      ? setField(field.id, { options: event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean) })
                      : setField(field.id, { unit: event.target.value })
                  }
                />
                <label className="row small nowrap" style={{ gap: 5 }}>
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) => setField(field.id, { required: event.target.checked })}
                  />
                  requis
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => set('fields', value.fields.filter((entry) => entry.id !== field.id))}
                >
                  ✕
                </button>
              </div>
            ))}
            {!value.fields.length ? <span className="small dim">Aucun paramètre supplémentaire.</span> : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Selecteur de categorie avec acces direct a la gestion : chaque menu de
 * l'application permet d'ajouter ou de modifier ses categories sur place.
 */
export function CategorySelect({
  domain,
  value,
  entity,
  onChange,
  allowEmpty = true,
  emptyLabel = '— non classé —',
}: {
  domain: TaxonomyDomain;
  value: string | null;
  entity?: EntityId | 'groupe';
  onChange: (id: string | null) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const { categories } = useStore();
  const [manage, setManage] = useState(false);
  const list = categories(domain, entity);

  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
          {allowEmpty ? <option value="">{emptyLabel}</option> : null}
          {list.map((category) => (
            <option key={category.id} value={category.id}>
              {category.icon} {category.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" title="Gérer les catégories" onClick={() => setManage(true)}>
          ⚙
        </button>
      </div>
      {manage ? <CategoryManager domain={domain} onClose={() => setManage(false)} /> : null}
    </>
  );
}

/** Bouton d'ouverture du gestionnaire, a poser dans les barres d'outils. */
export function ManageCategoriesButton({ domain, label }: { domain: TaxonomyDomain; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
        ⚙ {label ?? 'Catégories'}
      </button>
      {open ? <CategoryManager domain={domain} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function CategoryBadge({ id }: { id: string | null | undefined }) {
  const { categoryById } = useStore();
  const category = categoryById(id);
  if (!category) return <span className="small dim">—</span>;
  return (
    <span className="chip" style={{ borderColor: category.color }}>
      <span aria-hidden="true">{category.icon}</span>
      {category.label}
    </span>
  );
}
