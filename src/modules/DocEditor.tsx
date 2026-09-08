import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { useNav } from '../core/nav';
import { availability, docTotals, lineTotals, reservationsFrom, sceneToLines } from '../core/calc';
import { openPrintable, renderDocumentHTML } from '../core/documents';
import type { BusinessDoc, DocLine, Payment, Product } from '../core/types';
import { addDays, formatDate, money, num, rentalDays, today, uid } from '../core/utils';
import { Badge, ConfirmDialog, Field, Modal, Segmented } from '../ui/kit';
import { DocStatusBadge } from '../ui/shared';

const KIND_LABEL = { devis: 'Devis', facture: 'Facture', avoir: 'Avoir' } as const;

export function DocEditor({ docId, onClose }: { docId: string; onClose: () => void }) {
  const store = useStore();
  const { db, update, companyOf, toast, nextNumber } = store;
  const { go } = useNav();
  const doc = db.docs.find((entry) => entry.id === docId);
  const [showPayment, setShowPayment] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picker, setPicker] = useState(false);

  const products = db.products;
  const totals = useMemo(() => (doc ? docTotals(doc, products) : null), [doc, products]);
  const reservations = useMemo(() => reservationsFrom(db.docs), [db.docs]);

  if (!doc || !totals) return null;
  const company = companyOf(doc.entity);
  const client = db.clients.find((entry) => entry.id === doc.clientId);
  const editable = doc.status === 'brouillon' || doc.kind === 'devis';
  const days = rentalDays(doc.eventStart, doc.eventEnd);

  const patch = (changes: Partial<BusinessDoc>) =>
    update((draft) => {
      const target = draft.docs.find((entry) => entry.id === docId);
      if (target) Object.assign(target, changes);
    });

  const patchLine = (lineId: string, changes: Partial<DocLine>) =>
    update((draft) => {
      const target = draft.docs.find((entry) => entry.id === docId);
      const line = target?.lines.find((entry) => entry.id === lineId);
      if (line) Object.assign(line, changes);
    });

  const addLine = (product?: Product) =>
    update((draft) => {
      const target = draft.docs.find((entry) => entry.id === docId);
      if (!target) return;
      target.lines.push({
        id: uid('ln'),
        productId: product?.id ?? null,
        designation: product?.name ?? '',
        description: product ? [product.brand, product.model].filter(Boolean).join(' ') : '',
        qty: 1,
        days: product?.mode === 'location' ? rentalDays(target.eventStart, target.eventEnd) : 1,
        unitPrice: product ? (product.mode === 'vente' ? product.priceSale : product.priceDay) : 0,
        discountPct: client?.discountRate ?? 0,
        vatRate: product?.vatRate ?? company.defaultVatRate,
        degressive: product?.mode === 'location',
        kind: product?.mode ?? 'service',
      });
    });

  const addPack = (packId: string) =>
    update((draft) => {
      const target = draft.docs.find((entry) => entry.id === docId);
      const pack = draft.packs.find((entry) => entry.id === packId);
      if (!target || !pack) return;
      for (const line of pack.lines) {
        const product = draft.products.find((entry) => entry.id === line.productId);
        if (!product) continue;
        target.lines.push({
          id: uid('ln'),
          productId: product.id,
          designation: product.name,
          description: [product.brand, product.model].filter(Boolean).join(' '),
          qty: line.qty,
          days: product.mode === 'location' ? rentalDays(target.eventStart, target.eventEnd) : 1,
          unitPrice: product.mode === 'vente' ? product.priceSale : product.priceDay,
          discountPct: pack.discountPct,
          vatRate: product.vatRate,
          degressive: product.mode === 'location',
          kind: product.mode,
        });
      }
    });

  const removeLine = (lineId: string) =>
    update((draft) => {
      const target = draft.docs.find((entry) => entry.id === docId);
      if (target) target.lines = target.lines.filter((entry) => entry.id !== lineId);
    });

  const moveLine = (index: number, delta: number) =>
    update((draft) => {
      const target = draft.docs.find((entry) => entry.id === docId);
      if (!target) return;
      const next = index + delta;
      if (next < 0 || next >= target.lines.length) return;
      const [line] = target.lines.splice(index, 1);
      target.lines.splice(next, 0, line);
    });

  /** Aligne la duree de toutes les lignes de location sur la periode saisie. */
  const syncDays = () =>
    update((draft) => {
      const target = draft.docs.find((entry) => entry.id === docId);
      if (!target) return;
      const span = rentalDays(target.eventStart, target.eventEnd);
      for (const line of target.lines) if (line.kind === 'location') line.days = span;
    });

  const convertToInvoice = () => {
    const number = nextNumber(doc.entity, 'facture');
    const id = uid('doc');
    update((draft) => {
      const source = draft.docs.find((entry) => entry.id === docId);
      if (!source) return;
      draft.docs.unshift({
        ...structuredClone(source),
        id,
        kind: 'facture',
        number,
        sourceDocId: source.id,
        date: today(),
        dueDate: addDays(today(), client?.paymentTermsDays ?? company.paymentTermsDays),
        status: 'envoye',
        payments: [],
        sentAt: today(),
        signedAt: null,
        signedBy: '',
        createdAt: today(),
      });
    });
    toast(`Facture ${number} créée depuis le devis ${doc.number}.`, 'succes');
    // On atterrit sur la facture creee, pas sur la liste des devis : c'est
    // elle qu'il reste a envoyer, dater et encaisser.
    onClose();
    go('factures', id);
  };

  const createCredit = () => {
    const number = nextNumber(doc.entity, 'avoir');
    const id = uid('doc');
    update((draft) => {
      const source = draft.docs.find((entry) => entry.id === docId);
      if (!source) return;
      draft.docs.unshift({
        ...structuredClone(source),
        id,
        kind: 'avoir',
        number,
        sourceDocId: source.id,
        date: today(),
        dueDate: today(),
        status: 'paye',
        payments: [],
        title: `Avoir sur ${source.number}`,
        createdAt: today(),
      });
    });
    toast(`Avoir ${number} généré.`, 'succes');
    onClose();
    go('factures', id);
  };

  const duplicate = () => {
    const number = nextNumber(doc.entity, doc.kind);
    update((draft) => {
      const source = draft.docs.find((entry) => entry.id === docId);
      if (!source) return;
      draft.docs.unshift({
        ...structuredClone(source),
        id: uid('doc'),
        number,
        status: 'brouillon',
        date: today(),
        payments: [],
        sentAt: null,
        signedAt: null,
        signedBy: '',
        createdAt: today(),
      });
    });
    toast(`${KIND_LABEL[doc.kind]} dupliqué sous le numéro ${number}.`, 'succes');
  };

  const importScene = (sceneId: string) => {
    const scene = db.scenes.find((entry) => entry.id === sceneId);
    if (!scene) return;
    const lines = sceneToLines(scene, products).map((line) => ({
      ...line,
      id: uid('ln'),
      days: line.kind === 'location' ? days : 1,
      discountPct: client?.discountRate ?? 0,
    }));
    update((draft) => {
      const target = draft.docs.find((entry) => entry.id === docId);
      if (!target) return;
      target.lines.push(...lines);
      target.sceneId = sceneId;
    });
    toast(`${lines.length} ligne(s) importée(s) depuis la scène « ${scene.name} ».`, 'succes');
  };

  const print = () => {
    const html = renderDocumentHTML(doc, company, client, products, db.docs);
    if (!openPrintable(html)) toast('Le navigateur a bloqué la fenêtre d’impression.', 'alerte');
  };

  return (
    <>
      <Modal
        title={`${KIND_LABEL[doc.kind]} ${doc.number}`}
        subtitle={`${company.name} · ${client?.name ?? 'Client non défini'}`}
        size="xl"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={print}>
              🖨 Aperçu / PDF
            </button>
            <button type="button" className="btn" onClick={duplicate}>
              Dupliquer
            </button>
            {doc.kind === 'devis' && doc.status === 'accepte' ? (
              <button type="button" className="btn btn-primary" onClick={convertToInvoice}>
                Convertir en facture
              </button>
            ) : null}
            {doc.kind === 'facture' ? (
              <>
                <button type="button" className="btn" onClick={() => setShowPayment(true)}>
                  Enregistrer un règlement
                </button>
                <button type="button" className="btn" onClick={createCredit}>
                  Créer un avoir
                </button>
              </>
            ) : null}
            <div className="spacer" />
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              Supprimer
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Fermer
            </button>
          </>
        }
      >
        <div className="grid" style={{ gridTemplateColumns: '1fr 300px', gap: 18, alignItems: 'start' }}>
          <div className="stack">
            {/* ------------------------------------------------ entete */}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }}>
              <Field label="Client">
                <select value={doc.clientId} onChange={(event) => patch({ clientId: event.target.value })}>
                  {db.clients.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Statut">
                <select
                  value={doc.status}
                  onChange={(event) => patch({ status: event.target.value as BusinessDoc['status'] })}
                >
                  {(doc.kind === 'devis'
                    ? ['brouillon', 'envoye', 'accepte', 'refuse', 'expire', 'annule']
                    : ['brouillon', 'envoye', 'partiel', 'paye', 'retard', 'annule']
                  ).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date">
                <input type="date" value={doc.date} onChange={(event) => patch({ date: event.target.value })} />
              </Field>
              <Field label={doc.kind === 'devis' ? 'Valable jusqu’au' : 'Échéance'}>
                <input type="date" value={doc.dueDate} onChange={(event) => patch({ dueDate: event.target.value })} />
              </Field>
              <Field label="Objet" span={2}>
                <input value={doc.title} onChange={(event) => patch({ title: event.target.value })} placeholder="Objet du document" />
              </Field>
              <Field label="Lieu" span={2}>
                <input value={doc.venue} onChange={(event) => patch({ venue: event.target.value })} placeholder="Salle, adresse…" />
              </Field>
              <Field label="Début d’exploitation">
                <input type="date" value={doc.eventStart} onChange={(event) => patch({ eventStart: event.target.value })} />
              </Field>
              <Field label="Fin d’exploitation">
                <input type="date" value={doc.eventEnd} onChange={(event) => patch({ eventEnd: event.target.value })} />
              </Field>
              <Field label="Durée facturée" hint="Bornes incluses">
                <div className="row" style={{ gap: 6 }}>
                  <input value={`${days} jour${days > 1 ? 's' : ''}`} readOnly />
                  <button type="button" className="btn btn-sm" onClick={syncDays} title="Appliquer à toutes les lignes de location">
                    ⟳
                  </button>
                </div>
              </Field>
              <Field label="Projet rattaché">
                <select value={doc.projectId ?? ''} onChange={(event) => patch({ projectId: event.target.value || null })}>
                  <option value="">— aucun —</option>
                  {db.projects
                    .filter((project) => project.entity === doc.entity)
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>

            {/* -------------------------------------------------- lignes */}
            <div className="card card-flush">
              <div className="card-head">
                <h2>Lignes du document</h2>
                <div className="card-head-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setPicker(true)}>
                    + Catalogue
                  </button>
                  <select
                    className="btn btn-sm"
                    value=""
                    onChange={(event) => event.target.value && addPack(event.target.value)}
                    style={{ width: 'auto', padding: '4px 22px 4px 9px' }}
                  >
                    <option value="">+ Pack…</option>
                    {db.packs
                      .filter((pack) => pack.entity === doc.entity)
                      .map((pack) => (
                        <option key={pack.id} value={pack.id}>
                          {pack.name}
                        </option>
                      ))}
                  </select>
                  <select
                    className="btn btn-sm"
                    value=""
                    onChange={(event) => event.target.value && importScene(event.target.value)}
                    style={{ width: 'auto', padding: '4px 22px 4px 9px' }}
                  >
                    <option value="">+ Scène 3D…</option>
                    {db.scenes
                      .filter((scene) => scene.entity === doc.entity)
                      .map((scene) => (
                        <option key={scene.id} value={scene.id}>
                          {scene.name}
                        </option>
                      ))}
                  </select>
                  <button type="button" className="btn btn-sm" onClick={() => addLine()}>
                    + Ligne libre
                  </button>
                </div>
              </div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                <div className="table-wrap">
                  <table className="doc-lines">
                    <thead>
                      <tr>
                        <th style={{ width: 26 }} />
                        <th>Désignation</th>
                        <th style={{ width: 68 }}>Qté</th>
                        <th style={{ width: 74 }}>Jours</th>
                        <th style={{ width: 96 }}>P.U. HT</th>
                        <th style={{ width: 72 }}>Rem. %</th>
                        <th style={{ width: 76 }}>TVA</th>
                        <th style={{ width: 92 }} className="right">
                          Total HT
                        </th>
                        <th style={{ width: 58 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {doc.lines.map((line, index) => {
                        const product = products.find((entry) => entry.id === line.productId) ?? null;
                        const computed = lineTotals(line, product);
                        const stock =
                          product && line.kind === 'location'
                            ? availability(product, reservations, doc.eventStart, doc.eventEnd, doc.id)
                            : null;
                        const short = stock ? stock.free < line.qty : false;
                        return (
                          <tr key={line.id}>
                            <td className="dim small center">{index + 1}</td>
                            <td>
                              <input
                                value={line.designation}
                                onChange={(event) => patchLine(line.id, { designation: event.target.value })}
                                placeholder="Désignation"
                              />
                              <div className="row small dim" style={{ gap: 8, marginTop: 2 }}>
                                <input
                                  className="small"
                                  style={{ padding: '2px 6px', fontSize: 11, background: 'transparent', border: 0 }}
                                  value={line.description}
                                  onChange={(event) => patchLine(line.id, { description: event.target.value })}
                                  placeholder="Détail (marque, modèle, précisions…)"
                                />
                                {stock ? (
                                  short ? (
                                    <Badge tone="critical" icon="⚠">
                                      {stock.free} dispo
                                    </Badge>
                                  ) : (
                                    <Badge tone="good" icon="✔">
                                      {stock.free} dispo
                                    </Badge>
                                  )
                                ) : null}
                              </div>
                            </td>
                            <td className="num">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={line.qty}
                                onChange={(event) => patchLine(line.id, { qty: Number(event.target.value) })}
                              />
                            </td>
                            <td className="num">
                              {line.kind === 'location' ? (
                                <input
                                  type="number"
                                  min={1}
                                  value={line.days}
                                  onChange={(event) => patchLine(line.id, { days: Number(event.target.value) })}
                                  title={`Facturé ${num(computed.billedDays, 2)} j après dégressivité`}
                                />
                              ) : (
                                <span className="dim small">—</span>
                              )}
                            </td>
                            <td className="num">
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={line.unitPrice}
                                onChange={(event) => patchLine(line.id, { unitPrice: Number(event.target.value) })}
                              />
                            </td>
                            <td className="num">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                value={line.discountPct}
                                onChange={(event) => patchLine(line.id, { discountPct: Number(event.target.value) })}
                              />
                            </td>
                            <td className="num">
                              <select
                                value={line.vatRate}
                                onChange={(event) => patchLine(line.id, { vatRate: Number(event.target.value) })}
                              >
                                {db.settings.vatRates.map((rate) => (
                                  <option key={rate} value={rate}>
                                    {rate} %
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="right tnum" style={{ fontWeight: 600 }}>
                              {money(computed.netHT)}
                            </td>
                            <td>
                              <div className="row" style={{ gap: 2 }}>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveLine(index, -1)} title="Monter">
                                  ↑
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeLine(line.id)} title="Supprimer">
                                  ✕
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!doc.lines.length ? (
                        <tr>
                          <td colSpan={9} className="center dim" style={{ padding: 22 }}>
                            Aucune ligne. Ajoutez un article du catalogue, un pack ou une scène 3D.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="grid g2">
              <Field label="Notes visibles sur le document">
                <textarea value={doc.notes} onChange={(event) => patch({ notes: event.target.value })} rows={4} />
              </Field>
              <Field label="Conditions particulières">
                <textarea value={doc.terms} onChange={(event) => patch({ terms: event.target.value })} rows={4} />
              </Field>
            </div>
          </div>

          {/* ------------------------------------------------ totaux */}
          <div className="stack">
            <div className="card">
              <div className="row" style={{ marginBottom: 10 }}>
                <DocStatusBadge status={doc.status} />
                <span className="spacer" />
                <span className="small dim">{editable ? 'Modifiable' : 'Verrouillé'}</span>
              </div>
              <div className="totals">
                <div className="totals-row">
                  <span className="muted">Total brut HT</span>
                  <span className="tnum">{money(totals.grossHT)}</span>
                </div>
                {totals.lineDiscounts ? (
                  <div className="totals-row">
                    <span className="muted">Remises lignes</span>
                    <span className="tnum">− {money(totals.lineDiscounts)}</span>
                  </div>
                ) : null}
                <div className="totals-row">
                  <span className="muted">Remise globale</span>
                  <span className="row" style={{ gap: 4 }}>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      step={0.5}
                      value={doc.globalDiscountPct}
                      onChange={(event) => patch({ globalDiscountPct: Number(event.target.value) })}
                      style={{ width: 64, padding: '3px 6px', textAlign: 'right' }}
                    />
                    <span className="muted">%</span>
                  </span>
                </div>
                <div className="totals-row">
                  <span className="muted">Livraison HT</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={doc.shipping}
                    onChange={(event) => patch({ shipping: Number(event.target.value) })}
                    style={{ width: 86, padding: '3px 6px', textAlign: 'right' }}
                  />
                </div>
                <div className="totals-row" style={{ fontWeight: 600 }}>
                  <span>Total net HT</span>
                  <span className="tnum">{money(totals.netHT)}</span>
                </div>
                {totals.vatByRate.map((bucket) => (
                  <div className="totals-row" key={bucket.rate}>
                    <span className="muted">TVA {num(bucket.rate, 1)} %</span>
                    <span className="tnum">{money(bucket.vat)}</span>
                  </div>
                ))}
                <div className="totals-row grand">
                  <span>Total TTC</span>
                  <span className="tnum">{money(totals.totalTTC)}</span>
                </div>
                <div className="totals-row">
                  <span className="muted">Acompte</span>
                  <span className="row" style={{ gap: 4 }}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={doc.depositPct}
                      onChange={(event) => patch({ depositPct: Number(event.target.value) })}
                      style={{ width: 60, padding: '3px 6px', textAlign: 'right' }}
                    />
                    <span className="muted">% =</span>
                    <span className="tnum">{money(totals.deposit)}</span>
                  </span>
                </div>
                {doc.kind !== 'devis' ? (
                  <>
                    <div className="totals-row">
                      <span className="muted">Réglé</span>
                      <span className="tnum">{money(totals.paid)}</span>
                    </div>
                    <div className="totals-row" style={{ fontWeight: 600 }}>
                      <span>Reste dû</span>
                      <span className="tnum">{money(totals.balance)}</span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: 8 }}>Rentabilité prévisionnelle</h3>
              <div className="totals">
                <div className="totals-row">
                  <span className="muted">Coût de revient estimé</span>
                  <span className="tnum">{money(totals.cost)}</span>
                </div>
                <div className="totals-row">
                  <span className="muted">Marge</span>
                  <span className="tnum">{money(totals.margin)}</span>
                </div>
                <div className="totals-row">
                  <span className="muted">Taux de marge</span>
                  <span className="tnum">{num(totals.marginRate * 100, 1)} %</span>
                </div>
              </div>
              {totals.marginRate < 0.2 ? (
                <div style={{ marginTop: 8 }}>
                  <Badge tone="warning" icon="⚠">
                    Marge sous le seuil de 20 %
                  </Badge>
                </div>
              ) : null}
            </div>

            {doc.payments.length ? (
              <div className="card">
                <h3 style={{ marginBottom: 8 }}>Règlements</h3>
                <div className="stack-sm">
                  {doc.payments.map((payment) => (
                    <div key={payment.id} className="row small" style={{ gap: 8 }}>
                      <span className="muted">{formatDate(payment.date)}</span>
                      <span className="dim">{payment.method}</span>
                      <span className="spacer" />
                      <span className="tnum">{money(payment.amount)}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          update((draft) => {
                            const target = draft.docs.find((entry) => entry.id === docId);
                            if (target) target.payments = target.payments.filter((entry) => entry.id !== payment.id);
                          })
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {doc.kind === 'devis' ? (
              <div className="card">
                <h3 style={{ marginBottom: 8 }}>Signature client</h3>
                {doc.signedAt ? (
                  <div className="stack-sm">
                    <Badge tone="good" icon="✔">
                      Signé le {formatDate(doc.signedAt)}
                    </Badge>
                    <span className="small muted">par {doc.signedBy}</span>
                  </div>
                ) : (
                  <div className="stack-sm">
                    <span className="small muted">
                      Enregistre l’accord du client et bascule le devis en « accepté ».
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary btn-block"
                      onClick={() => {
                        const name = window.prompt('Nom du signataire :', client?.contacts[0]?.name ?? '');
                        if (!name) return;
                        patch({ signedAt: today(), signedBy: name, status: 'accepte' });
                        toast('Devis signé et accepté.', 'succes');
                      }}
                    >
                      Marquer comme signé
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      {picker ? (
        <ProductPicker
          entity={doc.entity}
          onPick={(product) => {
            addLine(product);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      ) : null}

      {showPayment ? (
        <PaymentDialog
          due={totals.balance}
          onClose={() => setShowPayment(false)}
          onSave={(payment) => {
            update((draft) => {
              const target = draft.docs.find((entry) => entry.id === docId);
              if (!target) return;
              target.payments.push(payment);
              const settled = docTotals(target, draft.products);
              target.status = settled.balance <= 0.01 ? 'paye' : 'partiel';
            });
            setShowPayment(false);
            toast('Règlement enregistré.', 'succes');
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Supprimer ce document ?"
          message={`${KIND_LABEL[doc.kind]} ${doc.number} sera définitivement supprimé. Cette action est irréversible.`}
          confirmLabel="Supprimer"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            update((draft) => {
              draft.docs = draft.docs.filter((entry) => entry.id !== docId);
            });
            toast('Document supprimé.', 'alerte');
            onClose();
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------- sélecteur produit */

function ProductPicker({
  entity,
  onPick,
  onClose,
}: {
  entity: string;
  onPick: (product: Product) => void;
  onClose: () => void;
}) {
  const { db } = useStore();
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);

  const items = db.products
    .filter((product) => product.active && (all || product.entity === entity))
    .filter((product) =>
      `${product.name} ${product.ref} ${product.brand} ${product.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );

  return (
    <Modal title="Ajouter depuis le catalogue" size="lg" onClose={onClose}>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <div className="search" style={{ flex: 1 }}>
          <input autoFocus placeholder="Rechercher une référence, une marque…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Segmented
          value={all ? 'tous' : 'societe'}
          options={[
            { value: 'societe', label: 'Cette société' },
            { value: 'tous', label: 'Tout le groupe' },
          ]}
          onChange={(value) => setAll(value === 'tous')}
        />
      </div>
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th>Référence</th>
              <th>Catégorie</th>
              <th className="num">Prix</th>
              <th className="num">Stock</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((product) => (
              <tr key={product.id} className="clickable" onClick={() => onPick(product)}>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <span>{product.mark}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="truncate">{product.name}</div>
                      <div className="small dim">{product.ref}</div>
                    </div>
                  </div>
                </td>
                <td className="small muted">{product.category}</td>
                <td className="num tnum">
                  {money(product.mode === 'vente' ? product.priceSale : product.priceDay)}
                  <div className="small dim">{product.mode === 'location' ? '/ jour' : product.unit}</div>
                </td>
                <td className="num tnum">{product.mode === 'location' ? product.stock : '—'}</td>
                <td className="right">
                  <span className="btn btn-sm">Ajouter</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- règlement */

function PaymentDialog({
  due,
  onSave,
  onClose,
}: {
  due: number;
  onSave: (payment: Payment) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(due);
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState<Payment['method']>('virement');
  const [reference, setReference] = useState('');

  return (
    <Modal
      title="Enregistrer un règlement"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSave({ id: uid('pay'), date, amount, method, reference })}
          >
            Enregistrer
          </button>
        </>
      }
    >
      <div className="grid g2">
        <Field label="Montant" hint={`Reste dû : ${money(due)}`}>
          <input type="number" step={0.01} value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Moyen">
          <select value={method} onChange={(event) => setMethod(event.target.value as Payment['method'])}>
            <option value="virement">Virement</option>
            <option value="cb">Carte bancaire</option>
            <option value="cheque">Chèque</option>
            <option value="especes">Espèces</option>
            <option value="prelevement">Prélèvement</option>
          </select>
        </Field>
        <Field label="Référence">
          <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="N° de virement, remise…" />
        </Field>
      </div>
    </Modal>
  );
}
