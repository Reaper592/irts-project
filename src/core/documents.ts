import type { BusinessDoc, Client, Company, LandingPage, Product } from './types';
import { docTotals, lineTotals } from './calc';
import { esc, formatDate, money, num, rentalDays } from './utils';

const KIND_TITLE: Record<BusinessDoc['kind'], string> = {
  devis: 'DEVIS',
  facture: 'FACTURE',
  avoir: 'AVOIR',
};

/**
 * Document imprimable (A4) pret pour l'impression PDF du navigateur.
 * Les mentions legales francaises obligatoires sont incluses : identite,
 * TVA, delais de paiement, penalites de retard et indemnite de recouvrement.
 */
export function renderDocumentHTML(
  doc: BusinessDoc,
  company: Company,
  client: Client | undefined,
  products: Product[],
  /** Les autres documents, pour retrouver celui dont celui-ci decoule. */
  docs: BusinessDoc[] = [],
): string {
  const totals = docTotals(doc, products);
  const byId = new Map(products.map((product) => [product.id, product]));
  const isQuote = doc.kind === 'devis';
  const source = doc.sourceDocId ? docs.find((entry) => entry.id === doc.sourceDocId) ?? null : null;
  const days = doc.eventStart && doc.eventEnd ? rentalDays(doc.eventStart, doc.eventEnd) : 0;

  const rows = doc.lines
    .map((line) => {
      const product = line.productId ? byId.get(line.productId) ?? null : null;
      const computed = lineTotals(line, product);
      return `<tr>
        <td>
          <strong>${esc(line.designation)}</strong>
          ${line.description ? `<div class="desc">${esc(line.description)}</div>` : ''}
        </td>
        <td class="n">${num(line.qty, line.qty % 1 ? 2 : 0)}</td>
        <td class="n">${line.kind === 'location' ? `${num(line.days)} j${line.degressive && computed.billedDays !== line.days ? `<div class="desc">facturé ${num(computed.billedDays, 2)} j</div>` : ''}` : '—'}</td>
        <td class="n">${money(line.unitPrice)}</td>
        <td class="n">${line.discountPct ? `${num(line.discountPct, 1)} %` : '—'}</td>
        <td class="n">${num(line.vatRate, 1)} %</td>
        <td class="n"><strong>${money(computed.netHT)}</strong></td>
      </tr>`;
    })
    .join('');

  const vatRows = totals.vatByRate
    .map(
      (bucket) =>
        `<tr><td>TVA ${num(bucket.rate, 1)} % sur ${money(bucket.base)}</td><td class="n">${money(bucket.vat)}</td></tr>`,
    )
    .join('');

  const payments = doc.payments.length
    ? `<div class="block">
        <h3>Règlements enregistrés</h3>
        <table class="mini">
          ${doc.payments
            .map(
              (payment) =>
                `<tr><td>${formatDate(payment.date)} — ${esc(payment.method)}${payment.reference ? ` (${esc(payment.reference)})` : ''}</td><td class="n">${money(payment.amount)}</td></tr>`,
            )
            .join('')}
          <tr class="tot"><td>Reste à régler</td><td class="n">${money(totals.balance)}</td></tr>
        </table>
      </div>`
    : '';

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>${esc(doc.number)} — ${esc(company.name)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #16181d; font-size: 10.5px; margin: 0; line-height: 1.45; }
  .sheet { max-width: 190mm; margin: 0 auto; }
  header { display: flex; gap: 20px; align-items: flex-start; border-bottom: 3px solid ${company.accent}; padding-bottom: 12px; }
  .logo { width: 46px; height: 46px; border-radius: 10px; background: ${company.accent}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; letter-spacing: 0.5px; }
  .ident h1 { font-size: 15px; margin: 0 0 2px; }
  .ident p { margin: 0; color: #55595f; font-size: 9.5px; }
  .docmeta { margin-left: auto; text-align: right; }
  .docmeta .kind { font-size: 20px; font-weight: 700; letter-spacing: 1.5px; color: ${company.accent}; }
  .docmeta .no { font-size: 12px; font-weight: 600; }
  .docmeta p { margin: 1px 0; color: #55595f; font-size: 9.5px; }
  .parties { display: flex; gap: 16px; margin: 16px 0 6px; }
  .party { flex: 1; border: 1px solid #dfe2e6; border-radius: 8px; padding: 10px 12px; }
  .party h3 { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.09em; color: #7b8089; margin: 0 0 5px; }
  .party strong { font-size: 11.5px; }
  .party p { margin: 1px 0; color: #45484e; }
  .context { background: #f4f6f8; border-radius: 8px; padding: 9px 12px; margin: 10px 0; display: flex; gap: 22px; flex-wrap: wrap; }
  .context div span { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.07em; color: #7b8089; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 10px; }
  table.lines th { text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #7b8089; border-bottom: 1.5px solid #16181d; padding: 6px 5px; }
  table.lines td { padding: 6px 5px; border-bottom: 1px solid #e6e8eb; vertical-align: top; }
  table.lines .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .desc { color: #7b8089; font-size: 9px; margin-top: 1px; }
  .foot { display: flex; gap: 18px; margin-top: 14px; align-items: flex-start; }
  .foot .left { flex: 1; }
  .totals { width: 74mm; }
  .totals table { width: 100%; border-collapse: collapse; }
  .totals td { padding: 4px 6px; }
  .totals .n { text-align: right; font-variant-numeric: tabular-nums; }
  .totals .grand td { border-top: 2px solid #16181d; font-size: 13px; font-weight: 700; padding-top: 7px; }
  .totals .due td { background: ${company.accent}14; font-weight: 600; }
  .block { margin-top: 12px; }
  .block h3 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #7b8089; margin: 0 0 4px; }
  table.mini { width: 100%; border-collapse: collapse; }
  table.mini td { padding: 3px 0; border-bottom: 1px solid #eceef0; }
  table.mini .n { text-align: right; font-variant-numeric: tabular-nums; }
  table.mini .tot td { font-weight: 700; border-bottom: 0; }
  .terms { margin-top: 14px; font-size: 8.8px; color: #55595f; border-top: 1px solid #e6e8eb; padding-top: 8px; }
  .sign { margin-top: 14px; border: 1px dashed #b9bec5; border-radius: 8px; padding: 10px 12px; font-size: 9.5px; }
  .sign .box { height: 42px; }
  .legal { margin-top: 12px; font-size: 8px; color: #7b8089; text-align: center; border-top: 1px solid #e6e8eb; padding-top: 6px; }
  @media print { .noprint { display: none; } }
  .noprint { position: fixed; top: 10px; right: 10px; }
  .noprint button { font: inherit; font-size: 12px; padding: 8px 14px; border-radius: 8px; border: 0; background: ${company.accent}; color: #fff; cursor: pointer; }
</style></head>
<body>
<div class="noprint"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
<div class="sheet">
  <header>
    <div class="logo">${esc(company.mark)}</div>
    <div class="ident">
      <h1>${esc(company.legalName)}</h1>
      <p>${esc(company.tagline)}</p>
      <p>${esc(company.address)} — ${esc(company.zip)} ${esc(company.city)}</p>
      <p>${esc(company.phone)} · ${esc(company.email)} · ${esc(company.website)}</p>
    </div>
    <div class="docmeta">
      <div class="kind">${KIND_TITLE[doc.kind]}</div>
      <div class="no">${esc(doc.number)}</div>
      <p>Date : ${formatDate(doc.date)}</p>
      <p>${isQuote ? 'Valable jusqu’au' : 'Échéance'} : ${formatDate(doc.dueDate)}</p>
    </div>
  </header>

  <div class="parties">
    <div class="party">
      <h3>Émetteur</h3>
      <strong>${esc(company.legalName)}</strong>
      <p>SAS au capital de ${money(company.capital)}</p>
      <p>SIRET ${esc(company.siret)} · APE ${esc(company.ape)}</p>
      <p>TVA intracommunautaire ${esc(company.vatNumber)}</p>
      <p>${esc(company.rcs)}</p>
    </div>
    <div class="party">
      <h3>Client</h3>
      <strong>${esc(client?.name ?? '—')}</strong>
      <p>${esc(client?.address ?? '')}</p>
      <p>${esc(client?.zip ?? '')} ${esc(client?.city ?? '')}</p>
      ${client?.siret ? `<p>SIRET ${esc(client.siret)}</p>` : ''}
      ${client?.vatNumber ? `<p>TVA ${esc(client.vatNumber)}</p>` : ''}
      ${client?.contacts?.[0] ? `<p>Contact : ${esc(client.contacts[0].name)} — ${esc(client.contacts[0].email)}</p>` : ''}
    </div>
  </div>

  ${
    doc.title || doc.venue || doc.eventStart || source
      ? `<div class="context">
          ${doc.title ? `<div><span>Objet</span>${esc(doc.title)}</div>` : ''}
          ${
            /* Un avoir doit porter la reference de la facture qu'il rectifie ;
               une facture issue d'un devis gagne a rappeler son origine. */
            source
              ? `<div><span>${doc.kind === 'avoir' ? 'Rectifie la facture' : 'Référence'}</span>${esc(source.number)} du ${formatDate(source.date)}</div>`
              : ''
          }
          ${doc.venue ? `<div><span>Lieu</span>${esc(doc.venue)}</div>` : ''}
          ${
            /* La date de la vente ou de la prestation est une mention
               obligatoire de la facture (art. L441-9 du code de commerce) :
               elle s'imprime des qu'elle est connue, location ou non. */
            doc.eventStart
              ? `<div><span>${isQuote ? 'Période' : 'Date de la prestation'}</span>${formatDate(doc.eventStart)}${
                  doc.eventEnd && doc.eventEnd !== doc.eventStart
                    ? ` → ${formatDate(doc.eventEnd)}${days ? ` (${days} j)` : ''}`
                    : ''
                }</div>`
              : ''
          }
        </div>`
      : ''
  }

  <table class="lines">
    <thead><tr>
      <th>Désignation</th><th class="n">Qté</th><th class="n">Durée</th>
      <th class="n">P.U. HT</th><th class="n">Remise</th><th class="n">TVA</th><th class="n">Total HT</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="foot">
    <div class="left">
      ${doc.notes ? `<div class="block"><h3>Notes</h3><div>${esc(doc.notes).replace(/\n/g, '<br>')}</div></div>` : ''}
      ${payments}
      <div class="block">
        <h3>Règlement</h3>
        <div>Par virement — ${esc(company.bank)}<br>IBAN ${esc(company.iban)} · BIC ${esc(company.bic)}</div>
      </div>
    </div>
    <div class="totals">
      <table>
        <tr><td>Total brut HT</td><td class="n">${money(totals.grossHT)}</td></tr>
        ${totals.lineDiscounts ? `<tr><td>Remises lignes</td><td class="n">− ${money(totals.lineDiscounts)}</td></tr>` : ''}
        ${totals.globalDiscount ? `<tr><td>Remise globale ${num(doc.globalDiscountPct, 1)} %</td><td class="n">− ${money(totals.globalDiscount)}</td></tr>` : ''}
        ${totals.shipping ? `<tr><td>Livraison / transport</td><td class="n">${money(totals.shipping)}</td></tr>` : ''}
        <tr><td><strong>Total net HT</strong></td><td class="n"><strong>${money(totals.netHT)}</strong></td></tr>
        ${vatRows}
        <tr class="grand"><td>Total TTC</td><td class="n">${money(totals.totalTTC)}</td></tr>
        ${doc.depositPct ? `<tr class="due"><td>Acompte ${num(doc.depositPct, 0)} % à la commande</td><td class="n">${money(totals.deposit)}</td></tr>` : ''}
        ${!isQuote && totals.paid ? `<tr class="due"><td>Reste dû</td><td class="n">${money(totals.balance)}</td></tr>` : ''}
      </table>
    </div>
  </div>

  ${
    isQuote
      ? `<div class="sign">
          <strong>Bon pour accord</strong> — date, signature et cachet, précédés de la mention « Lu et approuvé »
          ${doc.signedAt ? `<p style="color:#1c7c1c;margin-top:6px">Signé électroniquement le ${formatDate(doc.signedAt)} par ${esc(doc.signedBy)}</p>` : '<div class="box"></div>'}
        </div>`
      : ''
  }

  <div class="terms"><strong>Conditions.</strong> ${esc(doc.terms || company.cgv)}</div>

  <div class="legal">
    ${esc(company.legalName)} — SAS au capital de ${money(company.capital)} — ${esc(company.rcs)} — TVA ${esc(company.vatNumber)} — Assurance : ${esc(company.insurance)}.<br>
    Paiement à ${num(company.paymentTermsDays)} jours. Pénalités de retard : ${num(company.lateFeeRate * 100, 2)} % l’an.
    Indemnité forfaitaire pour frais de recouvrement : ${money(company.recoveryFee)} (art. L441-10 et D441-5 du code de commerce). Escompte pour paiement anticipé : néant.
  </div>
</div>
</body></html>`;
}

/** Ouvre le document dans un onglet dedie, pret a etre imprime en PDF. */
export function openPrintable(html: string): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}

/* ------------------------------------------------- site de prospection */

const PALETTES = {
  nuit: { bg: '#0c1017', panel: '#141a23', ink: '#eef2f7', ink2: '#9aa7b6', accent: '#3987e5' },
  maree: { bg: '#071614', panel: '#0e211d', ink: '#eaf5f1', ink2: '#94b3a9', accent: '#19a874' },
  ambre: { bg: '#150f1e', panel: '#1e1729', ink: '#f2eefa', ink2: '#a99cc0', accent: '#9085e9' },
  clair: { bg: '#f7f8fa', panel: '#ffffff', ink: '#14171c', ink2: '#5b626d', accent: '#2a78d6' },
} as const;

function sectionHTML(section: LandingPage['sections'][number]): string {
  const pairs = section.items.map((item) => {
    const [head, ...rest] = item.split('|');
    return { head: head.trim(), body: rest.join('|').trim() };
  });

  switch (section.kind) {
    case 'chiffres':
      return `<section><h2>${esc(section.title)}</h2><div class="stats">${pairs
        .map((pair) => `<div class="stat"><strong>${esc(pair.head)}</strong><span>${esc(pair.body)}</span></div>`)
        .join('')}</div></section>`;
    case 'services':
    case 'galerie':
      return `<section><h2>${esc(section.title)}</h2><div class="cards">${pairs
        .map((pair) => `<div class="c"><h3>${esc(pair.head)}</h3><p>${esc(pair.body)}</p></div>`)
        .join('')}</div></section>`;
    case 'temoignages':
      return `<section><h2>${esc(section.title)}</h2><div class="cards">${pairs
        .map((pair) => `<blockquote class="c"><p>${esc(pair.body)}</p><cite>${esc(pair.head)}</cite></blockquote>`)
        .join('')}</div></section>`;
    case 'faq':
      return `<section><h2>${esc(section.title)}</h2><div class="faq">${pairs
        .map((pair) => `<details><summary>${esc(pair.head)}</summary><p>${esc(pair.body)}</p></details>`)
        .join('')}</div></section>`;
    default:
      return `<section><h2>${esc(section.title)}</h2><p class="lead">${esc(section.body).replace(/\n/g, '<br>')}</p></section>`;
  }
}

/**
 * Genere une page de prospection autonome (HTML unique, sans dependance).
 * Le formulaire enregistre le prospect en local et affiche une confirmation :
 * il suffit de brancher `endpoint` pour le relier a un back-office.
 */
export function renderLandingHTML(page: LandingPage, company: Company): string {
  const theme = PALETTES[page.palette];
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.heroSubtitle)}">
<meta property="og:title" content="${esc(page.heroTitle)}">
<meta property="og:description" content="${esc(page.heroSubtitle)}">
<style>
  :root { --bg:${theme.bg}; --panel:${theme.panel}; --ink:${theme.ink}; --ink2:${theme.ink2}; --accent:${theme.accent}; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height:1.6; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 22px; }
  header.nav { display:flex; align-items:center; gap:12px; padding:18px 0; }
  .logo { width:36px; height:36px; border-radius:10px; background:var(--accent); color:#fff; display:grid; place-items:center; font-weight:700; }
  .nav strong { font-size:15px; }
  .nav .tel { margin-left:auto; font-size:13px; color:var(--ink2); }
  .hero { padding: 56px 0 44px; }
  .hero h1 { font-size: clamp(30px, 5vw, 50px); line-height:1.08; letter-spacing:-0.025em; margin:0 0 16px; max-width: 18ch; }
  .hero p { font-size: 17px; color: var(--ink2); max-width: 60ch; margin: 0 0 26px; }
  .cta { display:inline-flex; align-items:center; gap:8px; background:var(--accent); color:#fff; text-decoration:none; padding: 13px 24px; border-radius: 10px; font-weight:600; font-size:15px; }
  .cta:hover { filter: brightness(1.08); }
  section { padding: 34px 0; border-top: 1px solid color-mix(in oklab, var(--ink) 10%, transparent); }
  h2 { font-size: 22px; letter-spacing:-0.015em; margin: 0 0 18px; }
  .lead { color: var(--ink2); max-width: 68ch; }
  .stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap: 14px; }
  .stat { background:var(--panel); border-radius:12px; padding:18px; }
  .stat strong { display:block; font-size:26px; letter-spacing:-0.02em; }
  .stat span { color: var(--ink2); font-size: 13px; }
  .cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(230px,1fr)); gap:14px; }
  .c { background:var(--panel); border-radius:12px; padding:18px; }
  .c h3 { margin:0 0 6px; font-size:15px; }
  .c p { margin:0; color:var(--ink2); font-size:13.5px; }
  blockquote.c { margin:0; }
  blockquote cite { display:block; margin-top:10px; font-style:normal; font-size:12.5px; color:var(--accent); }
  details { background:var(--panel); border-radius:10px; padding:12px 16px; margin-bottom:8px; }
  summary { cursor:pointer; font-weight:600; }
  details p { color:var(--ink2); margin:8px 0 0; }
  form { background:var(--panel); border-radius:14px; padding:22px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  form .full { grid-column: 1 / -1; }
  label { display:block; font-size:12px; color:var(--ink2); margin-bottom:5px; }
  input, textarea, select { width:100%; padding:10px 12px; border-radius:9px; border:1px solid color-mix(in oklab, var(--ink) 16%, transparent); background:var(--bg); color:var(--ink); font:inherit; font-size:14px; }
  button { background:var(--accent); color:#fff; border:0; padding:13px 22px; border-radius:10px; font:inherit; font-weight:600; font-size:15px; cursor:pointer; }
  .ok { display:none; background: color-mix(in oklab, var(--accent) 18%, transparent); border-radius:10px; padding:14px 16px; margin-top:12px; }
  footer { padding: 26px 0 40px; color:var(--ink2); font-size:12px; border-top:1px solid color-mix(in oklab, var(--ink) 10%, transparent); }
  @media (max-width: 620px) { form { grid-template-columns: 1fr; } }
</style></head>
<body>
<div class="wrap">
  <header class="nav">
    <div class="logo">${esc(company.mark)}</div>
    <strong>${esc(company.name)}</strong>
    <span class="tel">${esc(company.phone)}</span>
  </header>

  <div class="hero">
    <h1>${esc(page.heroTitle)}</h1>
    <p>${esc(page.heroSubtitle)}</p>
    <a class="cta" href="#contact">${esc(page.ctaLabel)} →</a>
  </div>

  ${page.sections.map(sectionHTML).join('')}

  <section id="contact">
    <h2>Parlons de votre projet</h2>
    <p class="lead">Réponse sous 24 h ouvrées, devis détaillé sous 48 h.</p>
    <form id="lead-form">
      <div><label for="f-nom">Nom / société</label><input id="f-nom" name="nom" required></div>
      <div><label for="f-mail">E-mail</label><input id="f-mail" type="email" name="email" required></div>
      <div><label for="f-tel">Téléphone</label><input id="f-tel" name="tel"></div>
      <div><label for="f-date">Date de l’événement</label><input id="f-date" type="date" name="date"></div>
      <div class="full"><label for="f-budget">Budget estimé</label>
        <select id="f-budget" name="budget">
          <option>Moins de 2 000 €</option><option>2 000 – 10 000 €</option>
          <option>10 000 – 30 000 €</option><option>Plus de 30 000 €</option>
        </select></div>
      <div class="full"><label for="f-msg">Votre projet</label><textarea id="f-msg" name="message" rows="4"></textarea></div>
      <div class="full"><button type="submit">${esc(page.ctaLabel)}</button></div>
    </form>
    <div class="ok" id="ok">Merci, votre demande est enregistrée. ${esc(company.name)} vous recontacte sous 24 h ouvrées.</div>
  </section>

  <footer>
    ${esc(company.legalName)} — ${esc(company.address)}, ${esc(company.zip)} ${esc(company.city)} —
    ${esc(company.email)} — SIRET ${esc(company.siret)} — TVA ${esc(company.vatNumber)}
  </footer>
</div>
<script>
  // Point de branchement back-office : remplacer par un POST vers votre API.
  var ENDPOINT = '';
  document.getElementById('lead-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var data = Object.fromEntries(new FormData(event.target).entries());
    data.page = ${JSON.stringify(page.slug)};
    data.recu = new Date().toISOString();
    if (ENDPOINT) {
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    } else {
      try {
        var store = JSON.parse(localStorage.getItem('irts.leads') || '[]');
        store.push(data);
        localStorage.setItem('irts.leads', JSON.stringify(store));
      } catch (error) { /* stockage indisponible */ }
    }
    event.target.style.display = 'none';
    document.getElementById('ok').style.display = 'block';
  });
</script>
</body></html>`;
}
