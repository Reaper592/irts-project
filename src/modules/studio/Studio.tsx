import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../core/store';
import { useNav } from '../../core/nav';
import { StudioEngine, type CameraPreset } from './engine';
import type { EntityId, Scene, SceneItem, VenueType } from '../../core/types';
import { addDays, downloadFile, esc, money, money0, num, sum, today, uid } from '../../core/utils';
import { Badge, Card, ConfirmDialog, EmptyState, Field, Modal, PageHeader, Segmented } from '../../ui/kit';
import { sceneToLines } from '../../core/calc';

const VENUES: { id: VenueType; label: string }[] = [
  { id: 'salle', label: 'Salle' },
  { id: 'plein-air', label: 'Plein air' },
  { id: 'chapiteau', label: 'Chapiteau' },
  { id: 'club', label: 'Club' },
  { id: 'eglise', label: 'Église' },
  { id: 'showroom', label: 'Showroom' },
];

const CAMERAS: { id: CameraPreset; label: string; hint: string }[] = [
  { id: 'public', label: 'Œil du public', hint: 'Hauteur 1,70 m, au centre de la jauge' },
  { id: 'face', label: 'Face', hint: 'Vue frontale de la scène' },
  { id: 'plongee', label: 'Plongée', hint: 'Vue d’ensemble en hauteur' },
  { id: 'laterale', label: 'Latérale', hint: 'Depuis le côté cour' },
  { id: 'scene', label: 'Depuis la scène', hint: 'Contrechamp vers la salle' },
];

function emptyScene(entity: EntityId): Scene {
  return {
    id: uid('scn'),
    entity,
    name: 'Nouvelle implantation',
    clientId: null,
    projectId: null,
    venueType: 'salle',
    width: 22,
    depth: 18,
    height: 8,
    audience: 250,
    ambient: 0.3,
    haze: 0.2,
    exposure: 1,
    bloom: 0.4,
    timeOfDay: 'nuit',
    floorTone: '#3a3129',
    wallTone: '#15181d',
    items: [],
    notes: '',
    createdAt: today(),
  };
}

export default function Studio() {
  const store = useStore();
  const { db, visible, update, defaultEntity, toast, companyOf, nextNumber } = store;
  const { focus, go } = useNav();
  const scenes = useMemo(() => visible(db.scenes), [db.scenes, visible]);
  const [sceneId, setSceneId] = useState<string | null>(focus ?? scenes[0]?.id ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState<'lieu' | 'objets' | 'chiffrage'>('objets');

  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<StudioEngine | null>(null);

  const scene = scenes.find((entry) => entry.id === sceneId) ?? null;

  useEffect(() => {
    if (!scenes.length) setSceneId(null);
    else if (!scenes.some((entry) => entry.id === sceneId)) setSceneId(scenes[0].id);
  }, [scenes, sceneId]);

  /* Le moteur vit le temps de la vue ; la scene est reconstruite a chaque changement. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new StudioEngine(host);
    engineRef.current = engine;
    engine.onSelect = (itemId) => setSelected(itemId);
    setReady(true);
    return () => {
      engine.dispose();
      engineRef.current = null;
      setReady(false);
    };
  }, []);

  const sceneKey = scene ? `${scene.id}|${scene.items.length}|${scene.venueType}|${scene.width}|${scene.depth}|${scene.height}|${scene.audience}|${scene.timeOfDay}|${scene.floorTone}|${scene.wallTone}|${scene.items.map((item) => `${item.id}${item.x}${item.y}${item.z}${item.rotY}${item.scale}${item.color}${item.beam}${item.qty}`).join()}` : '';

  useEffect(() => {
    if (ready && scene) engineRef.current?.build(scene);
    // La cle serialise tout ce qui change la geometrie : evite les reconstructions inutiles.
  }, [ready, sceneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ready && scene) engineRef.current?.applySettings(scene);
  }, [ready, scene?.exposure, scene?.bloom, scene?.haze, scene?.ambient]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    engineRef.current?.selectById(selected);
  }, [selected]);

  const patch = useCallback(
    (changes: Partial<Scene>) =>
      update((draft) => {
        const target = draft.scenes.find((entry) => entry.id === sceneId);
        if (target) Object.assign(target, changes);
      }),
    [sceneId, update],
  );

  const patchItem = (itemId: string, changes: Partial<SceneItem>) =>
    update((draft) => {
      const item = draft.scenes.find((entry) => entry.id === sceneId)?.items.find((entry) => entry.id === itemId);
      if (item) Object.assign(item, changes);
    });

  const quote = useMemo(() => {
    if (!scene) return { lines: [], total: 0 };
    const lines = sceneToLines(scene, db.products);
    return {
      lines: lines.map((line) => ({
        ...line,
        product: db.products.find((product) => product.id === line.productId),
      })),
      total: sum(lines, (line) => line.qty * line.unitPrice),
    };
  }, [scene, db.products]);

  const load = useMemo(() => {
    if (!scene) return { power: 0, weight: 0 };
    let power = 0;
    let weight = 0;
    for (const item of scene.items) {
      const product = db.products.find((entry) => entry.id === item.productId);
      if (!product) continue;
      power += product.powerW * item.qty;
      weight += product.weightKg * item.qty;
    }
    return { power, weight };
  }, [scene, db.products]);

  const exportImage = () => {
    const engine = engineRef.current;
    if (!engine || !scene) return;
    const link = document.createElement('a');
    link.href = engine.screenshot();
    link.download = `${scene.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
    link.click();
    toast('Rendu exporté en PNG.', 'succes');
  };

  /** Fiche client : le rendu 3D accompagne la liste de matériel et le chiffrage. */
  const exportSheet = () => {
    const engine = engineRef.current;
    if (!engine || !scene) return;
    const image = engine.screenshot();
    const company = companyOf(scene.entity);
    const client = db.clients.find((entry) => entry.id === scene.clientId);
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(scene.name)}</title>
<style>
 @page { size: A4 landscape; margin: 12mm; }
 body { font-family: "Helvetica Neue", Arial, sans-serif; color:#16181d; margin:0; font-size:11px; }
 header { display:flex; align-items:center; gap:14px; border-bottom:3px solid ${company.accent}; padding-bottom:10px; margin-bottom:12px; }
 .logo { width:40px; height:40px; border-radius:9px; background:${company.accent}; color:#fff; display:grid; place-items:center; font-weight:700; }
 h1 { font-size:16px; margin:0; } .sub { color:#666; font-size:10px; }
 img { width:100%; border-radius:10px; display:block; }
 .cols { display:flex; gap:16px; margin-top:12px; }
 table { border-collapse:collapse; width:100%; } th,td { padding:5px 6px; border-bottom:1px solid #e6e8eb; text-align:left; }
 th { font-size:8.5px; text-transform:uppercase; letter-spacing:.06em; color:#7b8089; }
 .n { text-align:right; font-variant-numeric: tabular-nums; }
 .meta { display:flex; gap:20px; margin:10px 0; } .meta div span { display:block; font-size:8.5px; text-transform:uppercase; color:#7b8089; letter-spacing:.06em; }
 .noprint button { position:fixed; top:10px; right:10px; font:inherit; padding:8px 14px; border:0; border-radius:8px; background:${company.accent}; color:#fff; cursor:pointer; }
 @media print { .noprint { display:none; } }
</style></head><body>
<div class="noprint"><button onclick="window.print()">Imprimer / PDF</button></div>
<header><div class="logo">${esc(company.mark)}</div>
 <div><h1>${esc(scene.name)}</h1>
 <div class="sub">${esc(company.legalName)} — ${client ? esc(client.name) : 'Projet interne'} — ${new Date().toLocaleDateString('fr-FR')}</div></div>
</header>
<div class="cols">
 <div style="flex:2"><img src="${image}" alt="Rendu 3D de l’implantation"></div>
 <div style="flex:1">
  <div class="meta">
   <div><span>Lieu</span>${esc(scene.venueType)}</div>
   <div><span>Dimensions</span>${num(scene.width)} × ${num(scene.depth)} × ${num(scene.height)} m</div>
   <div><span>Jauge</span>${num(scene.audience)} pers.</div>
  </div>
  <div class="meta">
   <div><span>Puissance</span>${num(load.power / 1000, 1)} kW</div>
   <div><span>Poids matériel</span>${num(load.weight)} kg</div>
   <div><span>Budget location / jour</span>${money(quote.total)}</div>
  </div>
  <table><thead><tr><th>Matériel</th><th class="n">Qté</th><th class="n">P.U. HT</th><th class="n">Total</th></tr></thead><tbody>
  ${quote.lines
    .map(
      (line) =>
        `<tr><td>${esc(line.designation)}</td><td class="n">${line.qty}</td><td class="n">${money(line.unitPrice)}</td><td class="n">${money(line.qty * line.unitPrice)}</td></tr>`,
    )
    .join('')}
  </tbody></table>
  ${scene.notes ? `<p style="color:#55595f;margin-top:10px">${esc(scene.notes)}</p>` : ''}
 </div>
</div>
</body></html>`;
    const win = window.open('', '_blank');
    if (!win) {
      toast('Le navigateur a bloqué la fenêtre.', 'alerte');
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  const createQuote = () => {
    if (!scene) return;
    const client = db.clients.find((entry) => entry.id === scene.clientId) ?? db.clients.find((entry) => entry.entity === scene.entity);
    if (!client) {
      toast('Rattachez un client à la scène avant de générer un devis.', 'alerte');
      return;
    }
    const company = companyOf(scene.entity);
    const number = nextNumber(scene.entity, 'devis');
    const id = uid('doc');
    update((draft) => {
      draft.docs.unshift({
        id,
        entity: scene.entity,
        kind: 'devis',
        number,
        clientId: client.id,
        projectId: scene.projectId,
        dealId: null,
        sceneId: scene.id,
        sourceDocId: null,
        title: scene.name,
        date: today(),
        dueDate: addDays(today(), company.quoteValidityDays),
        status: 'brouillon',
        lines: sceneToLines(scene, draft.products).map((line) => ({ ...line, id: uid('ln') })),
        globalDiscountPct: 0,
        depositPct: 30,
        shipping: 0,
        eventStart: today(),
        eventEnd: today(),
        venue: scene.name,
        notes: scene.notes,
        terms: company.cgv,
        payments: [],
        sentAt: null,
        signedAt: null,
        signedBy: '',
        createdAt: today(),
      });
    });
    toast(`Devis ${number} généré depuis la scène.`, 'succes');
    go('devis', id);
  };

  const selectedItem = scene?.items.find((item) => item.id === selected) ?? null;

  return (
    <div className="view">
      <PageHeader
        title="Studio 3D"
        subtitle="Construire l’environnement du client et lui montrer le rendu avant de signer"
        actions={
          <>
            <select value={sceneId ?? ''} onChange={(event) => setSceneId(event.target.value)} style={{ width: 260 }}>
              {scenes.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
              {!scenes.length ? <option value="">Aucune scène</option> : null}
            </select>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const created = emptyScene(defaultEntity);
                update((draft) => void draft.scenes.unshift(created));
                setSceneId(created.id);
                toast('Nouvelle scène créée.', 'succes');
              }}
            >
              + Nouvelle scène
            </button>
            <button type="button" className="btn btn-primary" onClick={createQuote} disabled={!scene?.items.length}>
              Générer le devis
            </button>
          </>
        }
      />

      {!scene ? (
        <Card>
          <EmptyState
            mark="🎬"
            title="Aucune scène pour cette société"
            hint="Créez une implantation pour visualiser le matériel dans l’espace du client."
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const created = emptyScene(defaultEntity);
                  update((draft) => void draft.scenes.unshift(created));
                  setSceneId(created.id);
                }}
              >
                + Créer une scène
              </button>
            }
          />
        </Card>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 14, alignItems: 'start' }}>
          <div className="stack">
            <div className="viewer" style={{ height: 'min(64vh, 620px)' }}>
              <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
              {!ready ? <div className="viewer-loading">Initialisation du moteur de rendu…</div> : null}
              <div className="viewer-hud">
                <span>{scene.items.length} objets</span>
                <span>
                  {num(scene.width)} × {num(scene.depth)} × {num(scene.height)} m
                </span>
                <span>{num(scene.audience)} personnes</span>
                <span>{num(load.power / 1000, 1)} kW</span>
                <span>{num(load.weight)} kg</span>
              </div>
              <div className="viewer-tools">
                {CAMERAS.map((camera) => (
                  <button
                    key={camera.id}
                    type="button"
                    className="btn btn-sm"
                    title={camera.hint}
                    onClick={() => engineRef.current?.setCamera(camera.id)}
                  >
                    {camera.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="row row-wrap" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={exportImage}>
                📷 Exporter le rendu (PNG)
              </button>
              <button type="button" className="btn" onClick={exportSheet}>
                📄 Fiche d’implantation client
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  downloadFile(`${scene.name}.json`, JSON.stringify(scene, null, 2), 'application/json');
                  toast('Scène exportée.', 'succes');
                }}
              >
                Exporter la scène
              </button>
              <span className="spacer" />
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                Supprimer la scène
              </button>
            </div>

            <div className="row small muted" style={{ gap: 14 }}>
              <span>Clic gauche : sélectionner · Clic + glisser : orbiter · Molette : zoomer · Clic droit : déplacer</span>
            </div>
          </div>

          {/* ------------------------------------------------ panneau latéral */}
          <div className="stack">
            <div className="seg" style={{ width: '100%' }}>
              {(['objets', 'lieu', 'chiffrage'] as const).map((id) => (
                <button key={id} type="button" aria-pressed={panel === id} onClick={() => setPanel(id)} style={{ flex: 1 }}>
                  {id === 'objets' ? 'Objets' : id === 'lieu' ? 'Lieu' : 'Chiffrage'}
                </button>
              ))}
            </div>

            {panel === 'lieu' ? (
              <Card>
                <div className="stack" style={{ gap: 12 }}>
                  <Field label="Nom de l’implantation">
                    <input value={scene.name} onChange={(event) => patch({ name: event.target.value })} />
                  </Field>
                  <Field label="Client">
                    <select value={scene.clientId ?? ''} onChange={(event) => patch({ clientId: event.target.value || null })}>
                      <option value="">— interne —</option>
                      {db.clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Type de lieu">
                    <select value={scene.venueType} onChange={(event) => patch({ venueType: event.target.value as VenueType })}>
                      {VENUES.map((venue) => (
                        <option key={venue.id} value={venue.id}>
                          {venue.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid g3" style={{ gap: 8 }}>
                    <Field label="Largeur (m)">
                      <input type="number" min={4} max={80} value={scene.width} onChange={(event) => patch({ width: Number(event.target.value) })} />
                    </Field>
                    <Field label="Profondeur">
                      <input type="number" min={4} max={80} value={scene.depth} onChange={(event) => patch({ depth: Number(event.target.value) })} />
                    </Field>
                    <Field label="Hauteur">
                      <input type="number" min={2.5} max={30} step={0.5} value={scene.height} onChange={(event) => patch({ height: Number(event.target.value) })} />
                    </Field>
                  </div>
                  <Field label={`Jauge : ${num(scene.audience)} personnes`}>
                    <input type="range" min={0} max={5000} step={50} value={scene.audience} onChange={(event) => patch({ audience: Number(event.target.value) })} />
                  </Field>
                  <Field label="Moment de la journée">
                    <Segmented
                      value={scene.timeOfDay}
                      options={[
                        { value: 'jour', label: 'Jour' },
                        { value: 'crepuscule', label: 'Crépuscule' },
                        { value: 'nuit', label: 'Nuit' },
                      ]}
                      onChange={(value) => patch({ timeOfDay: value as Scene['timeOfDay'] })}
                    />
                  </Field>
                  <div className="grid g2" style={{ gap: 8 }}>
                    <Field label="Teinte du sol">
                      <input type="color" value={scene.floorTone} onChange={(event) => patch({ floorTone: event.target.value })} />
                    </Field>
                    <Field label="Teinte des murs">
                      <input type="color" value={scene.wallTone} onChange={(event) => patch({ wallTone: event.target.value })} />
                    </Field>
                  </div>

                  <hr className="hr" />
                  <h3>Rendu</h3>
                  <Field label={`Lumière d’ambiance — ${num(scene.ambient * 100)} %`}>
                    <input type="range" min={0} max={1} step={0.02} value={scene.ambient} onChange={(event) => patch({ ambient: Number(event.target.value) })} />
                  </Field>
                  <Field label={`Brouillard (visibilité des faisceaux) — ${num(scene.haze * 100)} %`}>
                    <input type="range" min={0} max={1} step={0.02} value={scene.haze} onChange={(event) => patch({ haze: Number(event.target.value) })} />
                  </Field>
                  <Field label={`Exposition — ${num(scene.exposure, 2)}`}>
                    <input type="range" min={0.4} max={2} step={0.02} value={scene.exposure} onChange={(event) => patch({ exposure: Number(event.target.value) })} />
                  </Field>
                  <Field label={`Halo lumineux — ${num(scene.bloom, 2)}`}>
                    <input type="range" min={0} max={1.6} step={0.02} value={scene.bloom} onChange={(event) => patch({ bloom: Number(event.target.value) })} />
                  </Field>
                  <Field label="Notes">
                    <textarea rows={3} value={scene.notes} onChange={(event) => patch({ notes: event.target.value })} />
                  </Field>
                </div>
              </Card>
            ) : null}

            {panel === 'objets' ? (
              <div className="stack">
                <Card>
                  <button type="button" className="btn btn-primary btn-block" onClick={() => setAdding(true)}>
                    + Ajouter du matériel
                  </button>
                </Card>

                {selectedItem ? (
                  <Card title={selectedItem.label} subtitle="Objet sélectionné">
                    <div className="stack" style={{ gap: 10 }}>
                      <div className="grid g3" style={{ gap: 8 }}>
                        <Field label="X (m)">
                          <input type="number" step={0.25} value={selectedItem.x} onChange={(event) => patchItem(selectedItem.id, { x: Number(event.target.value) })} />
                        </Field>
                        <Field label="Hauteur">
                          <input type="number" step={0.25} value={selectedItem.y} onChange={(event) => patchItem(selectedItem.id, { y: Number(event.target.value) })} />
                        </Field>
                        <Field label="Z (m)">
                          <input type="number" step={0.25} value={selectedItem.z} onChange={(event) => patchItem(selectedItem.id, { z: Number(event.target.value) })} />
                        </Field>
                      </div>
                      <Field label={`Rotation — ${num((selectedItem.rotY * 180) / Math.PI)}°`}>
                        <input type="range" min={-3.15} max={3.15} step={0.05} value={selectedItem.rotY} onChange={(event) => patchItem(selectedItem.id, { rotY: Number(event.target.value) })} />
                      </Field>
                      <Field label={`Échelle — ${num(selectedItem.scale, 2)}`}>
                        <input type="range" min={0.3} max={3} step={0.05} value={selectedItem.scale} onChange={(event) => patchItem(selectedItem.id, { scale: Number(event.target.value) })} />
                      </Field>
                      <div className="grid g2" style={{ gap: 8 }}>
                        <Field label="Quantité">
                          <input type="number" min={1} value={selectedItem.qty} onChange={(event) => patchItem(selectedItem.id, { qty: Number(event.target.value) })} />
                        </Field>
                        <Field label="Couleur">
                          <input type="color" value={selectedItem.color} onChange={(event) => patchItem(selectedItem.id, { color: event.target.value })} />
                        </Field>
                      </div>
                      <Field label={`Intensité du faisceau — ${num(selectedItem.beam * 100)} %`}>
                        <input type="range" min={0} max={1} step={0.05} value={selectedItem.beam} onChange={(event) => patchItem(selectedItem.id, { beam: Number(event.target.value) })} />
                      </Field>
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            update((draft) => {
                              const target = draft.scenes.find((entry) => entry.id === sceneId);
                              if (!target) return;
                              target.items.push({ ...structuredClone(selectedItem), id: uid('si'), x: selectedItem.x + 1.2 });
                            })
                          }
                        >
                          Dupliquer
                        </button>
                        <span className="spacer" />
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            update((draft) => {
                              const target = draft.scenes.find((entry) => entry.id === sceneId);
                              if (target) target.items = target.items.filter((item) => item.id !== selectedItem.id);
                            });
                            setSelected(null);
                          }}
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </Card>
                ) : null}

                <Card title="Objets de la scène" subtitle={`${scene.items.length} élément(s)`} flush>
                  <div style={{ maxHeight: 330, overflowY: 'auto' }}>
                    {scene.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="row"
                        style={{
                          width: '100%',
                          gap: 8,
                          padding: '7px 14px',
                          background: selected === item.id ? 'var(--surface-3)' : 'transparent',
                          border: 0,
                          borderBottom: '1px solid var(--line-soft)',
                          color: 'inherit',
                          font: 'inherit',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                        onClick={() => setSelected(item.id)}
                      >
                        <span className="scope-dot" style={{ background: item.beam > 0 ? item.color : 'var(--ink-4)' }} />
                        <span className="truncate" style={{ flex: 1, fontSize: 12.5 }}>
                          {item.label}
                        </span>
                        <span className="small dim tnum">{item.qty > 1 ? `×${item.qty}` : ''}</span>
                      </button>
                    ))}
                    {!scene.items.length ? <EmptyState mark="🎚️" title="Scène vide" hint="Ajoutez du matériel du catalogue." /> : null}
                  </div>
                </Card>
              </div>
            ) : null}

            {panel === 'chiffrage' ? (
              <Card title="Chiffrage de l’implantation" subtitle="Tarifs catalogue, base une journée">
                <div className="stack-sm">
                  {quote.lines.map((line) => (
                    <div key={line.productId} className="row small" style={{ gap: 8, padding: '5px 0', borderBottom: '1px solid var(--line-soft)' }}>
                      <span className="truncate" style={{ flex: 1 }}>
                        {line.designation}
                      </span>
                      <span className="dim tnum">× {line.qty}</span>
                      <span className="tnum" style={{ minWidth: 76, textAlign: 'right' }}>
                        {money(line.qty * line.unitPrice)}
                      </span>
                    </div>
                  ))}
                  {!quote.lines.length ? <span className="small dim">Aucun matériel chiffrable dans cette scène.</span> : null}
                </div>
                <hr className="hr" />
                <div className="totals">
                  <div className="totals-row">
                    <span className="muted">Puissance appelée</span>
                    <span className="tnum">{num(load.power / 1000, 1)} kW</span>
                  </div>
                  <div className="totals-row">
                    <span className="muted">Poids total</span>
                    <span className="tnum">{num(load.weight)} kg</span>
                  </div>
                  <div className="totals-row grand">
                    <span>Total / jour HT</span>
                    <span className="tnum">{money0(quote.total)}</span>
                  </div>
                </div>
                {load.power > 32000 ? (
                  <div style={{ marginTop: 10 }}>
                    <Badge tone="warning" icon="⚡">
                      Au-delà de 32 kW : prévoir un groupe électrogène ou une armoire dédiée
                    </Badge>
                  </div>
                ) : null}
                <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={createQuote} disabled={!quote.lines.length}>
                  Générer le devis
                </button>
              </Card>
            ) : null}
          </div>
        </div>
      )}

      {adding && scene ? (
        <AddGearDialog
          entity={scene.entity}
          onClose={() => setAdding(false)}
          onAdd={(productId, count) => {
            const product = db.products.find((entry) => entry.id === productId);
            if (!product?.model3d) return;
            update((draft) => {
              const target = draft.scenes.find((entry) => entry.id === sceneId);
              if (!target) return;
              for (let index = 0; index < count; index += 1) {
                const spread = count === 1 ? 0 : (index / (count - 1) - 0.5) * Math.min(target.width * 0.7, count * 1.2);
                target.items.push({
                  id: uid('si'),
                  productId: product.id,
                  model3d: product.model3d!,
                  label: `${product.name}${count > 1 ? ` ${index + 1}` : ''}`,
                  qty: 1,
                  x: Number(spread.toFixed(2)),
                  y: ['moving-head', 'blinder', 'line-array'].includes(product.model3d!) ? 6 : 0,
                  z: -2,
                  rotY: 0,
                  scale: 1,
                  color: '#3987e5',
                  beam: ['moving-head', 'par-led', 'blinder'].includes(product.model3d!) ? 0.7 : 0,
                });
              }
            });
            setAdding(false);
            toast(`${count} objet(s) ajouté(s).`, 'succes');
          }}
        />
      ) : null}

      {confirmDelete && scene ? (
        <ConfirmDialog
          title="Supprimer cette scène ?"
          message={`« ${scene.name} » et son implantation seront définitivement supprimées.`}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            update((draft) => {
              draft.scenes = draft.scenes.filter((entry) => entry.id !== scene.id);
            });
            setConfirmDelete(false);
            toast('Scène supprimée.', 'alerte');
          }}
        />
      ) : null}
    </div>
  );
}

function AddGearDialog({
  entity,
  onAdd,
  onClose,
}: {
  entity: EntityId;
  onAdd: (productId: string, count: number) => void;
  onClose: () => void;
}) {
  const { db } = useStore();
  const [query, setQuery] = useState('');
  const [count, setCount] = useState(1);
  const items = db.products.filter(
    (product) =>
      product.model3d &&
      (product.entity === entity || true) &&
      `${product.name} ${product.category} ${product.brand}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Modal title="Ajouter du matériel à la scène" size="lg" onClose={onClose}>
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <div className="search" style={{ flex: 1 }}>
          <input autoFocus placeholder="Rechercher…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Field label="">
          <div className="row" style={{ gap: 6 }}>
            <span className="small muted nowrap">Quantité</span>
            <input type="number" min={1} max={48} value={count} onChange={(event) => setCount(Number(event.target.value))} style={{ width: 80 }} />
          </div>
        </Field>
      </div>
      <div className="grid g3" style={{ maxHeight: 420, overflowY: 'auto', gap: 8 }}>
        {items.map((product) => (
          <button
            key={product.id}
            type="button"
            className="card"
            style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}
            onClick={() => onAdd(product.id, count)}
          >
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontSize: 20 }}>{product.mark}</span>
              <div style={{ minWidth: 0 }}>
                <div className="truncate" style={{ fontSize: 12.5, fontWeight: 570 }}>
                  {product.name}
                </div>
                <div className="small dim truncate">{product.category}</div>
              </div>
            </div>
            <div className="row small muted" style={{ marginTop: 8 }}>
              <span>{money(product.mode === 'vente' ? product.priceSale : product.priceDay)}</span>
              <span className="spacer" />
              <span className="dim">{product.model3d}</span>
            </div>
          </button>
        ))}
        {!items.length ? <EmptyState mark="🔍" title="Aucun matériel représentable en 3D" /> : null}
      </div>
    </Modal>
  );
}
