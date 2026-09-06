import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { docTotals, monthlyFinance, vatBalance } from '../core/calc';
import type { EntityId, Expense, ExpenseCategory } from '../core/types';
import {
  downloadFile,
  formatDate,
  lastMonths,
  money,
  money0,
  monthLabel,
  pct,
  sum,
  toCSV,
  today,
  uid,
} from '../core/utils';
import { Badge, Card, ConfirmDialog, DataTable, EmptyState, Field, Modal, PageHeader, Tabs, type Column } from '../ui/kit';
import { ColumnChart, DonutChart, LineChart, StatTile } from '../ui/charts';
import { EntityChip } from '../ui/shared';

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  'achat-materiel': 'Achat de matériel',
  'sous-traitance': 'Sous-traitance',
  transport: 'Transport',
  carburant: 'Carburant',
  salaires: 'Salaires & charges',
  loyer: 'Loyer',
  assurance: 'Assurance',
  marketing: 'Marketing',
  logiciels: 'Logiciels',
  maintenance: 'Maintenance',
  divers: 'Divers',
};

function emptyExpense(entity: EntityId): Expense {
  return {
    id: uid('exp'),
    entity,
    date: today(),
    label: '',
    category: 'divers',
    amountHT: 0,
    vatRate: 20,
    supplier: '',
    projectId: null,
    method: 'virement',
    recurring: false,
  };
}

export default function Finance() {
  const { db, scope, visible, update, defaultEntity, toast, companyOf } = useStore();
  const [tab, setTab] = useState('resultat');
  const [draft, setDraft] = useState<Expense | null>(null);
  const [period, setPeriod] = useState(12);

  const months = useMemo(() => lastMonths(period), [period]);
  const from = `${months[0]}-01`;
  const to = today();

  const docs = useMemo(
    () => visible(db.docs).filter((doc) => doc.kind !== 'devis' && doc.status !== 'annule'),
    [db.docs, visible],
  );
  const expenses = useMemo(() => visible(db.expenses), [db.expenses, visible]);

  const cash = useMemo(() => monthlyFinance(docs, expenses, db.products, months), [docs, expenses, db.products, months]);
  const vat = useMemo(() => vatBalance(docs, expenses, db.products, from, to), [docs, expenses, db.products, from, to]);

  const totals = useMemo(() => {
    const inPeriod = docs.filter((doc) => months.includes(doc.date.slice(0, 7)));
    const expensesPeriod = expenses.filter((expense) => months.includes(expense.date.slice(0, 7)));
    const revenue = sum(inPeriod, (doc) => docTotals(doc, db.products).netHT);
    const charges = sum(expensesPeriod, (expense) => expense.amountHT);
    const collected = sum(
      inPeriod.flatMap((doc) => doc.payments),
      (payment) => payment.amount,
    );
    const byCategory = new Map<string, number>();
    for (const expense of expensesPeriod) {
      byCategory.set(CATEGORY_LABEL[expense.category], (byCategory.get(CATEGORY_LABEL[expense.category]) ?? 0) + expense.amountHT);
    }
    const byEntity = new Map<EntityId, { revenue: number; charges: number }>();
    for (const doc of inPeriod) {
      const entry = byEntity.get(doc.entity) ?? { revenue: 0, charges: 0 };
      entry.revenue += docTotals(doc, db.products).netHT;
      byEntity.set(doc.entity, entry);
    }
    for (const expense of expensesPeriod) {
      const entry = byEntity.get(expense.entity) ?? { revenue: 0, charges: 0 };
      entry.charges += expense.amountHT;
      byEntity.set(expense.entity, entry);
    }
    return {
      revenue,
      charges,
      collected,
      result: revenue - charges,
      margin: revenue ? (revenue - charges) / revenue : 0,
      categories: [...byCategory.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      byEntity: [...byEntity.entries()],
      recurring: sum(expensesPeriod.filter((expense) => expense.recurring), (expense) => expense.amountHT) / Math.max(1, period),
    };
  }, [docs, expenses, db.products, months, period]);

  const expenseRows = useMemo(
    () => [...expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 400),
    [expenses],
  );

  const columns: Column<Expense>[] = [
    {
      key: 'date',
      header: 'Date',
      sort: (row) => row.date,
      cell: (row) => <span className="small">{formatDate(row.date)}</span>,
    },
    {
      key: 'label',
      header: 'Libellé',
      sort: (row) => row.label,
      cell: (row) => (
        <div className="row" style={{ gap: 8 }}>
          {scope === 'groupe' ? <EntityChip entity={row.entity} /> : null}
          <div style={{ minWidth: 0 }}>
            <div className="truncate">{row.label}</div>
            {row.supplier ? <div className="small dim">{row.supplier}</div> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Catégorie',
      sort: (row) => row.category,
      cell: (row) => <span className="small muted">{CATEGORY_LABEL[row.category]}</span>,
    },
    {
      key: 'recurring',
      header: 'Type',
      cell: (row) => (row.recurring ? <Badge icon="↻">Récurrent</Badge> : <span className="small dim">Ponctuel</span>),
    },
    {
      key: 'ht',
      header: 'Montant HT',
      align: 'right',
      sort: (row) => row.amountHT,
      cell: (row) => <span className="tnum">{money(row.amountHT)}</span>,
    },
    {
      key: 'ttc',
      header: 'TTC',
      align: 'right',
      sort: (row) => row.amountHT * (1 + row.vatRate / 100),
      cell: (row) => <span className="tnum dim">{money(row.amountHT * (1 + row.vatRate / 100))}</span>,
    },
  ];

  return (
    <div className="view">
      <PageHeader
        title="Finance"
        subtitle="Résultat, trésorerie, charges et TVA — par société ou consolidé"
        actions={
          <>
            <select value={period} onChange={(event) => setPeriod(Number(event.target.value))} style={{ width: 150 }}>
              <option value={3}>3 derniers mois</option>
              <option value={6}>6 derniers mois</option>
              <option value={12}>12 derniers mois</option>
              <option value={24}>24 derniers mois</option>
            </select>
            <button type="button" className="btn btn-primary" onClick={() => setDraft(emptyExpense(defaultEntity))}>
              + Saisir une charge
            </button>
          </>
        }
      />

      <div className="grid g5" style={{ marginBottom: 16 }}>
        <StatTile label="Produits HT" value={money0(totals.revenue)} trend={cash.map((row) => row.revenue)} />
        <StatTile label="Charges HT" value={money0(totals.charges)} trend={cash.map((row) => row.charges)} />
        <StatTile
          label="Résultat"
          value={money0(totals.result)}
          deltaLabel={`${pct(totals.margin, 0)} de marge nette`}
          foot={
            totals.result >= 0 ? (
              <Badge tone="good" icon="✔">
                Bénéficiaire
              </Badge>
            ) : (
              <Badge tone="critical" icon="⚠">
                Déficitaire
              </Badge>
            )
          }
        />
        <StatTile label="Encaissé" value={money0(totals.collected)} deltaLabel="Règlements reçus sur la période" />
        <StatTile
          label="TVA à reverser"
          value={money0(vat.due)}
          deltaLabel={`Collectée ${money0(vat.collected)} · déductible ${money0(vat.deductible)}`}
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'resultat', label: 'Compte de résultat' },
          { id: 'tresorerie', label: 'Trésorerie' },
          { id: 'charges', label: 'Charges', count: expenses.length },
          { id: 'tva', label: 'TVA' },
        ]}
      />

      {tab === 'resultat' ? (
        <div className="stack">
          <div className="grid g-2-1">
            <Card title="Produits et charges" subtitle="Montants mensuels HT">
              <ColumnChart
                categories={cash.map((row) => monthLabel(row.month))}
                series={[
                  { label: 'Produits', values: cash.map((row) => row.revenue) },
                  { label: 'Charges', values: cash.map((row) => row.charges) },
                ]}
                height={260}
              />
            </Card>
            <Card title="Structure des charges" subtitle="Répartition sur la période">
              <DonutChart parts={totals.categories.slice(0, 6)} centerLabel="charges HT" centerValue={money0(totals.charges)} />
            </Card>
          </div>

          <Card title="Résultat par société" subtitle="Produits, charges et marge nette de chaque entité">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Société</th>
                    <th className="num">Produits HT</th>
                    <th className="num">Charges HT</th>
                    <th className="num">Résultat</th>
                    <th className="num">Marge nette</th>
                    <th className="num">Objectif annuel</th>
                    <th className="num">Atteinte</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.byEntity.map(([entity, entry]) => {
                    const target = db.settings.revenueTargets[entity] ?? 0;
                    return (
                      <tr key={entity}>
                        <td>
                          <div className="row" style={{ gap: 8 }}>
                            <EntityChip entity={entity} />
                            {companyOf(entity).name}
                          </div>
                        </td>
                        <td className="num tnum">{money(entry.revenue)}</td>
                        <td className="num tnum">{money(entry.charges)}</td>
                        <td className={`num tnum ${entry.revenue - entry.charges >= 0 ? 'delta-up' : 'delta-down'}`}>
                          {money(entry.revenue - entry.charges)}
                        </td>
                        <td className="num tnum">{pct(entry.revenue ? (entry.revenue - entry.charges) / entry.revenue : 0, 0)}</td>
                        <td className="num tnum dim">{money0(target)}</td>
                        <td className="num tnum">{target ? pct(entry.revenue / target, 0) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Consolidé</td>
                    <td className="num tnum">{money(totals.revenue)}</td>
                    <td className="num tnum">{money(totals.charges)}</td>
                    <td className="num tnum">{money(totals.result)}</td>
                    <td className="num tnum">{pct(totals.margin, 0)}</td>
                    <td className="num tnum" />
                    <td className="num tnum" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'tresorerie' ? (
        <div className="stack">
          <Card title="Chiffre d’affaires facturé et encaissements" subtitle="L’écart entre les deux courbes mesure le décalage de règlement">
            <LineChart
              categories={cash.map((row) => monthLabel(row.month))}
              series={[
                { label: 'Facturé HT', values: cash.map((row) => row.revenue) },
                { label: 'Encaissé TTC', values: cash.map((row) => row.encaisse) },
              ]}
              height={270}
              area
            />
          </Card>
          <div className="grid g2">
            <Card title="Charges fixes mensuelles" subtitle="Moyenne des charges récurrentes sur la période">
              <div className="tile-value">{money0(totals.recurring)}</div>
              <p className="small muted" style={{ marginTop: 8 }}>
                Point mort mensuel estimé : il faut facturer au moins {money0(totals.recurring / 0.45)} HT par mois pour
                couvrir les charges fixes avec un taux de marge sur coûts variables de 45 %.
              </p>
            </Card>
            <Card title="Prochaines échéances de règlement" subtitle="Factures non soldées, par date d’échéance">
              {(() => {
                const pending = docs
                  .map((doc) => ({ doc, totals: docTotals(doc, db.products) }))
                  .filter((entry) => entry.totals.balance > 0.5)
                  .sort((a, b) => a.doc.dueDate.localeCompare(b.doc.dueDate))
                  .slice(0, 8);
                if (!pending.length) return <EmptyState mark="✔" title="Aucun encours" />;
                return (
                  <div className="stack-sm">
                    {pending.map((entry) => (
                      <div key={entry.doc.id} className="row" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
                        <span className="small muted" style={{ minWidth: 84 }}>
                          {formatDate(entry.doc.dueDate)}
                        </span>
                        <span className="truncate" style={{ flex: 1 }}>
                          {db.clients.find((client) => client.id === entry.doc.clientId)?.name ?? '—'}
                        </span>
                        <span className="tnum">{money(entry.totals.balance)}</span>
                        {entry.doc.dueDate < today() ? (
                          <Badge tone="critical" icon="⚠">
                            échue
                          </Badge>
                        ) : null}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Card>
          </div>
        </div>
      ) : null}

      {tab === 'charges' ? (
        <Card
          title="Journal des charges"
          flush
          actions={
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                downloadFile(
                  `charges-${today()}.csv`,
                  toCSV(
                    expenseRows.map((expense) => ({
                      Date: expense.date,
                      Societe: companyOf(expense.entity).name,
                      Libelle: expense.label,
                      Categorie: CATEGORY_LABEL[expense.category],
                      Fournisseur: expense.supplier,
                      'Montant HT': expense.amountHT,
                      'TVA %': expense.vatRate,
                    })),
                  ),
                  'text/csv',
                );
                toast('Export CSV téléchargé.', 'succes');
              }}
            >
              Exporter CSV
            </button>
          }
        >
          <DataTable
            rows={expenseRows}
            columns={columns}
            onRowClick={(row) => setDraft(structuredClone(row))}
            initialSort={{ key: 'date', dir: -1 }}
            empty={<EmptyState mark="🧾" title="Aucune charge saisie" />}
          />
        </Card>
      ) : null}

      {tab === 'tva' ? (
        <div className="grid g2">
          <Card title="Déclaration de TVA" subtitle={`Période du ${formatDate(from)} au ${formatDate(to)}`}>
            <div className="totals">
              <div className="totals-row">
                <span className="muted">TVA collectée sur les ventes</span>
                <span className="tnum">{money(vat.collected)}</span>
              </div>
              <div className="totals-row">
                <span className="muted">TVA déductible sur les achats</span>
                <span className="tnum">− {money(vat.deductible)}</span>
              </div>
              <div className="totals-row grand">
                <span>{vat.due >= 0 ? 'TVA à décaisser' : 'Crédit de TVA'}</span>
                <span className="tnum">{money(Math.abs(vat.due))}</span>
              </div>
            </div>
            <p className="small muted" style={{ marginTop: 12 }}>
              Ce calcul agrège les documents et les charges de la période sélectionnée. Il donne un ordre de grandeur
              pour préparer la déclaration, il ne s’y substitue pas.
            </p>
          </Card>
          <Card title="TVA par mois" subtitle="Collectée nette de la TVA déductible">
            <ColumnChart
              categories={months.map(monthLabel)}
              series={[
                {
                  label: 'TVA nette',
                  values: months.map((month) => {
                    const monthly = vatBalance(
                      docs.filter((doc) => doc.date.startsWith(month)),
                      expenses.filter((expense) => expense.date.startsWith(month)),
                      db.products,
                      `${month}-01`,
                      `${month}-31`,
                    );
                    return Math.max(0, monthly.due);
                  }),
                },
              ]}
              height={240}
            />
          </Card>
        </div>
      ) : null}

      {draft ? (
        <ExpenseForm
          value={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => {
            update((db2) => {
              const index = db2.expenses.findIndex((expense) => expense.id === draft.id);
              if (index >= 0) db2.expenses[index] = draft;
              else db2.expenses.unshift(draft);
            });
            toast('Charge enregistrée.', 'succes');
            setDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ExpenseForm({
  value,
  onChange,
  onSave,
  onClose,
}: {
  value: Expense;
  onChange: (expense: Expense) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { db, update, toast } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exists = db.expenses.some((expense) => expense.id === value.id);
  const set = <K extends keyof Expense>(key: K, next: Expense[K]) => onChange({ ...value, [key]: next });

  return (
    <>
      <Modal
        title={exists ? 'Modifier la charge' : 'Nouvelle charge'}
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
            <button type="button" className="btn btn-primary" disabled={!value.label.trim()} onClick={onSave}>
              Enregistrer
            </button>
          </>
        }
      >
        <div className="grid g2">
          <Field label="Société">
            <select value={value.entity} onChange={(event) => set('entity', event.target.value as EntityId)}>
              {db.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={value.date} onChange={(event) => set('date', event.target.value)} />
          </Field>
          <Field label="Libellé" span={2}>
            <input value={value.label} onChange={(event) => set('label', event.target.value)} autoFocus />
          </Field>
          <Field label="Catégorie">
            <select value={value.category} onChange={(event) => set('category', event.target.value as ExpenseCategory)}>
              {Object.entries(CATEGORY_LABEL).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fournisseur">
            <input value={value.supplier} onChange={(event) => set('supplier', event.target.value)} />
          </Field>
          <Field label="Montant HT">
            <input type="number" step={0.01} value={value.amountHT} onChange={(event) => set('amountHT', Number(event.target.value))} />
          </Field>
          <Field label="TVA (%)" hint={`TTC : ${money(value.amountHT * (1 + value.vatRate / 100))}`}>
            <select value={value.vatRate} onChange={(event) => set('vatRate', Number(event.target.value))}>
              {db.settings.vatRates.map((rate) => (
                <option key={rate} value={rate}>
                  {rate} %
                </option>
              ))}
            </select>
          </Field>
          <Field label="Projet imputé">
            <select value={value.projectId ?? ''} onChange={(event) => set('projectId', event.target.value || null)}>
              <option value="">— aucun —</option>
              {db.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Charge récurrente">
            <label className="row" style={{ gap: 8, cursor: 'pointer', padding: '7px 0' }}>
              <input type="checkbox" checked={value.recurring} onChange={(event) => set('recurring', event.target.checked)} />
              <span className="small">Se répète chaque mois (loyer, salaires, abonnement)</span>
            </label>
          </Field>
        </div>
      </Modal>

      {confirmDelete ? (
        <ConfirmDialog
          title="Supprimer cette charge ?"
          message="Elle sera retirée du compte de résultat et de la TVA déductible."
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            update((draft) => {
              draft.expenses = draft.expenses.filter((expense) => expense.id !== value.id);
            });
            toast('Charge supprimée.', 'alerte');
            setConfirmDelete(false);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
