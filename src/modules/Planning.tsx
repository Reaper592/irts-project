import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { useNav } from '../core/nav';
import { availability, reservationsFrom, utilisationRate } from '../core/calc';
import { addDays, addMonths, daysBetween, formatDate, monthKey, num, parseISO, pct, toISO, today } from '../core/utils';
import { Badge, Card, EmptyState, PageHeader, Segmented, Tabs } from '../ui/kit';
import { StatTile, seriesColor } from '../ui/charts';
import { EntityChip } from '../ui/shared';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

interface CalendarEvent {
  id: string;
  label: string;
  start: string;
  end: string;
  color: string;
  kind: 'projet' | 'document' | 'mission';
  link?: { view: 'projets' | 'devis' | 'factures'; id: string };
}

export default function Planning() {
  const { db, visible, companyOf } = useStore();
  const { go } = useNav();
  const [tab, setTab] = useState('calendrier');
  const [cursor, setCursor] = useState(monthKey(today()));
  const [range, setRange] = useState({ start: today(), end: addDays(today(), 14) });
  const [filter, setFilter] = useState<'tout' | 'projet' | 'document'>('tout');

  const events = useMemo<CalendarEvent[]>(() => {
    const list: CalendarEvent[] = [];
    for (const project of visible(db.projects)) {
      if (project.status === 'annule') continue;
      list.push({
        id: project.id,
        label: project.name,
        start: project.start,
        end: project.end,
        color: companyOf(project.entity).accent,
        kind: 'projet',
        link: { view: 'projets', id: project.id },
      });
    }
    for (const doc of visible(db.docs)) {
      if (!['accepte', 'envoye', 'partiel', 'paye'].includes(doc.status)) continue;
      if (!doc.eventStart || doc.eventStart === doc.date) continue;
      list.push({
        id: doc.id,
        label: `${doc.number} — ${doc.title || 'Exploitation'}`,
        start: doc.eventStart,
        end: doc.eventEnd,
        color: seriesColor(doc.kind === 'devis' ? 3 : 2),
        kind: 'document',
        link: { view: doc.kind === 'devis' ? 'devis' : 'factures', id: doc.id },
      });
    }
    return list.filter((event) => (filter === 'tout' ? true : event.kind === filter));
  }, [db, visible, companyOf, filter]);

  const grid = useMemo(() => {
    const [year, month] = cursor.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const offset = (first.getDay() + 6) % 7;
    const cells: { date: string; inMonth: boolean }[] = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(year, month - 1, 1 - offset + index);
      cells.push({ date: toISO(date), inMonth: date.getMonth() === month - 1 });
    }
    return cells;
  }, [cursor]);

  const reservations = useMemo(() => reservationsFrom(db.docs), [db.docs]);
  const parkProducts = useMemo(
    () => visible(db.products).filter((product) => product.mode === 'location' && product.stock > 0),
    [db.products, visible],
  );

  const availabilityRows = useMemo(
    () =>
      parkProducts
        .map((product) => ({ product, stock: availability(product, reservations, range.start, range.end) }))
        .sort((a, b) => a.stock.free / Math.max(1, a.stock.total) - b.stock.free / Math.max(1, b.stock.total)),
    [parkProducts, reservations, range],
  );

  const utilisation = utilisationRate(parkProducts, reservations, range.start, range.end);

  const ganttProjects = useMemo(() => {
    const list = visible(db.projects)
      .filter((project) => project.status !== 'annule')
      .sort((a, b) => a.start.localeCompare(b.start));
    if (!list.length) return { list, from: today(), to: addDays(today(), 30), span: 30 };
    const from = list.reduce((min, project) => (project.start < min ? project.start : min), list[0].start);
    const to = list.reduce((max, project) => (project.end > max ? project.end : max), list[0].end);
    return { list, from, to, span: Math.max(1, daysBetween(from, to)) };
  }, [db.projects, visible]);

  const monthLabelText = parseISO(`${cursor}-01`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  return (
    <div className="view">
      <PageHeader
        title="Planning & disponibilités"
        subtitle="Exploitations engagées, missions des équipes et état du parc sur la période"
        actions={
          <Segmented
            value={filter}
            options={[
              { value: 'tout', label: 'Tout' },
              { value: 'projet', label: 'Projets' },
              { value: 'document', label: 'Locations' },
            ]}
            onChange={(value) => setFilter(value as typeof filter)}
          />
        }
      />

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <StatTile label="Événements planifiés" value={String(events.length)} deltaLabel="Projets et exploitations" />
        <StatTile label="Occupation du parc" value={pct(utilisation, 0)} deltaLabel={`${formatDate(range.start)} → ${formatDate(range.end)}`} />
        <StatTile
          label="Références en tension"
          value={String(availabilityRows.filter((row) => row.stock.free <= 0).length)}
          deltaLabel="Aucune unité disponible"
        />
        <StatTile
          label="Matériel immobilisé"
          value={String(availabilityRows.reduce((acc, row) => acc + row.stock.outOfOrder, 0))}
          deltaLabel="Maintenance ou hors service"
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'calendrier', label: 'Calendrier' },
          { id: 'gantt', label: 'Vue projets' },
          { id: 'parc', label: 'Disponibilité du parc' },
        ]}
      />

      {tab === 'calendrier' ? (
        <Card
          title={monthLabelText.charAt(0).toUpperCase() + monthLabelText.slice(1)}
          actions={
            <>
              <button type="button" className="btn btn-sm" onClick={() => setCursor(monthKey(addMonths(`${cursor}-01`, -1)))}>
                ←
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setCursor(monthKey(today()))}>
                Aujourd’hui
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setCursor(monthKey(addMonths(`${cursor}-01`, 1)))}>
                →
              </button>
            </>
          }
        >
          <div className="calendar" style={{ marginBottom: 4 }}>
            {WEEKDAYS.map((day) => (
              <div className="cal-head" key={day}>
                {day}
              </div>
            ))}
          </div>
          <div className="calendar">
            {grid.map((cell) => {
              // Les evenements qui commencent ce jour-la passent devant : sinon les
              // longs chantiers occupent toutes les places et masquent les dates cles.
              const dayEvents = events
                .filter((event) => event.start <= cell.date && cell.date <= event.end)
                .sort(
                  (a, b) =>
                    Number(b.start === cell.date) - Number(a.start === cell.date) ||
                    a.start.localeCompare(b.start),
                );
              return (
                <div
                  key={cell.date}
                  className={`cal-cell${cell.inMonth ? '' : ' out'}${cell.date === today() ? ' today' : ''}`}
                >
                  <span className="cal-day">{cell.date.slice(8)}</span>
                  {dayEvents.slice(0, 3).map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className="cal-ev"
                      style={{ background: event.color, border: 0, textAlign: 'left', font: 'inherit' }}
                      title={`${event.label} — ${formatDate(event.start)} → ${formatDate(event.end)}`}
                      onClick={() => event.link && go(event.link.view, event.link.id)}
                    >
                      {event.label}
                    </button>
                  ))}
                  {dayEvents.length > 3 ? <span className="small dim">+{dayEvents.length - 3}</span> : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {tab === 'gantt' ? (
        <Card title="Chronologie des projets" subtitle={`${formatDate(ganttProjects.from)} → ${formatDate(ganttProjects.to)}`}>
          {ganttProjects.list.length ? (
            <div className="stack-sm">
              {ganttProjects.list.map((project) => {
                const offset = daysBetween(ganttProjects.from, project.start) / ganttProjects.span;
                const width = Math.max(0.012, (daysBetween(project.start, project.end) + 1) / ganttProjects.span);
                const staff = db.assignments.filter((entry) => entry.projectId === project.id);
                return (
                  <div className="gantt-row" key={project.id}>
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <EntityChip entity={project.entity} />
                      <button type="button" className="link-btn truncate" onClick={() => go('projets', project.id)}>
                        {project.name}
                      </button>
                    </div>
                    <div className="gantt-track">
                      <div
                        className="gantt-bar"
                        style={{
                          left: `${offset * 100}%`,
                          width: `${width * 100}%`,
                          background: companyOf(project.entity).accent,
                        }}
                        title={`${formatDate(project.start)} → ${formatDate(project.end)} · ${staff.length} personne(s)`}
                        onClick={() => go('projets', project.id)}
                      >
                        {formatDate(project.start)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState mark="📅" title="Aucun projet planifié" />
          )}
        </Card>
      ) : null}

      {tab === 'parc' ? (
        <Card
          title="Disponibilité du parc"
          subtitle="Quantités libres après déduction des engagements et du matériel immobilisé"
          flush
          actions={
            <>
              <input type="date" value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} style={{ width: 148 }} />
              <input type="date" value={range.end} onChange={(event) => setRange({ ...range, end: event.target.value })} style={{ width: 148 }} />
            </>
          }
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Catégorie</th>
                  <th className="num">Parc</th>
                  <th className="num">Immobilisé</th>
                  <th className="num">Réservé</th>
                  <th className="num">Disponible</th>
                  <th style={{ width: 160 }}>Charge</th>
                </tr>
              </thead>
              <tbody>
                {availabilityRows.map((row) => {
                  const load = row.stock.total ? row.stock.reserved / row.stock.total : 0;
                  return (
                    <tr key={row.product.id}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span>{row.product.mark}</span>
                          <span className="truncate">{row.product.name}</span>
                        </div>
                      </td>
                      <td className="small muted">{row.product.category}</td>
                      <td className="num tnum">{row.product.stock}</td>
                      <td className="num tnum">{row.stock.outOfOrder || '—'}</td>
                      <td className="num tnum">{row.stock.reserved}</td>
                      <td className="num">
                        <Badge tone={row.stock.free <= 0 ? 'critical' : row.stock.free < row.stock.total * 0.25 ? 'warning' : 'good'} icon={row.stock.free <= 0 ? '⚠' : '✔'}>
                          {row.stock.free}
                        </Badge>
                      </td>
                      <td>
                        <div className="meter">
                          <span
                            style={{
                              width: `${Math.min(100, load * 100)}%`,
                              background: load >= 1 ? 'var(--critical)' : load > 0.75 ? 'var(--warning)' : 'var(--accent)',
                            }}
                          />
                        </div>
                        <span className="small dim tnum">{num(load * 100, 0)} %</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
