import type { EntityId, Scope } from './types';

let counter = 0;

/** Identifiant court, stable pour une session et suffisant pour un stockage local. */
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export const EUR = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});

export const EUR0 = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

export function money(value: number): string {
  return EUR.format(Number.isFinite(value) ? value : 0);
}

export function money0(value: number): string {
  return EUR0.format(Number.isFinite(value) ? value : 0);
}

/** Format compact pour les tuiles de KPI : 1 284 / 12,9 k / 4,2 M. */
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')} M€`;
  if (abs >= 10_000) return `${(value / 1000).toFixed(1).replace('.', ',')} k€`;
  return money0(value);
}

export function pct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits).replace('.', ',')} %`;
}

export function num(value: number, digits = 0): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/* ------------------------------------------------------------------ dates */

export function today(): string {
  return toISO(new Date());
}

export function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(iso: string, days: number): string {
  const date = parseISO(iso);
  date.setDate(date.getDate() + days);
  return toISO(date);
}

export function addMonths(iso: string, months: number): string {
  const date = parseISO(iso);
  date.setMonth(date.getMonth() + months);
  return toISO(date);
}

export function daysBetween(from: string, to: string): number {
  const a = parseISO(from).getTime();
  const b = parseISO(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Duree de location facturee : bornes incluses, minimum une journee. */
export function rentalDays(start: string, end: string): number {
  if (!start || !end) return 1;
  return Math.max(1, daysBetween(start, end) + 1);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = parseISO(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  return parseISO(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
    .replace('.', '');
}

/** Les 12 cles de mois qui se terminent au mois de `ref` (incluse). */
export function lastMonths(count: number, ref = today()): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(monthKey(addMonths(`${ref.slice(0, 8)}01`, -i)));
  return keys;
}

/** Deux intervalles de dates inclusifs se chevauchent-ils ? */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

/* ----------------------------------------------------------------- divers */

export function inScope(entity: EntityId, scope: Scope): boolean {
  return scope === 'groupe' || entity === scope;
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + (pick(item) || 0), 0);
}

export function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (out[k] ||= []).push(item);
  }
  return out;
}

export function sortBy<T>(items: T[], pick: (item: T) => number | string, dir: 1 | -1 = 1): T[] {
  return [...items].sort((a, b) => {
    const va = pick(a);
    const vb = pick(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return 0;
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function downloadFile(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Echappement HTML pour les exports (documents imprimables, pages generees). */
export function esc(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCSV(rows: Record<string, unknown>[], headers?: string[]): string {
  if (!rows.length) return '';
  const cols = headers ?? Object.keys(rows[0]);
  const lines = [cols.join(';')];
  for (const row of rows) lines.push(cols.map((col) => csvCell(row[col])).join(';'));
  return `﻿${lines.join('\n')}`;
}
