import type {
  BusinessDoc,
  Client,
  DocLine,
  DocStatus,
  Expense,
  Product,
  Scene,
} from './types';
import { round2, sum, today } from './utils';
import { billableUnits, itemSize, objectDef, productIdForRef } from '../modules/studio/library';

/* ------------------------------------------------------- tarification parc */

/**
 * Coefficient degressif applique a une location longue duree.
 * Le bareme du produit prime ; a defaut on applique le bareme metier standard
 * (2 jours = 1,6 j facturees, semaine = 3 j, mois = 9 j).
 */
export function degressiveCoef(product: Product | null, days: number): number {
  const steps = product?.degressive?.length ? [...product.degressive] : DEFAULT_DEGRESSIVE;
  const sorted = steps.sort((a, b) => a.minDays - b.minDays);
  let coef = days;
  for (const step of sorted) {
    if (days >= step.minDays) coef = step.coef + (days - step.minDays) * TAIL_RATE;
  }
  return round2(Math.min(coef, days));
}

const TAIL_RATE = 0.25;

export const DEFAULT_DEGRESSIVE = [
  { minDays: 1, coef: 1 },
  { minDays: 2, coef: 1.6 },
  { minDays: 3, coef: 2.1 },
  { minDays: 7, coef: 3 },
  { minDays: 14, coef: 5 },
  { minDays: 30, coef: 9 },
];

/* --------------------------------------------------------- totaux document */

export interface LineTotals {
  /** Nombre de journees facturees apres degressivite. */
  billedDays: number;
  grossHT: number;
  discount: number;
  netHT: number;
  vat: number;
  netTTC: number;
}

export function lineTotals(line: DocLine, product: Product | null): LineTotals {
  const days = Math.max(1, line.days || 1);
  const billedDays =
    line.kind === 'location' && line.degressive ? degressiveCoef(product, days) : days;
  const grossHT = round2(line.qty * line.unitPrice * billedDays);
  const discount = round2((grossHT * (line.discountPct || 0)) / 100);
  const netHT = round2(grossHT - discount);
  const vat = round2((netHT * (line.vatRate || 0)) / 100);
  return { billedDays, grossHT, discount, netHT, vat, netTTC: round2(netHT + vat) };
}

/**
 * Duree de vie commerciale d'un materiel de location, exprimee en journees
 * effectivement louees. Un element de line array sort environ 80 jours par an
 * et se remplace au bout de cinq a six saisons.
 */
export const RENTAL_LIFE_DAYS = 400;

/** Part du prix de location absorbee par la preparation, le transport et l'usure. */
export const HANDLING_RATE = 0.08;

/** Cout de revient direct d'une ligne, selon sa nature. */
export function lineCost(line: DocLine, product: Product | null, totals: LineTotals): number {
  if (!product) return round2(totals.netHT * 0.35);
  switch (line.kind) {
    case 'vente':
      return round2(product.cost * line.qty);
    case 'location':
      return round2(
        (product.cost / RENTAL_LIFE_DAYS + line.unitPrice * HANDLING_RATE) * line.qty * totals.billedDays,
      );
    default:
      // Prestations et forfaits : le cout du produit est deja un cout journalier.
      return round2(product.cost * line.qty * Math.max(1, line.days || 1));
  }
}

export interface DocTotals {
  grossHT: number;
  lineDiscounts: number;
  globalDiscount: number;
  shipping: number;
  netHT: number;
  vatByRate: { rate: number; base: number; vat: number }[];
  totalVat: number;
  totalTTC: number;
  deposit: number;
  paid: number;
  balance: number;
  cost: number;
  margin: number;
  marginRate: number;
}

export function docTotals(doc: BusinessDoc, products: Product[]): DocTotals {
  const byId = new Map(products.map((p) => [p.id, p]));
  let grossHT = 0;
  let lineDiscounts = 0;
  let netBeforeGlobal = 0;
  let cost = 0;

  const perLine = doc.lines.map((line) => {
    const product = line.productId ? byId.get(line.productId) ?? null : null;
    const totals = lineTotals(line, product);
    grossHT += totals.grossHT;
    lineDiscounts += totals.discount;
    netBeforeGlobal += totals.netHT;
    cost += lineCost(line, product, totals);
    return { line, totals };
  });

  const globalRate = (doc.globalDiscountPct || 0) / 100;
  const globalDiscount = round2(netBeforeGlobal * globalRate);
  const shipping = doc.shipping || 0;
  const netHT = round2(netBeforeGlobal - globalDiscount + shipping);

  const buckets = new Map<number, { base: number; vat: number }>();
  for (const { line, totals } of perLine) {
    const rate = line.vatRate || 0;
    const base = round2(totals.netHT * (1 - globalRate));
    const bucket = buckets.get(rate) ?? { base: 0, vat: 0 };
    bucket.base = round2(bucket.base + base);
    bucket.vat = round2(bucket.vat + (base * rate) / 100);
    buckets.set(rate, bucket);
  }
  if (shipping) {
    const rate = doc.lines[0]?.vatRate ?? 20;
    const bucket = buckets.get(rate) ?? { base: 0, vat: 0 };
    bucket.base = round2(bucket.base + shipping);
    bucket.vat = round2(bucket.vat + (shipping * rate) / 100);
    buckets.set(rate, bucket);
  }

  const vatByRate = [...buckets.entries()]
    .map(([rate, bucket]) => ({ rate, base: bucket.base, vat: bucket.vat }))
    .sort((a, b) => a.rate - b.rate);
  const totalVat = round2(sum(vatByRate, (bucket) => bucket.vat));
  const totalTTC = round2(netHT + totalVat);
  const paid = round2(sum(doc.payments ?? [], (payment) => payment.amount));
  const sign = doc.kind === 'avoir' ? -1 : 1;

  return {
    grossHT: round2(grossHT),
    lineDiscounts: round2(lineDiscounts),
    globalDiscount,
    shipping,
    netHT: round2(netHT * sign),
    vatByRate: vatByRate.map((bucket) => ({
      rate: bucket.rate,
      base: round2(bucket.base * sign),
      vat: round2(bucket.vat * sign),
    })),
    totalVat: round2(totalVat * sign),
    totalTTC: round2(totalTTC * sign),
    deposit: round2((totalTTC * (doc.depositPct || 0)) / 100),
    paid,
    balance: round2(totalTTC * sign - paid),
    cost: round2(cost),
    margin: round2(netHT * sign - cost),
    marginRate: netHT ? round2(((netHT * sign - cost) / (netHT * sign)) * 100) / 100 : 0,
  };
}

/** Statut effectif : recalcule le retard et l'expiration a partir des dates. */
export function effectiveStatus(doc: BusinessDoc, totals: DocTotals, ref = today()): DocStatus {
  if (doc.status === 'annule' || doc.status === 'brouillon') return doc.status;
  if (doc.kind === 'devis') {
    if (doc.status === 'envoye' && doc.dueDate && doc.dueDate < ref) return 'expire';
    return doc.status;
  }
  if (totals.balance <= 0.01) return 'paye';
  if (totals.paid > 0.01) return doc.dueDate && doc.dueDate < ref ? 'retard' : 'partiel';
  if (doc.dueDate && doc.dueDate < ref) return 'retard';
  return 'envoye';
}

/** Penalites de retard dues a la date de reference (taux annuel prorata temporis). */
export function lateFees(
  doc: BusinessDoc,
  totals: DocTotals,
  annualRate: number,
  recoveryFee: number,
  ref = today(),
): number {
  if (doc.kind !== 'facture' || totals.balance <= 0 || !doc.dueDate || doc.dueDate >= ref) return 0;
  const late = (new Date(ref).getTime() - new Date(doc.dueDate).getTime()) / 86_400_000;
  return round2((totals.balance * annualRate * late) / 365 + recoveryFee);
}

/* ------------------------------------------------------ disponibilite parc */

export interface Reservation {
  docId: string;
  docNumber: string;
  clientId: string;
  productId: string;
  qty: number;
  start: string;
  end: string;
}

const BLOCKING: DocStatus[] = ['accepte', 'envoye', 'partiel', 'paye', 'retard'];

/** Toutes les lignes de location engagees, converties en reservations de parc. */
export function reservationsFrom(docs: BusinessDoc[]): Reservation[] {
  const out: Reservation[] = [];
  for (const doc of docs) {
    if (doc.kind === 'avoir') continue;
    if (!BLOCKING.includes(doc.status)) continue;
    if (!doc.eventStart || !doc.eventEnd) continue;
    for (const line of doc.lines) {
      if (line.kind !== 'location' || !line.productId) continue;
      out.push({
        docId: doc.id,
        docNumber: doc.number,
        clientId: doc.clientId,
        productId: line.productId,
        qty: line.qty,
        start: doc.eventStart,
        end: doc.eventEnd,
      });
    }
  }
  return out;
}

/** Quantite disponible d'un produit sur une periode, en tenant compte du HS. */
export function availability(
  product: Product,
  reservations: Reservation[],
  start: string,
  end: string,
  ignoreDocId?: string,
): { total: number; reserved: number; free: number; outOfOrder: number } {
  const outOfOrder = product.serials.filter((s) => s.state === 'hs' || s.state === 'maintenance')
    .length;
  const total = Math.max(0, product.stock - outOfOrder);
  const reserved = reservations
    .filter(
      (r) =>
        r.productId === product.id &&
        r.docId !== ignoreDocId &&
        r.start <= end &&
        start <= r.end,
    )
    .reduce((acc, r) => acc + r.qty, 0);
  return { total, reserved, free: total - reserved, outOfOrder };
}

/** Taux d'occupation moyen du parc sur une periode (jours * unites). */
export function utilisationRate(
  products: Product[],
  reservations: Reservation[],
  start: string,
  end: string,
): number {
  const rentable = products.filter((p) => p.mode === 'location' && p.stock > 0);
  if (!rentable.length) return 0;
  const spanDays = Math.max(1, (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
  const capacity = rentable.reduce((acc, p) => acc + p.stock, 0) * spanDays;
  let used = 0;
  for (const r of reservations) {
    const from = r.start > start ? r.start : start;
    const to = r.end < end ? r.end : end;
    const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 + 1;
    if (days > 0) used += days * r.qty;
  }
  return capacity ? Math.min(1, used / capacity) : 0;
}

/* ---------------------------------------------------------------- finances */

export interface CashRow {
  month: string;
  revenue: number;
  encaisse: number;
  charges: number;
  resultat: number;
}

export function monthlyFinance(
  docs: BusinessDoc[],
  expenses: Expense[],
  products: Product[],
  months: string[],
): CashRow[] {
  return months.map((month) => {
    const revenue = docs
      .filter((d) => d.kind !== 'devis' && d.status !== 'annule' && d.date.startsWith(month))
      .reduce((acc, d) => acc + docTotals(d, products).netHT, 0);
    const encaisse = docs
      .flatMap((d) => (d.payments ?? []).map((p) => ({ ...p, kind: d.kind })))
      .filter((p) => p.date.startsWith(month))
      .reduce((acc, p) => acc + p.amount, 0);
    const charges = expenses
      .filter((e) => e.date.startsWith(month))
      .reduce((acc, e) => acc + e.amountHT, 0);
    return {
      month,
      revenue: round2(revenue),
      encaisse: round2(encaisse),
      charges: round2(charges),
      resultat: round2(revenue - charges),
    };
  });
}

/** TVA collectee - TVA deductible sur une periode. */
export function vatBalance(
  docs: BusinessDoc[],
  expenses: Expense[],
  products: Product[],
  from: string,
  to: string,
): { collected: number; deductible: number; due: number } {
  const collected = docs
    .filter((d) => d.kind !== 'devis' && d.status !== 'annule' && d.date >= from && d.date <= to)
    .reduce((acc, d) => acc + docTotals(d, products).totalVat, 0);
  const deductible = expenses
    .filter((e) => e.date >= from && e.date <= to)
    .reduce((acc, e) => acc + (e.amountHT * e.vatRate) / 100, 0);
  return {
    collected: round2(collected),
    deductible: round2(deductible),
    due: round2(collected - deductible),
  };
}

/** Encours client : total TTC non regle, toutes factures confondues. */
export function clientBalance(client: Client, docs: BusinessDoc[], products: Product[]): number {
  return round2(
    docs
      .filter((d) => d.clientId === client.id && d.kind !== 'devis' && d.status !== 'annule')
      .reduce((acc, d) => acc + docTotals(d, products).balance, 0),
  );
}

/* ------------------------------------------------------------- scene 3D -> devis */

/**
 * Ligne de devis deduite d'un objet de scene, avec sa description complete :
 * marque, modele et cotes reelles. Un objet pose dans le Studio doit arriver
 * dans le devis sans ressaisie et sans ambiguite pour le client.
 */
export interface SceneLine extends DocLine {
  /** Objets de la scene regroupes sur cette ligne. */
  itemIds: string[];
  /** Cotes en metres, telles que posees. */
  size: [number, number, number];
}

/** Objet pose dans la scene mais sans reference facturable (decor, echelle). */
export interface SceneExtra {
  itemId: string;
  label: string;
  size: [number, number, number];
}

function formatSize(size: [number, number, number]): string {
  const fmt = (value: number) => value.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
  return `L ${fmt(size[0])} × H ${fmt(size[1])} × P ${fmt(size[2])} m`;
}

/**
 * Lignes de devis d'une scene. Les objets identiques posés aux mêmes cotes
 * sont regroupés ; deux tailles différentes du même produit restent sur deux
 * lignes, parce que le client paie et lit des quantités par gabarit.
 */
export function sceneLines(
  scene: Scene,
  products: Product[],
): { lines: SceneLine[]; extras: SceneExtra[] } {
  const byId = new Map(products.map((product) => [product.id, product]));
  const groups = new Map<string, SceneLine>();
  const extras: SceneExtra[] = [];

  for (const item of scene.items) {
    const def = objectDef(item.model3d);
    const size = itemSize(item.model3d, item);
    const product = item.productId
      ? byId.get(item.productId) ?? null
      : def.product
        ? byId.get(productIdForRef(def.product.ref)) ?? null
        : null;

    if (!product) {
      extras.push({ itemId: item.id, label: item.label || def.label, size });
      continue;
    }

    const units = billableUnits(item.model3d, size, item.qty);
    const key = `${product.id}|${size.map((value) => value.toFixed(2)).join('x')}`;
    const existing = groups.get(key);
    if (existing) {
      existing.qty += units;
      existing.itemIds.push(item.id);
      continue;
    }
    groups.set(key, {
      id: `line_${key.replace(/[^a-z0-9]+/gi, '_')}`,
      productId: product.id,
      designation: product.name,
      description: [`${product.brand} ${product.model}`.trim(), formatSize(size)].filter(Boolean).join(' — '),
      qty: units,
      days: 1,
      unitPrice: product.mode === 'vente' ? product.priceSale : product.priceDay,
      discountPct: 0,
      vatRate: product.vatRate,
      degressive: product.mode === 'location',
      kind: product.mode,
      itemIds: [item.id],
      size,
    });
  }

  const lines = [...groups.values()].sort((a, b) => a.designation.localeCompare(b.designation));
  return { lines, extras };
}

/** Lignes de devis prêtes à insérer dans un document. */
export function sceneToLines(scene: Scene, products: Product[]): DocLine[] {
  return sceneLines(scene, products).lines.map(({ itemIds, size, ...line }) => {
    void itemIds;
    void size;
    return line;
  });
}
