import { useMemo } from 'react';
import { useStore } from '../core/store';
import { useNav } from '../core/nav';
import {
  docTotals,
  effectiveStatus,
  monthlyFinance,
  reservationsFrom,
  utilisationRate,
} from '../core/calc';
import {
  addDays,
  addMonths,
  compact,
  formatDate,
  lastMonths,
  money,
  money0,
  monthLabel,
  num,
  pct,
  sum,
  today,
} from '../core/utils';
import { BarList, ColumnChart, DonutChart, LineChart, StatTile } from '../ui/charts';
import { Badge, Card, EmptyState, Meter, PageHeader } from '../ui/kit';
import { DocStatusBadge, EntityChip } from '../ui/shared';
import type { EntityId } from '../core/types';

export default function Dashboard() {
  const { db, scope, visible, companyOf, company } = useStore();
  const { go } = useNav();
  const now = today();

  const data = useMemo(() => {
    const docs = visible(db.docs);
    const products = db.products;
    const expenses = visible(db.expenses);
    const months = lastMonths(12);
    const prevMonths = lastMonths(12, addMonths(now, -12));

    const invoices = docs.filter((doc) => doc.kind !== 'devis' && doc.status !== 'annule');
    const totalsOf = (list: typeof invoices) => sum(list, (doc) => docTotals(doc, products).netHT);

    const revenue12 = totalsOf(invoices.filter((doc) => months.includes(doc.date.slice(0, 7))));
    const revenuePrev = totalsOf(invoices.filter((doc) => prevMonths.includes(doc.date.slice(0, 7))));
    const margin12 = sum(
      invoices.filter((doc) => months.includes(doc.date.slice(0, 7))),
      (doc) => docTotals(doc, products).margin,
    );
    const charges12 = sum(
      expenses.filter((expense) => months.includes(expense.date.slice(0, 7))),
      (expense) => expense.amountHT,
    );

    const outstanding = invoices
      .map((doc) => ({ doc, totals: docTotals(doc, products) }))
      .filter((entry) => entry.totals.balance > 0.5);
    const overdue = outstanding.filter((entry) => entry.doc.dueDate < now);

    const quotes = docs.filter((doc) => doc.kind === 'devis');
    const pendingQuotes = quotes
      .map((doc) => ({ doc, totals: docTotals(doc, products) }))
      .filter((entry) => ['envoye', 'brouillon'].includes(entry.doc.status));
    const wonQuotes = quotes.filter((doc) => doc.status === 'accepte').length;
    const decidedQuotes = quotes.filter((doc) => ['accepte', 'refuse', 'expire'].includes(doc.status)).length;

    const deals = visible(db.deals).filter((deal) => !['gagne', 'perdu'].includes(deal.stage));
    const pipeline = sum(deals, (deal) => deal.value);
    const weighted = sum(deals, (deal) => (deal.value * deal.probability) / 100);

    const reservations = reservationsFrom(docs);
    const parkProducts = products.filter(
      (product) => product.mode === 'location' && (scope === 'groupe' || product.entity === scope),
    );
    const utilisation = utilisationRate(parkProducts, reservations, addDays(now, -30), now);
    const utilisationNext = utilisationRate(parkProducts, reservations, now, addDays(now, 30));

    const cash = monthlyFinance(invoices, expenses, products, months);

    const byEntity: Record<string, number[]> = {};
    for (const entity of ['maree-sonore', 'msr', 'owlaris'] as EntityId[]) {
      if (scope !== 'groupe' && scope !== entity) continue;
      byEntity[entity] = months.map((month) =>
        totalsOf(invoices.filter((doc) => doc.entity === entity && doc.date.startsWith(month))),
      );
    }

    const clientRevenue = new Map<string, number>();
    for (const doc of invoices.filter((entry) => months.includes(entry.date.slice(0, 7)))) {
      clientRevenue.set(doc.clientId, (clientRevenue.get(doc.clientId) ?? 0) + docTotals(doc, products).netHT);
    }
    const topClients = [...clientRevenue.entries()]
      .map(([id, value]) => ({
        label: db.clients.find((client) => client.id === id)?.name ?? 'Client supprimé',
        value,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    // Les categories du catalogue sont fines (« Son — regie ») : on les regroupe
    // par famille pour que la repartition reste lisible sur une seule couronne.
    const categoryRevenue = new Map<string, number>();
    for (const doc of invoices.filter((entry) => months.includes(entry.date.slice(0, 7)))) {
      for (const line of doc.lines) {
        const product = products.find((entry) => entry.id === line.productId);
        const key = (product?.category ?? 'Divers').split('—')[0].trim();
        categoryRevenue.set(key, (categoryRevenue.get(key) ?? 0) + line.qty * line.unitPrice * line.days);
      }
    }
    const categories = [...categoryRevenue.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    const topCategories = categories.slice(0, 6);
    const otherCategories = categories.slice(6);
    if (otherCategories.length) {
      topCategories.push({ label: 'Autres', value: sum(otherCategories, (entry) => entry.value) });
    }

    const upcoming = [...visible(db.projects)]
      .filter((project) => project.end >= now && project.status !== 'annule')
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 5);

    const tasks = visible(db.tasks)
      .filter((task) => !task.done)
      .sort((a, b) => a.due.localeCompare(b.due))
      .slice(0, 6);

    const conflicts: { productName: string; period: string; need: number; stock: number }[] = [];
    for (const product of parkProducts) {
      const windows = reservations.filter((entry) => entry.productId === product.id && entry.end >= now);
      for (const window of windows) {
        const need = windows
          .filter((other) => other.start <= window.end && window.start <= other.end)
          .reduce((acc, other) => acc + other.qty, 0);
        const available =
          product.stock - product.serials.filter((serial) => serial.state !== 'ok').length;
        if (need > available && !conflicts.some((entry) => entry.productName === product.name)) {
          conflicts.push({
            productName: product.name,
            period: `${formatDate(window.start)} → ${formatDate(window.end)}`,
            need,
            stock: available,
          });
        }
      }
    }

    const target = (Object.keys(byEntity) as EntityId[]).reduce(
      (acc, entity) => acc + (db.settings.revenueTargets[entity] ?? 0),
      0,
    );

    return {
      months,
      revenue12,
      revenuePrev,
      margin12,
      charges12,
      outstanding,
      overdue,
      pendingQuotes,
      winRate: decidedQuotes ? wonQuotes / decidedQuotes : 0,
      pipeline,
      weighted,
      utilisation,
      utilisationNext,
      cash,
      byEntity,
      topClients,
      topCategories,
      upcoming,
      tasks,
      conflicts,
      target,
      openTickets: visible(db.tickets).filter((ticket) => ticket.status !== 'clos'),
    };
  }, [db, scope, visible, now]);

  const growth = data.revenuePrev ? (data.revenue12 - data.revenuePrev) / data.revenuePrev : 0;
  const scopeName = company ? company.name : 'Groupe IRTS';

  return (
    <div className="view">
      <PageHeader
        title="Pilotage"
        subtitle={`${scopeName} — vue consolidée sur les 12 derniers mois glissants`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => go('devis')}>
              Nouveau devis
            </button>
            <button type="button" className="btn btn-primary" onClick={() => go('studio')}>
              Ouvrir le Studio 3D
            </button>
          </>
        }
      />

      <div className="stack">
        {/* Chiffre d'affaires : un seul chiffre heros par vue. */}
        <div className="grid g-3-2">
          <div className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="stack-sm" style={{ gap: 4 }}>
                <span className="tile-label">Chiffre d’affaires HT — 12 derniers mois</span>
                <span className="tile-hero">{money0(data.revenue12)}</span>
                <div className="tile-foot">
                  <span className={`delta ${growth >= 0 ? 'delta-up' : 'delta-down'}`}>
                    <span aria-hidden="true">{growth >= 0 ? '▲' : '▼'}</span>
                    {`${growth > 0 ? '+' : ''}${num(growth * 100, 1)} %`}
                  </span>
                  <span>vs les 12 mois précédents ({money0(data.revenuePrev)})</span>
                </div>
              </div>
              <div className="spacer" />
              <div style={{ minWidth: 190 }}>
                <div className="row small muted" style={{ marginBottom: 6 }}>
                  <span>Objectif annuel</span>
                  <span className="spacer" />
                  <span className="tnum">{money0(data.target)}</span>
                </div>
                <Meter value={data.target ? data.revenue12 / data.target : 0} />
                <div className="small dim" style={{ marginTop: 5 }}>
                  {pct(data.target ? data.revenue12 / data.target : 0, 0)} de l’objectif atteint
                </div>
              </div>
            </div>
            <hr className="hr" />
            <ColumnChart
              categories={data.months.map(monthLabel)}
              stacked
              series={Object.entries(data.byEntity).map(([entity, values]) => ({
                label: companyOf(entity as EntityId).name,
                values,
              }))}
              height={216}
            />
          </div>

          <Card title="Répartition du chiffre d’affaires" subtitle="Par famille de prestation, 12 mois">
            <DonutChart
              parts={data.topCategories}
              centerLabel="HT sur 12 mois"
              centerValue={compact(data.revenue12)}
            />
          </Card>
        </div>

        <div className="grid g4">
          <StatTile
            label="Marge brute 12 mois"
            value={money0(data.margin12)}
            deltaLabel={`${pct(data.revenue12 ? data.margin12 / data.revenue12 : 0, 0)} du CA`}
            trend={data.cash.map((row) => row.revenue - row.charges)}
          />
          <StatTile
            label="Encours client"
            value={money0(sum(data.outstanding, (entry) => entry.totals.balance))}
            deltaLabel={`${data.overdue.length} facture(s) en retard`}
            foot={
              data.overdue.length ? (
                <Badge tone="critical" icon="⚠">
                  {money0(sum(data.overdue, (entry) => entry.totals.balance))} en retard
                </Badge>
              ) : (
                <Badge tone="good" icon="✔">
                  Aucun retard
                </Badge>
              )
            }
          />
          <StatTile
            label="Pipeline pondéré"
            value={money0(data.weighted)}
            deltaLabel={`${money0(data.pipeline)} de potentiel brut`}
          />
          <StatTile
            label="Taux de transformation des devis"
            value={pct(data.winRate, 0)}
            deltaLabel={`${data.pendingQuotes.length} devis en attente`}
          />
        </div>

        <div className="grid g-2-1">
          <Card
            title="Chiffre d’affaires, encaissements et charges"
            subtitle="Trois séries mensuelles sur un axe unique, en euros HT"
          >
            <LineChart
              categories={data.cash.map((row) => monthLabel(row.month))}
              series={[
                { label: 'CA facturé', values: data.cash.map((row) => row.revenue) },
                { label: 'Encaissé', values: data.cash.map((row) => row.encaisse) },
                { label: 'Charges', values: data.cash.map((row) => row.charges) },
              ]}
              height={250}
            />
          </Card>

          <Card title="Meilleurs clients" subtitle="Chiffre d’affaires HT sur 12 mois">
            {data.topClients.length ? (
              <BarList items={data.topClients} />
            ) : (
              <EmptyState mark="👥" title="Aucune facture sur la période" />
            )}
          </Card>
        </div>

        <div className="grid g3">
          <Card
            title="Factures à recouvrer"
            subtitle={`${data.outstanding.length} document(s)`}
            actions={
              <button type="button" className="btn btn-sm" onClick={() => go('factures')}>
                Tout voir
              </button>
            }
          >
            {data.outstanding.length ? (
              <div className="stack-sm">
                {data.outstanding
                  .sort((a, b) => a.doc.dueDate.localeCompare(b.doc.dueDate))
                  .slice(0, 6)
                  .map((entry) => (
                    <button
                      key={entry.doc.id}
                      type="button"
                      className="row"
                      style={{
                        gap: 10,
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
                      onClick={() => go('factures', entry.doc.id)}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="truncate" style={{ fontSize: 12.5 }}>
                          {db.clients.find((client) => client.id === entry.doc.clientId)?.name ?? '—'}
                        </div>
                        <div className="small dim">
                          {entry.doc.number} · échéance {formatDate(entry.doc.dueDate)}
                        </div>
                      </div>
                      <div className="right">
                        <div className="tnum" style={{ fontSize: 12.5 }}>
                          {money(entry.totals.balance)}
                        </div>
                        <DocStatusBadge status={effectiveStatus(entry.doc, entry.totals)} />
                      </div>
                    </button>
                  ))}
              </div>
            ) : (
              <EmptyState mark="✔" title="Tout est encaissé" hint="Aucun encours client à ce jour." />
            )}
          </Card>

          <Card
            title="Devis en attente de décision"
            subtitle={`${money0(sum(data.pendingQuotes, (entry) => entry.totals.totalTTC))} en jeu`}
            actions={
              <button type="button" className="btn btn-sm" onClick={() => go('devis')}>
                Tout voir
              </button>
            }
          >
            {data.pendingQuotes.length ? (
              <div className="stack-sm">
                {data.pendingQuotes.slice(0, 6).map((entry) => (
                  <button
                    key={entry.doc.id}
                    type="button"
                    className="row"
                    style={{
                      gap: 10,
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
                    onClick={() => go('devis', entry.doc.id)}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="truncate" style={{ fontSize: 12.5 }}>
                        {entry.doc.title || entry.doc.number}
                      </div>
                      <div className="small dim">
                        {entry.doc.number} · valable jusqu’au {formatDate(entry.doc.dueDate)}
                      </div>
                    </div>
                    <div className="right">
                      <div className="tnum" style={{ fontSize: 12.5 }}>
                        {money(entry.totals.totalTTC)}
                      </div>
                      <DocStatusBadge status={effectiveStatus(entry.doc, entry.totals)} />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState mark="📄" title="Aucun devis en attente" />
            )}
          </Card>

          <Card title="À faire cette semaine" subtitle={`${data.tasks.length} action(s) ouverte(s)`}>
            {data.tasks.length ? (
              <div className="stack-sm">
                {data.tasks.map((task) => (
                  <div key={task.id} className="row" style={{ gap: 9, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
                    <Badge
                      tone={task.priority === 'haute' ? 'critical' : task.priority === 'normale' ? 'info' : 'neutre'}
                      icon={task.priority === 'haute' ? '⚑' : '•'}
                    >
                      {formatDate(task.due)}
                    </Badge>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="truncate" style={{ fontSize: 12.5 }}>
                        {task.label}
                      </div>
                      <div className="small dim truncate">{task.owner}</div>
                    </div>
                    <EntityChip entity={task.entity} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState mark="✔" title="Rien d’urgent" />
            )}
          </Card>
        </div>

        <div className="grid g3">
          <Card title="Occupation du parc" subtitle="Jours-unités engagés rapportés à la capacité">
            <div className="stack">
              <div>
                <div className="row small muted">
                  <span>30 derniers jours</span>
                  <span className="spacer" />
                  <span className="tnum">{pct(data.utilisation, 0)}</span>
                </div>
                <Meter value={data.utilisation} />
              </div>
              <div>
                <div className="row small muted">
                  <span>30 prochains jours (réservé)</span>
                  <span className="spacer" />
                  <span className="tnum">{pct(data.utilisationNext, 0)}</span>
                </div>
                <Meter value={data.utilisationNext} tone="var(--series-3)" />
              </div>
              <div className="small dim">
                Un taux durablement supérieur à 60 % signale un parc à renforcer ; sous 25 %, du matériel
                immobilisé à sous-louer ou à céder.
              </div>
            </div>
          </Card>

          <Card
            title="Alertes de disponibilité"
            subtitle="Sur-réservation détectée sur la période à venir"
            actions={
              <button type="button" className="btn btn-sm" onClick={() => go('planning')}>
                Planning
              </button>
            }
          >
            {data.conflicts.length ? (
              <div className="stack-sm">
                {data.conflicts.slice(0, 5).map((conflict) => (
                  <div key={conflict.productName} className="row" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
                    <Badge tone="critical" icon="⚠">
                      {conflict.need} / {conflict.stock}
                    </Badge>
                    <div style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: 12.5 }}>
                        {conflict.productName}
                      </div>
                      <div className="small dim">{conflict.period}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState mark="✔" title="Aucun conflit de réservation" hint="Le parc couvre les engagements en cours." />
            )}
          </Card>

          <Card
            title="Prochains événements"
            actions={
              <button type="button" className="btn btn-sm" onClick={() => go('projets')}>
                Projets
              </button>
            }
          >
            {data.upcoming.length ? (
              <div className="stack-sm">
                {data.upcoming.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="row"
                    style={{
                      gap: 9,
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
                    onClick={() => go('projets', project.id)}
                  >
                    <EntityChip entity={project.entity} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="truncate" style={{ fontSize: 12.5 }}>
                        {project.name}
                      </div>
                      <div className="small dim">
                        {formatDate(project.start)} · {project.venue}
                      </div>
                    </div>
                    <span className="small tnum muted">{money0(project.budget)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState mark="📅" title="Aucun événement planifié" />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
