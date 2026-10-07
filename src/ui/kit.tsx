import { useEffect, useMemo, useState, type ReactNode } from 'react';

/* ------------------------------------------------------------------ modale */

export function Modal({
  title,
  subtitle,
  size = 'md',
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  size?: 'md' | 'lg' | 'xl';
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : size === 'xl' ? 'modal-xl' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <div className="small muted">{subtitle}</div> : null}
          </div>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmer',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        {message}
      </p>
    </Modal>
  );
}

/* --------------------------------------------------------------- champs */

export function Field({
  label,
  hint,
  children,
  span,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  span?: number;
}) {
  return (
    <div className="field" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function FormGrid({ cols = 2, children }: { cols?: number; children: ReactNode }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 12 }}>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {typeof tab.count === 'number' ? <span className="dim"> · {tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- badges */

export type Tone = 'neutre' | 'good' | 'warning' | 'serious' | 'critical' | 'info' | 'accent';

const TONE_CLASS: Record<Tone, string> = {
  neutre: '',
  good: 'badge-good',
  warning: 'badge-warning',
  serious: 'badge-serious',
  critical: 'badge-critical',
  info: 'badge-info',
  accent: 'badge-accent',
};

/** Un statut ne repose jamais sur la couleur seule : icone + libelle systematiques. */
export function Badge({ tone = 'neutre', icon, children }: { tone?: Tone; icon?: string; children: ReactNode }) {
  return (
    <span className={`badge ${TONE_CLASS[tone]}`}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}

export function EmptyState({ mark, title, hint, action }: { mark: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        {mark}
      </div>
      <strong style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{title}</strong>
      {hint ? <span className="small">{hint}</span> : null}
      {action}
    </div>
  );
}

export function Meter({ value, tone }: { value: number; tone?: string }) {
  return (
    <div className="meter" role="meter" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: tone }} />
    </div>
  );
}

/* -------------------------------------------------------------- tableau */

export interface Column<T> {
  key: string;
  header: string;
  /** Rendu de la cellule. */
  cell: (row: T) => ReactNode;
  /** Valeur utilisee pour le tri ; absente = colonne non triable. */
  sort?: (row: T) => number | string;
  align?: 'left' | 'right';
  width?: string;
}

export function DataTable<T>({
  rows,
  columns,
  onRowClick,
  empty,
  initialSort,
  footer,
}: {
  rows: T[];
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  initialSort?: { key: string; dir: 1 | -1 };
  footer?: ReactNode;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((entry) => entry.key === sort.key);
    if (!column?.sort) return rows;
    return [...rows].sort((a, b) => {
      const va = column.sort!(a);
      const vb = column.sort!(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });
  }, [rows, columns, sort]);

  if (!rows.length && empty) return <>{empty}</>;

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`${column.align === 'right' ? 'num' : ''} ${column.sort ? 'sortable' : ''}`}
                style={column.width ? { width: column.width } : undefined}
                onClick={
                  column.sort
                    ? () =>
                        setSort((current) =>
                          current?.key === column.key
                            ? { key: column.key, dir: current.dir === 1 ? -1 : 1 }
                            : { key: column.key, dir: 1 },
                        )
                    : undefined
                }
              >
                {column.header}
                {sort?.key === column.key ? <span aria-hidden="true"> {sort.dir === 1 ? '▲' : '▼'}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr
              key={index}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'num' : undefined}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ conteneurs */

export function Card({
  title,
  subtitle,
  actions,
  flush,
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  if (!title) return <div className="card">{children}</div>;
  return (
    <div className={`card card-flush`}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <div className="sub">{subtitle}</div> : null}
        </div>
        {actions ? <div className="card-head-actions">{actions}</div> : null}
      </div>
      {flush ? children : <div className="card-body">{children}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="row" style={{ marginBottom: 16, gap: 12 }}>
      <div>
        <h1>{title}</h1>
        {subtitle ? <div className="small muted">{subtitle}</div> : null}
      </div>
      <div className="spacer" />
      {actions ? <div className="row" style={{ gap: 8 }}>{actions}</div> : null}
    </div>
  );
}
