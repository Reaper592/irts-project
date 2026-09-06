import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { availability, degressiveCoef, reservationsFrom, DEFAULT_DEGRESSIVE } from '../core/calc';
import type { EntityId, GearState, Product, ProductMode } from '../core/types';
import { addDays, downloadFile, formatDate, money, money0, num, pct, sum, toCSV, today, uid } from '../core/utils';
import { Badge, Card, ConfirmDialog, DataTable, EmptyState, Field, Modal, PageHeader, Tabs, type Column } from '../ui/kit';
import { BarList, DonutChart, StatTile } from '../ui/charts';
import { EntityChip } from '../ui/shared';
import { CategoryBadge, CategorySelect, ManageCategoriesButton } from '../ui/CategoryManager';

const MODE_LABEL: Record<ProductMode, string> = {
  location: 'Location',
  vente: 'Vente',
  service: 'Service',
  forfait: 'Forfait',
};

const STATE_LABEL: Record<GearState, { label: string; tone: 'good' | 'warning' | 'critical' | 'info' }> = {
  ok: { label: 'Opérationnel', tone: 'good' },
  maintenance: { label: 'En maintenance', tone: 'warning' },
  hs: { label: 'Hors service', tone: 'critical' },
  reserve: { label: 'Réservé', tone: 'info' },
};

function emptyProduct(entity: EntityId): Product {
  return {
    id: uid('prd'),
    entity,
    ref: '',
    name: '',
    brand: '',
    model: '',
    category: '',
    categoryId: null,
    attributes: {},
    mode: 'location',
    unit: 'unité',
    priceDay: 0,
    priceSale: 0,
    cost: 0,
    vatRate: 20,
    stock: 1,
    weightKg: 0,
    powerW: 0,
    specs: {},
    degressive: DEFAULT_DEGRESSIVE,
    mark: '📦',
    model3d: null,
    serials: [],
    active: true,
  };
}

export default function Catalogue() {
  const store = useStore();
  const { db, scope, visible, update, defaultEntity, toast } = store;
  const [tab, setTab] = useState('catalogue');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('toutes');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Product | null>(null);
  const [window0, setWindow0] = useState({ start: today(), end: addDays(today(), 7) });

  const products = useMemo(() => visible(db.products), [db.products, visible]);
  const reservations = useMemo(() => reservationsFrom(db.docs), [db.docs]);

  const catalogueCategories = store.categories('catalogue');
  const categoryOptions = useMemo(
    () => [
      { id: 'toutes', label: 'Toutes catégories' },
      ...catalogueCategories.map((entry) => ({ id: entry.id, label: `${entry.icon} ${entry.label}` })),
    ],
    [catalogueCategories],
  );

  const rows = useMemo(() => {
    const months = 12;
    const since = addDays(today(), -365);
    return products
      .filter((product) => (category === 'toutes' ? true : product.categoryId === category))
      .filter((product) => {
        if (!query.trim()) return true;
        return `${product.name} ${product.ref} ${product.brand} ${product.model} ${product.category}`
          .toLowerCase()
          .includes(query.toLowerCase());
      })
      .map((product) => {
        const revenue = sum(
          db.docs.filter((doc) => doc.kind !== 'devis' && doc.status !== 'annule' && doc.date >= since),
          (doc) =>
            sum(
              doc.lines.filter((line) => line.productId === product.id),
              (line) => line.qty * line.unitPrice * line.days * (1 - line.discountPct / 100),
            ),
        );
        const stock = availability(product, reservations, window0.start, window0.end);
        const capital = product.stock * product.cost;
        return {
          product,
          revenue,
          stock,
          capital,
          /** Retour sur immobilisation : CA annuel rapporté au capital engagé. */
          roi: capital ? revenue / capital : 0,
          months,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [products, db.docs, reservations, query, category, window0]);

  const parc = rows.filter((row) => row.product.mode === 'location');

  const stats = useMemo(() => {
    const capital = sum(parc, (row) => row.capital);
    const revenue = sum(rows, (row) => row.revenue);
    const parcRevenue = sum(parc, (row) => row.revenue);
    const outOfOrder = sum(parc, (row) => row.stock.outOfOrder);
    const byCategory = new Map<string, number>();
    for (const row of rows) byCategory.set(row.product.category, (byCategory.get(row.product.category) ?? 0) + row.revenue);
    return {
      capital,
      revenue,
      outOfOrder,
      roi: capital ? parcRevenue / capital : 0,
      references: rows.length,
      units: sum(parc, (row) => row.product.stock),
      categories: [...byCategory.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6),
    };
  }, [rows, parc]);

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'name',
      header: 'Référence',
      sort: (row) => row.product.name,
      cell: (row) => (
        <div className="row" style={{ gap: 9 }}>
          <span style={{ fontSize: 16 }}>{row.product.mark}</span>
          <div style={{ minWidth: 0 }}>
            <div className="truncate">{row.product.name}</div>
            <div className="small dim">
              {row.product.ref} · {row.product.brand}
            </div>
          </div>
        </div>
      ),
    },
    ...(scope === 'groupe'
      ? [
          {
            key: 'entity',
            header: 'Société',
            cell: (row: (typeof rows)[number]) => <EntityChip entity={row.product.entity} />,
          },
        ]
      : []),
    {
      key: 'category',
      header: 'Catégorie',
      sort: (row) => row.product.category,
      cell: (row) =>
        row.product.categoryId ? <CategoryBadge id={row.product.categoryId} /> : <span className="small muted">{row.product.category}</span>,
    },
    {
      key: 'mode',
      header: 'Mode',
      sort: (row) => row.product.mode,
      cell: (row) => <span className="small">{MODE_LABEL[row.product.mode]}</span>,
    },
    {
      key: 'price',
      header: 'Tarif HT',
      align: 'right',
      sort: (row) => (row.product.mode === 'vente' ? row.product.priceSale : row.product.priceDay),
      cell: (row) => (
        <div>
          <span className="tnum">{money(row.product.mode === 'vente' ? row.product.priceSale : row.product.priceDay)}</span>
          <div className="small dim">{row.product.mode === 'location' ? '/ jour' : row.product.unit}</div>
        </div>
      ),
    },
    {
      key: 'stock',
      header: `Dispo. ${formatDate(window0.start)} → ${formatDate(window0.end)}`,
      align: 'right',
      sort: (row) => row.stock.free,
      cell: (row) =>
        row.product.mode === 'location' ? (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <Badge tone={row.stock.free <= 0 ? 'critical' : row.stock.free < row.stock.total * 0.25 ? 'warning' : 'good'} icon={row.stock.free <= 0 ? '⚠' : '✔'}>
              {row.stock.free} / {row.stock.total}
            </Badge>
          </div>
        ) : (
          <span className="dim">—</span>
        ),
    },
    {
      key: 'revenue',
      header: 'CA 12 mois',
      align: 'right',
      sort: (row) => row.revenue,
      cell: (row) => <span className="tnum">{money(row.revenue)}</span>,
    },
    {
      key: 'roi',
      header: 'Rendement',
      align: 'right',
      sort: (row) => row.roi,
      // Le rendement ne veut dire quelque chose que pour le parc immobilise :
      // sur un produit vendu, le stock n'est pas un capital de travail.
      cell: (row) =>
        row.product.mode === 'location' && row.capital ? (
          <span className={`tnum ${row.roi > 0.5 ? 'delta-up' : row.roi < 0.15 ? 'delta-down' : ''}`}>{pct(row.roi, 0)}</span>
        ) : (
          <span className="dim">—</span>
        ),
    },
  ];

  return (
    <div className="view">
      <PageHeader
        title="Catalogue & parc"
        subtitle="Matériel de location, produits vendus, prestations et packs commerciaux"
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                downloadFile(
                  `catalogue-${today()}.csv`,
                  toCSV(
                    rows.map((row) => ({
                      Reference: row.product.ref,
                      Designation: row.product.name,
                      Categorie: row.product.category,
                      Mode: MODE_LABEL[row.product.mode],
                      'Prix jour HT': row.product.priceDay,
                      'Prix vente HT': row.product.priceSale,
                      'Cout HT': row.product.cost,
                      Stock: row.product.stock,
                      'CA 12 mois': row.revenue,
                    })),
                  ),
                  'text/csv',
                );
                toast('Export CSV téléchargé.', 'succes');
              }}
            >
              Exporter CSV
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setDraft(emptyProduct(defaultEntity))}>
              + Nouvelle référence
            </button>
          </>
        }
      />

      <div className="grid g5" style={{ marginBottom: 16 }}>
        <StatTile label="Références actives" value={String(stats.references)} deltaLabel={`${stats.units} unités au parc`} />
        <StatTile label="Capital immobilisé" value={money0(stats.capital)} deltaLabel="Valeur d’achat du parc" />
        <StatTile label="CA généré 12 mois" value={money0(stats.revenue)} deltaLabel="Lignes de documents facturés" />
        <StatTile label="Rendement du parc" value={pct(stats.roi, 0)} deltaLabel="CA annuel / capital engagé" />
        <StatTile
          label="Matériel indisponible"
          value={String(stats.outOfOrder)}
          deltaLabel="Maintenance ou hors service"
          foot={
            stats.outOfOrder ? (
              <Badge tone="warning" icon="🔧">
                Immobilisé
              </Badge>
            ) : (
              <Badge tone="good" icon="✔">
                Parc complet
              </Badge>
            )
          }
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'catalogue', label: 'Catalogue', count: rows.length },
          { id: 'packs', label: 'Packs', count: visible(db.packs).length },
          { id: 'analyse', label: 'Rentabilité' },
        ]}
      />

      {tab === 'catalogue' ? (
        <Card
          title="Références"
          flush
          actions={
            <>
              <div className="search" style={{ width: 220 }}>
                <input placeholder="Nom, marque, référence…" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <select value={category} onChange={(event) => setCategory(event.target.value)} style={{ width: 190 }}>
                {categoryOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <ManageCategoriesButton domain="catalogue" />
              <input type="date" value={window0.start} onChange={(event) => setWindow0({ ...window0, start: event.target.value })} style={{ width: 140 }} />
              <input type="date" value={window0.end} onChange={(event) => setWindow0({ ...window0, end: event.target.value })} style={{ width: 140 }} />
            </>
          }
        >
          <DataTable
            rows={rows}
            columns={columns}
            onRowClick={(row) => setOpenId(row.product.id)}
            empty={<EmptyState mark="📦" title="Catalogue vide" hint="Ajoutez une première référence." />}
          />
        </Card>
      ) : null}

      {tab === 'packs' ? (
        <div className="grid g3">
          {visible(db.packs).map((pack) => {
            const lines = pack.lines
              .map((line) => ({ line, product: db.products.find((product) => product.id === line.productId) }))
              .filter((entry) => entry.product);
            const base = sum(lines, (entry) => entry.line.qty * (entry.product!.mode === 'vente' ? entry.product!.priceSale : entry.product!.priceDay));
            return (
              <Card key={pack.id} title={`${pack.mark} ${pack.name}`} subtitle={pack.category}>
                <p className="small muted">{pack.description}</p>
                <div className="stack-sm" style={{ margin: '10px 0' }}>
                  {lines.map((entry) => (
                    <div key={entry.line.productId} className="row small">
                      <span className="truncate">{entry.product!.name}</span>
                      <span className="spacer" />
                      <span className="tnum dim">× {entry.line.qty}</span>
                    </div>
                  ))}
                </div>
                <hr className="hr" />
                <div className="row">
                  <span className="small muted">Tarif jour brut</span>
                  <span className="spacer" />
                  <span className="tnum">{money(base)}</span>
                </div>
                <div className="row">
                  <span className="small muted">Remise pack</span>
                  <span className="spacer" />
                  <span className="tnum">− {num(pack.discountPct, 0)} %</span>
                </div>
                <div className="row" style={{ fontWeight: 600, marginTop: 4 }}>
                  <span>Prix pack / jour</span>
                  <span className="spacer" />
                  <span className="tnum">{money(base * (1 - pack.discountPct / 100))}</span>
                </div>
              </Card>
            );
          })}
          {!visible(db.packs).length ? <EmptyState mark="🎁" title="Aucun pack" /> : null}
        </div>
      ) : null}

      {tab === 'analyse' ? (
        <div className="stack">
          <div className="grid g-2-1">
            <Card title="Chiffre d’affaires par référence" subtitle="12 derniers mois, HT">
              <BarList items={rows.slice(0, 10).map((row) => ({ label: row.product.name, value: row.revenue }))} />
            </Card>
            <Card title="Répartition par catégorie">
              <DonutChart parts={stats.categories} centerLabel="CA 12 mois" centerValue={money0(stats.revenue)} />
            </Card>
          </div>
          <Card title="Matériel sous-exploité" subtitle="Rendement annuel inférieur à 15 % du capital engagé — candidats à la cession ou à la sous-location">
            {parc.filter((row) => row.capital > 0 && row.roi < 0.15).length ? (
              <div className="stack-sm">
                {parc
                  .filter((row) => row.capital > 0 && row.roi < 0.15)
                  .map((row) => (
                    <div key={row.product.id} className="row" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
                      <span>{row.product.mark}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="truncate">{row.product.name}</div>
                        <div className="small dim">
                          {row.product.stock} unité(s) · capital {money0(row.capital)}
                        </div>
                      </div>
                      <span className="tnum small">{money(row.revenue)}</span>
                      <Badge tone="warning" icon="↓">
                        {pct(row.roi, 0)}
                      </Badge>
                    </div>
                  ))}
              </div>
            ) : (
              <EmptyState mark="✔" title="Tout le parc travaille" hint="Aucune référence sous le seuil de rendement." />
            )}
          </Card>
        </div>
      ) : null}

      {openId ? (
        <ProductDetail
          productId={openId}
          onClose={() => setOpenId(null)}
          onEdit={(product) => {
            setDraft(structuredClone(product));
            setOpenId(null);
          }}
        />
      ) : null}

      {draft ? (
        <ProductForm
          value={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => {
            update((db2) => {
              const index = db2.products.findIndex((product) => product.id === draft.id);
              if (index >= 0) db2.products[index] = draft;
              else db2.products.unshift(draft);
            });
            toast('Référence enregistrée.', 'succes');
            setDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Parametres imposes par la categorie du produit. */
function CategoryFields({ value, onChange }: { value: Product; onChange: (product: Product) => void }) {
  const { categoryById } = useStore();
  const category = categoryById(value.categoryId);
  if (!category?.fields.length) return null;
  const set = (fieldId: string, next: string) =>
    onChange({ ...value, attributes: { ...value.attributes, [fieldId]: next } });

  return (
    <>
      {category.fields.map((field) => (
        <Field
          key={field.id}
          label={`${field.label}${field.required ? ' *' : ''}`}
          hint={field.unit ? `en ${field.unit}` : undefined}
        >
          {field.kind === 'liste' ? (
            <select value={value.attributes[field.id] ?? ''} onChange={(event) => set(field.id, event.target.value)}>
              <option value="">—</option>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : field.kind === 'booleen' ? (
            <label className="row" style={{ gap: 8, cursor: 'pointer', padding: '7px 0' }}>
              <input
                type="checkbox"
                checked={value.attributes[field.id] === 'oui'}
                onChange={(event) => set(field.id, event.target.checked ? 'oui' : 'non')}
              />
              <span className="small">Oui</span>
            </label>
          ) : (
            <input
              type={field.kind === 'nombre' ? 'number' : 'text'}
              value={value.attributes[field.id] ?? ''}
              onChange={(event) => set(field.id, event.target.value)}
            />
          )}
        </Field>
      ))}
    </>
  );
}

/* ------------------------------------------------------------ fiche produit */

function ProductDetail({
  productId,
  onClose,
  onEdit,
}: {
  productId: string;
  onClose: () => void;
  onEdit: (product: Product) => void;
}) {
  const { db, update, toast } = useStore();
  const product = db.products.find((entry) => entry.id === productId);
  if (!product) return null;

  const reservations = reservationsFrom(db.docs).filter((entry) => entry.productId === product.id && entry.end >= today());
  const tickets = db.tickets.filter((ticket) => ticket.productId === product.id);
  const revenue = sum(
    db.docs.filter((doc) => doc.kind !== 'devis' && doc.status !== 'annule'),
    (doc) => sum(doc.lines.filter((line) => line.productId === product.id), (line) => line.qty * line.unitPrice * line.days),
  );

  return (
    <Modal
      title={`${product.mark} ${product.name}`}
      subtitle={`${product.ref} · ${product.brand} ${product.model}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onEdit(product)}>
            Modifier
          </button>
        </>
      }
    >
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <StatTile label="Tarif jour HT" value={money(product.mode === 'vente' ? product.priceSale : product.priceDay)} />
        <StatTile label="Coût d’achat" value={money(product.cost)} deltaLabel={`${product.stock} unité(s)`} />
        <StatTile label="CA cumulé" value={money0(revenue)} />
        <StatTile
          label="Amortissement"
          value={product.cost ? pct(Math.min(1, revenue / (product.cost * Math.max(1, product.stock))), 0) : '—'}
          deltaLabel="CA / capital engagé"
        />
      </div>

      <div className="grid g2" style={{ gap: 18 }}>
        <div>
          <h3 style={{ marginBottom: 8 }}>Caractéristiques</h3>
          <div className="stack-sm small">
            {Object.entries(product.specs).map(([key, value]) => (
              <div className="row" key={key}>
                <span className="muted" style={{ minWidth: 130 }}>
                  {key}
                </span>
                <span>{value}</span>
              </div>
            ))}
            <div className="row">
              <span className="muted" style={{ minWidth: 130 }}>
                Poids
              </span>
              <span>{product.weightKg ? `${num(product.weightKg, 1)} kg` : '—'}</span>
            </div>
            <div className="row">
              <span className="muted" style={{ minWidth: 130 }}>
                Puissance
              </span>
              <span>{product.powerW ? `${num(product.powerW)} W` : '—'}</span>
            </div>
            <div className="row">
              <span className="muted" style={{ minWidth: 130 }}>
                Modèle 3D
              </span>
              <span>{product.model3d ?? 'non représenté'}</span>
            </div>
          </div>

          {product.mode === 'location' ? (
            <>
              <h3 style={{ margin: '16px 0 8px' }}>Barème dégressif</h3>
              <table className="data">
                <thead>
                  <tr>
                    <th>Durée</th>
                    <th className="num">Jours facturés</th>
                    <th className="num">Prix total HT</th>
                    <th className="num">Prix / jour réel</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 7, 14, 30].map((days) => {
                    const coef = degressiveCoef(product, days);
                    return (
                      <tr key={days}>
                        <td>
                          {days} jour{days > 1 ? 's' : ''}
                        </td>
                        <td className="num tnum">{num(coef, 2)}</td>
                        <td className="num tnum">{money(coef * product.priceDay)}</td>
                        <td className="num tnum dim">{money((coef * product.priceDay) / days)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : null}
        </div>

        <div>
          <h3 style={{ marginBottom: 8 }}>Numéros de série</h3>
          {product.serials.length ? (
            <div className="stack-sm">
              {product.serials.map((serial) => (
                <div key={serial.id} className="row" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  <span className="mono">{serial.serial}</span>
                  <span className="spacer" />
                  <select
                    value={serial.state}
                    style={{ width: 150 }}
                    onChange={(event) =>
                      update((draft) => {
                        const target = draft.products
                          .find((entry) => entry.id === productId)
                          ?.serials.find((entry) => entry.id === serial.id);
                        if (target) target.state = event.target.value as GearState;
                        toast('État du matériel mis à jour.', 'succes');
                      })
                    }
                  >
                    {Object.entries(STATE_LABEL).map(([id, config]) => (
                      <option key={id} value={id}>
                        {config.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ) : (
            <span className="small dim">Pas de suivi unitaire pour cette référence.</span>
          )}

          <h3 style={{ margin: '16px 0 8px' }}>Réservations à venir</h3>
          {reservations.length ? (
            <div className="stack-sm small">
              {reservations.map((entry, index) => (
                <div key={`${entry.docId}_${index}`} className="row">
                  <span className="mono">{entry.docNumber}</span>
                  <span className="spacer" />
                  <span className="muted">
                    {formatDate(entry.start)} → {formatDate(entry.end)}
                  </span>
                  <span className="tnum" style={{ minWidth: 34, textAlign: 'right' }}>
                    × {entry.qty}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="small dim">Aucune réservation engagée.</span>
          )}

          <h3 style={{ margin: '16px 0 8px' }}>Maintenance</h3>
          {tickets.length ? (
            <div className="stack-sm small">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="row" style={{ gap: 8 }}>
                  <Badge tone={ticket.status === 'clos' ? 'good' : ticket.status === 'en-cours' ? 'warning' : 'critical'} icon="🔧">
                    {ticket.status}
                  </Badge>
                  <span className="truncate">{ticket.description}</span>
                  <span className="spacer" />
                  <span className="tnum dim">{money(ticket.cost)}</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="small dim">Aucun incident enregistré.</span>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- formulaire */

function ProductForm({
  value,
  onChange,
  onSave,
  onClose,
}: {
  value: Product;
  onChange: (product: Product) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { db, update, toast } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exists = db.products.some((product) => product.id === value.id);
  const set = <K extends keyof Product>(key: K, next: Product[K]) => onChange({ ...value, [key]: next });

  const MODELS_3D = [
    '',
    'line-array',
    'sub',
    'top-speaker',
    'monitor',
    'console',
    'dj-booth',
    'moving-head',
    'par-led',
    'blinder',
    'led-wall',
    'truss',
    'truss-tower',
    'stage-deck',
    'haze',
    'chair',
    'seating-block',
    'table-round',
    'bar',
    'lectern',
  ];

  return (
    <>
      <Modal
        title={exists ? 'Modifier la référence' : 'Nouvelle référence'}
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
            <button type="button" className="btn btn-primary" disabled={!value.name.trim() || !value.ref.trim()} onClick={onSave}>
              Enregistrer
            </button>
          </>
        }
      >
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
          <Field label="Société">
            <select value={value.entity} onChange={(event) => set('entity', event.target.value as EntityId)}>
              {db.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Référence">
            <input value={value.ref} onChange={(event) => set('ref', event.target.value.toUpperCase())} />
          </Field>
          <Field label="Mode">
            <select value={value.mode} onChange={(event) => set('mode', event.target.value as ProductMode)}>
              {Object.entries(MODE_LABEL).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pictogramme">
            <input value={value.mark} onChange={(event) => set('mark', event.target.value)} maxLength={4} />
          </Field>

          <Field label="Désignation" span={2}>
            <input value={value.name} onChange={(event) => set('name', event.target.value)} autoFocus />
          </Field>
          <Field label="Marque">
            <input value={value.brand} onChange={(event) => set('brand', event.target.value)} />
          </Field>
          <Field label="Modèle">
            <input value={value.model} onChange={(event) => set('model', event.target.value)} />
          </Field>

          <Field label="Catégorie">
            <CategorySelect
              domain="catalogue"
              value={value.categoryId}
              entity={value.entity}
              onChange={(id) => {
                const found = db.categories.find((entry) => entry.id === id);
                onChange({ ...value, categoryId: id, category: found?.label ?? value.category });
              }}
            />
          </Field>
          <Field label="Unité">
            <input value={value.unit} onChange={(event) => set('unit', event.target.value)} />
          </Field>
          <Field label="Prix location / jour HT">
            <input type="number" min={0} step={1} value={value.priceDay} onChange={(event) => set('priceDay', Number(event.target.value))} />
          </Field>
          <Field label="Prix de vente HT">
            <input type="number" min={0} step={1} value={value.priceSale} onChange={(event) => set('priceSale', Number(event.target.value))} />
          </Field>

          <Field label="Coût d’achat / revient HT">
            <input type="number" min={0} step={1} value={value.cost} onChange={(event) => set('cost', Number(event.target.value))} />
          </Field>
          <Field label="TVA (%)">
            <select value={value.vatRate} onChange={(event) => set('vatRate', Number(event.target.value))}>
              {db.settings.vatRates.map((rate) => (
                <option key={rate} value={rate}>
                  {rate} %
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stock (unités)">
            <input type="number" min={0} value={value.stock} onChange={(event) => set('stock', Number(event.target.value))} />
          </Field>
          <Field label="Modèle 3D (Studio)">
            <select value={value.model3d ?? ''} onChange={(event) => set('model3d', event.target.value || null)}>
              {MODELS_3D.map((model) => (
                <option key={model} value={model}>
                  {model || '— non représenté —'}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Poids (kg)">
            <input type="number" min={0} step={0.5} value={value.weightKg} onChange={(event) => set('weightKg', Number(event.target.value))} />
          </Field>
          <Field label="Puissance (W)">
            <input type="number" min={0} step={10} value={value.powerW} onChange={(event) => set('powerW', Number(event.target.value))} />
          </Field>
          <CategoryFields value={value} onChange={onChange} />
          <Field label="Caractéristiques libres" span={2} hint="Une par ligne, au format « clé : valeur »">
            <textarea
              rows={3}
              value={Object.entries(value.specs)
                .map(([key, spec]) => `${key} : ${spec}`)
                .join('\n')}
              onChange={(event) => {
                const specs: Record<string, string> = {};
                for (const line of event.target.value.split('\n')) {
                  const [key, ...rest] = line.split(':');
                  if (key.trim()) specs[key.trim()] = rest.join(':').trim();
                }
                set('specs', specs);
              }}
            />
          </Field>
        </div>
        <datalist id="cat-list">
          {[...new Set(db.products.map((product) => product.category))].map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>
      </Modal>

      {confirmDelete ? (
        <ConfirmDialog
          title="Supprimer cette référence ?"
          message="Les lignes de documents existantes conserveront leur libellé mais perdront le lien au catalogue."
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            update((draft) => {
              draft.products = draft.products.filter((product) => product.id !== value.id);
            });
            toast('Référence supprimée.', 'alerte');
            setConfirmDelete(false);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
