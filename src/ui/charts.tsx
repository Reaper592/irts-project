/**
 * Composants de data-visualisation.
 *
 * Regles appliquees : palette categorielle a ordre fixe (jamais cyclee),
 * un seul axe de valeurs, marques fines, ecart de 2 px en couleur de surface
 * entre segments jointifs, anneau de surface sur les points, legende des que
 * deux series sont tracees, etiquettes directes parcimonieuses, et couche de
 * survol par defaut. Le texte porte des jetons d'encre, jamais la couleur de
 * la serie.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { compact, money, num } from '../core/utils';

export const SERIES = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];

const SURFACE = '#151a21';
const GRID = '#232b36';
const AXIS = '#313b48';
const INK_MUTED = '#8592a3';
const INK_SECOND = '#b9c3d0';

export function seriesColor(index: number): string {
  return SERIES[index] ?? SERIES[SERIES.length - 1];
}

/* --------------------------------------------------------------- mesures */

function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Graduations « rondes » couvrant [0, max]. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translate(-50%, -110%)',
        background: '#222a35',
        border: '1px solid #384454',
        borderRadius: 8,
        padding: '7px 10px',
        fontSize: 11.5,
        color: INK_SECOND,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        zIndex: 5,
      }}
    >
      {children}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="legend" style={{ marginTop: 10 }}>
      {items.map((item) => (
        <span className="legend-item" key={item.label}>
          <span className={`legend-key${item.line ? ' line' : ''}`} style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- tuile de KPI */

export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  upIsGood = true,
  trend,
  hero,
  foot,
}: {
  label: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  upIsGood?: boolean;
  trend?: number[];
  hero?: boolean;
  foot?: ReactNode;
}) {
  const direction = delta === undefined ? 0 : delta > 0.0001 ? 1 : delta < -0.0001 ? -1 : 0;
  const good = direction === 0 ? null : (direction > 0) === upIsGood;
  const deltaClass = good === null ? 'delta-flat' : good ? 'delta-up' : 'delta-down';
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className={hero ? 'tile-hero' : 'tile-value'}>{value}</span>
      <div className="tile-foot">
        {delta !== undefined ? (
          <span className={`delta ${deltaClass}`}>
            <span aria-hidden="true">{direction > 0 ? '▲' : direction < 0 ? '▼' : '▬'}</span>
            {`${delta > 0 ? '+' : ''}${num(delta * 100, 1)} %`}
          </span>
        ) : null}
        {deltaLabel ? <span>{deltaLabel}</span> : null}
        {foot}
        {trend && trend.length > 1 ? <Sparkline values={trend} /> : null}
      </div>
    </div>
  );
}

export function Sparkline({ values, width = 78, height = 20 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / Math.max(1, values.length - 1);
  const path = values
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${index * step} ${height - ((value - min) / span) * height}`)
    .join(' ');
  const lastX = (values.length - 1) * step;
  const lastY = height - ((values[values.length - 1] - min) / span) * height;
  return (
    <svg width={width} height={height} style={{ marginLeft: 'auto', overflow: 'visible' }} aria-hidden="true">
      <path d={path} fill="none" stroke="#3a4756" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={3} fill={SERIES[0]} stroke={SURFACE} strokeWidth={2} />
    </svg>
  );
}

/* ------------------------------------------------------- colonnes / barres */

export interface ColumnSeries {
  label: string;
  values: number[];
}

export function ColumnChart({
  categories,
  series,
  height = 240,
  stacked = false,
  format = compact,
  labelLast = false,
}: {
  categories: string[];
  series: ColumnSeries[];
  height?: number;
  stacked?: boolean;
  format?: (value: number) => string;
  /** Etiquette directe sur la derniere colonne uniquement. */
  labelLast?: boolean;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 14, right: 12, bottom: 26, left: 52 };
  const plotW = Math.max(60, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const totals = categories.map((_, index) =>
    stacked ? series.reduce((acc, entry) => acc + (entry.values[index] ?? 0), 0) : Math.max(...series.map((entry) => entry.values[index] ?? 0)),
  );
  const max = Math.max(...totals, 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (value: number) => pad.top + plotH - (value / top) * plotH;

  const band = plotW / Math.max(1, categories.length);
  const barSlot = band * 0.62;
  const barW = stacked ? Math.min(24, barSlot) : Math.min(24, barSlot / series.length);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width="100%" height={height} role="img" aria-label="Graphique en colonnes">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={pad.left + plotW} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? AXIS : GRID} strokeWidth={1} />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={10.5} fill={INK_MUTED} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {format(tick)}
            </text>
          </g>
        ))}

        {categories.map((category, index) => {
          const cx = pad.left + band * index + band / 2;
          let stackTop = pad.top + plotH;
          return (
            <g
              key={category}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={pad.left + band * index} y={pad.top} width={band} height={plotH} fill={hover === index ? 'rgba(255,255,255,0.03)' : 'transparent'} />
              {series.map((entry, sIndex) => {
                const value = entry.values[index] ?? 0;
                const h = Math.max(0, (value / top) * plotH);
                if (stacked) {
                  // Un ecart de 2 px en couleur de surface separe les segments jointifs.
                  const gap = sIndex === 0 ? 0 : 2;
                  const barH = Math.max(0, h - gap);
                  stackTop -= h;
                  return (
                    <rect
                      key={entry.label}
                      x={cx - barW / 2}
                      y={stackTop + gap}
                      width={barW}
                      height={barH}
                      rx={sIndex === series.length - 1 ? 4 : 0}
                      fill={seriesColor(sIndex)}
                    />
                  );
                }
                const groupW = barW * series.length + 2 * (series.length - 1);
                const x = cx - groupW / 2 + sIndex * (barW + 2);
                return (
                  <rect key={entry.label} x={x} y={y(value)} width={barW} height={h} rx={4} fill={seriesColor(sIndex)} />
                );
              })}
              {labelLast && index === categories.length - 1 ? (
                <text x={cx} y={y(totals[index]) - 7} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK_SECOND}>
                  {format(totals[index])}
                </text>
              ) : null}
              <text x={cx} y={height - 8} textAnchor="middle" fontSize={10.5} fill={INK_MUTED}>
                {category}
              </text>
            </g>
          );
        })}
      </svg>

      {hover !== null ? (
        <Tooltip x={pad.left + band * hover + band / 2} y={y(totals[hover])}>
          <div style={{ color: '#f2f5f8', fontWeight: 600, marginBottom: 3 }}>{categories[hover]}</div>
          {series.map((entry, index) => (
            <div key={entry.label} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: seriesColor(index) }} />
              <span>{entry.label}</span>
              <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: '#f2f5f8' }}>
                {money(entry.values[hover] ?? 0)}
              </span>
            </div>
          ))}
        </Tooltip>
      ) : null}

      <Legend items={series.map((entry, index) => ({ label: entry.label, color: seriesColor(index) }))} />
    </div>
  );
}

/* ------------------------------------------------------------- courbes */

export function LineChart({
  categories,
  series,
  height = 250,
  format = compact,
  area = false,
}: {
  categories: string[];
  series: ColumnSeries[];
  height?: number;
  format?: (value: number) => string;
  area?: boolean;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 16, right: series.length <= 4 ? 58 : 14, bottom: 26, left: 54 };
  const plotW = Math.max(60, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const max = Math.max(1, ...series.flatMap((entry) => entry.values));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const step = plotW / Math.max(1, categories.length - 1);
  const x = (index: number) => pad.left + index * step;
  const y = (value: number) => pad.top + plotH - (value / top) * plotH;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        width="100%"
        height={height}
        role="img"
        aria-label="Graphique en courbes"
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const index = Math.round((event.clientX - box.left - pad.left) / step);
          setHover(index >= 0 && index < categories.length ? index : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={pad.left + plotW} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? AXIS : GRID} />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={10.5} fill={INK_MUTED} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {format(tick)}
            </text>
          </g>
        ))}

        {hover !== null ? (
          <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} stroke={AXIS} strokeWidth={1} />
        ) : null}

        {series.map((entry, sIndex) => {
          const color = seriesColor(sIndex);
          const path = entry.values
            .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index)} ${y(value)}`)
            .join(' ');
          return (
            <g key={entry.label}>
              {area ? (
                <path
                  d={`${path} L${x(entry.values.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`}
                  fill={color}
                  opacity={0.1}
                />
              ) : null}
              <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle
                cx={x(entry.values.length - 1)}
                cy={y(entry.values[entry.values.length - 1] ?? 0)}
                r={4}
                fill={color}
                stroke={SURFACE}
                strokeWidth={2}
              />
              {series.length <= 4 ? (
                <text
                  x={x(entry.values.length - 1) + 9}
                  y={y(entry.values[entry.values.length - 1] ?? 0) + 4}
                  fontSize={10.5}
                  fill={INK_SECOND}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {format(entry.values[entry.values.length - 1] ?? 0)}
                </text>
              ) : null}
              {hover !== null ? (
                <circle cx={x(hover)} cy={y(entry.values[hover] ?? 0)} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />
              ) : null}
            </g>
          );
        })}

        {categories.map((category, index) =>
          index % Math.ceil(categories.length / 12) === 0 ? (
            <text key={category} x={x(index)} y={height - 8} textAnchor="middle" fontSize={10.5} fill={INK_MUTED}>
              {category}
            </text>
          ) : null,
        )}
      </svg>

      {hover !== null ? (
        <Tooltip x={x(hover)} y={pad.top}>
          <div style={{ color: '#f2f5f8', fontWeight: 600, marginBottom: 3 }}>{categories[hover]}</div>
          {series.map((entry, index) => (
            <div key={entry.label} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2, borderRadius: 2, background: seriesColor(index) }} />
              <span>{entry.label}</span>
              <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: '#f2f5f8' }}>
                {money(entry.values[hover] ?? 0)}
              </span>
            </div>
          ))}
        </Tooltip>
      ) : null}

      <Legend items={series.map((entry, index) => ({ label: entry.label, color: seriesColor(index), line: true }))} />
    </div>
  );
}

/* ---------------------------------------------------------------- donut */

export function DonutChart({
  parts,
  size = 168,
  centerLabel,
  centerValue,
  format = compact,
}: {
  parts: { label: string; value: number }[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
  format?: (value: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = parts.reduce((acc, part) => acc + part.value, 0);
  const radius = size / 2 - 4;
  const inner = radius * 0.62;
  const cx = size / 2;
  const cy = size / 2;

  let angle = -Math.PI / 2;
  const arcs = parts.map((part, index) => {
    const share = total ? part.value / total : 0;
    // Un ecart de 2 px en couleur de surface separe les segments jointifs.
    const gapAngle = total && parts.length > 1 ? 2 / radius : 0;
    const start = angle + gapAngle / 2;
    const end = angle + share * Math.PI * 2 - gapAngle / 2;
    angle += share * Math.PI * 2;
    const large = end - start > Math.PI ? 1 : 0;
    const path = [
      `M${cx + Math.cos(start) * radius} ${cy + Math.sin(start) * radius}`,
      `A${radius} ${radius} 0 ${large} 1 ${cx + Math.cos(end) * radius} ${cy + Math.sin(end) * radius}`,
      `L${cx + Math.cos(end) * inner} ${cy + Math.sin(end) * inner}`,
      `A${inner} ${inner} 0 ${large} 0 ${cx + Math.cos(start) * inner} ${cy + Math.sin(start) * inner}`,
      'Z',
    ].join(' ');
    return { path, color: seriesColor(index), part, share };
  });

  return (
    <div className="row" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} role="img" aria-label="Répartition">
        {arcs.map((arc, index) => (
          <path
            key={arc.part.label}
            d={arc.path}
            fill={arc.color}
            opacity={hover === null || hover === index ? 1 : 0.42}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {centerValue ? (
          <>
            <text x={cx} y={cy - 2} textAnchor="middle" fontSize={17} fontWeight={650} fill="#f2f5f8">
              {centerValue}
            </text>
            <text x={cx} y={cy + 15} textAnchor="middle" fontSize={10.5} fill={INK_MUTED}>
              {centerLabel}
            </text>
          </>
        ) : null}
      </svg>
      <div className="stack-sm" style={{ minWidth: 170, flex: 1 }}>
        {arcs.map((arc, index) => (
          <div
            key={arc.part.label}
            className="row"
            style={{ gap: 8, fontSize: 12, opacity: hover === null || hover === index ? 1 : 0.55 }}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="legend-key" style={{ background: arc.color }} />
            <span className="truncate">{arc.part.label}</span>
            <span className="spacer" />
            <span className="tnum muted">{num(arc.share * 100, 0)} %</span>
            <span className="tnum" style={{ minWidth: 68, textAlign: 'right' }}>
              {format(arc.part.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ classement */

export function BarList({
  items,
  format = money,
  colorIndex = 0,
}: {
  items: { label: string; value: number; hint?: string }[];
  format?: (value: number) => string;
  colorIndex?: number;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  const color = seriesColor(colorIndex);
  return (
    <div className="stack-sm">
      {items.map((item) => (
        <div key={item.label} className="stack-sm" style={{ gap: 4 }}>
          <div className="row" style={{ fontSize: 12.5 }}>
            <span className="truncate">{item.label}</span>
            {item.hint ? <span className="small dim">{item.hint}</span> : null}
            <span className="spacer" />
            <span className="tnum">{format(item.value)}</span>
          </div>
          <div style={{ height: 6, background: '#222a35', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(item.value / max) * 100}%`, height: '100%', background: color, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Barre unique empilee : composition d'un total (marge, TVA, categories). */
export function StackedBar({ parts, height = 12 }: { parts: { label: string; value: number }[]; height?: number }) {
  const total = parts.reduce((acc, part) => acc + part.value, 0) || 1;
  return (
    <div style={{ display: 'flex', gap: 2, height, borderRadius: 4, overflow: 'hidden' }}>
      {parts.map((part, index) => (
        <div
          key={part.label}
          title={`${part.label} — ${money(part.value)}`}
          style={{ width: `${(part.value / total) * 100}%`, background: seriesColor(index) }}
        />
      ))}
    </div>
  );
}

export function useChartMemo<T>(factory: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(factory, deps);
}
