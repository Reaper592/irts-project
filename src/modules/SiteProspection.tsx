import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../core/store';
import { useNav } from '../core/nav';
import { renderLandingHTML } from '../core/documents';
import type { EntityId, LandingPage, LandingSection } from '../core/types';
import { addDays, downloadFile, formatDate, num, slugify, today, uid } from '../core/utils';
import { Badge, Card, ConfirmDialog, EmptyState, Field, PageHeader, Segmented } from '../ui/kit';
import { BarList, StatTile } from '../ui/charts';
import { EntityChip } from '../ui/shared';

const SECTION_KINDS: { id: LandingSection['kind']; label: string; hint: string }[] = [
  { id: 'texte', label: 'Texte', hint: 'Un paragraphe de présentation' },
  { id: 'services', label: 'Services', hint: 'Cartes « titre | description »' },
  { id: 'chiffres', label: 'Chiffres clés', hint: 'Statistiques « valeur | libellé »' },
  { id: 'galerie', label: 'Réalisations', hint: 'Références « nom | détail »' },
  { id: 'temoignages', label: 'Témoignages', hint: 'Citations « auteur | texte »' },
  { id: 'faq', label: 'FAQ', hint: 'Questions « question | réponse »' },
];

/** Prospects captés par les pages exportées, stockés côté navigateur. */
interface CapturedLead {
  nom?: string;
  email?: string;
  tel?: string;
  date?: string;
  budget?: string;
  message?: string;
  page?: string;
  recu?: string;
}

function emptyPage(entity: EntityId, name: string): LandingPage {
  return {
    id: uid('lp'),
    entity,
    slug: 'nouvelle-page',
    title: `${name} — nouvelle page`,
    heroTitle: 'Un titre qui dit ce que vous faites',
    heroSubtitle: 'Une phrase qui explique à qui vous vous adressez et ce que le client obtient.',
    ctaLabel: 'Demander un devis',
    ctaTarget: 'formulaire',
    sections: [],
    palette: 'nuit',
    published: false,
    views: 0,
    createdAt: today(),
  };
}

export default function SiteProspection() {
  const { db, visible, update, defaultEntity, toast, companyOf } = useStore();
  const { go } = useNav();
  const pages = useMemo(() => visible(db.pages), [db.pages, visible]);
  const [pageId, setPageId] = useState<string | null>(pages[0]?.id ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [leads, setLeads] = useState<CapturedLead[]>([]);
  const [preview, setPreview] = useState<'edition' | 'apercu' | 'prospects'>('edition');

  useEffect(() => {
    if (!pages.some((page) => page.id === pageId)) setPageId(pages[0]?.id ?? null);
  }, [pages, pageId]);

  useEffect(() => {
    try {
      setLeads(JSON.parse(localStorage.getItem('irts.leads') ?? '[]') as CapturedLead[]);
    } catch {
      setLeads([]);
    }
  }, [preview]);

  const page = pages.find((entry) => entry.id === pageId) ?? null;
  const company = page ? companyOf(page.entity) : null;
  // Adresse absolue du serveur IRTS : une page exportee puis hebergee ailleurs
  // doit continuer a verser ses demandes au pipeline.
  const endpoint = `${window.location.origin}/api/prospect`;
  const html = useMemo(
    () => (page && company ? renderLandingHTML(page, company, endpoint) : ''),
    [page, company, endpoint],
  );

  const patch = (changes: Partial<LandingPage>) =>
    update((draft) => {
      const target = draft.pages.find((entry) => entry.id === pageId);
      if (target) Object.assign(target, changes);
    });

  const patchSection = (sectionId: string, changes: Partial<LandingSection>) =>
    update((draft) => {
      const section = draft.pages.find((entry) => entry.id === pageId)?.sections.find((entry) => entry.id === sectionId);
      if (section) Object.assign(section, changes);
    });

  const importLead = (lead: CapturedLead) => {
    if (!page) return;
    update((draft) => {
      draft.deals.unshift({
        id: uid('deal'),
        entity: page.entity,
        title: lead.message?.slice(0, 60) || `Demande via ${page.slug}`,
        clientId: null,
        prospectName: lead.nom ?? 'Prospect',
        contactEmail: lead.email ?? '',
        contactPhone: lead.tel ?? '',
        stage: 'nouveau',
        value: budgetValue(lead.budget),
        probability: 15,
        source: 'Site de prospection',
        owner: draft.settings.operator,
        expectedDate: lead.date || addDays(today(), 45),
        nextAction: 'Appel de qualification',
        nextActionDate: addDays(today(), 1),
        lostReason: '',
        landingPageId: page.id,
        activities: [
          {
            id: uid('act'),
            date: today(),
            type: 'email',
            summary: `Demande entrante : ${lead.message ?? 'sans message'}`,
            author: draft.settings.operator,
          },
        ],
        createdAt: today(),
      });
    });
    toast('Prospect versé dans le pipeline.', 'succes');
    go('prospection');
  };

  return (
    <div className="view">
      <PageHeader
        title="Site de prospection"
        subtitle="Construire les pages qui captent la demande entrante, puis les verser au pipeline"
        actions={
          <>
            <select value={pageId ?? ''} onChange={(event) => setPageId(event.target.value)} style={{ width: 260 }}>
              {pages.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
              {!pages.length ? <option value="">Aucune page</option> : null}
            </select>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const created = emptyPage(defaultEntity, companyOf(defaultEntity).name);
                update((draft) => void draft.pages.unshift(created));
                setPageId(created.id);
                toast('Page créée.', 'succes');
              }}
            >
              + Nouvelle page
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!page}
              onClick={() => {
                if (!page) return;
                downloadFile(`${page.slug}.html`, html, 'text/html');
                toast('Page exportée — déposez le fichier chez votre hébergeur.', 'succes');
              }}
            >
              Exporter le site (HTML)
            </button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <StatTile label="Pages en ligne" value={String(pages.filter((entry) => entry.published).length)} deltaLabel={`${pages.length} au total`} />
        <StatTile label="Visites cumulées" value={num(pages.reduce((acc, entry) => acc + entry.views, 0))} deltaLabel="Depuis la mise en ligne" />
        <StatTile
          label="Affaires issues du site"
          value={String(db.deals.filter((deal) => deal.source === 'Site de prospection').length)}
          deltaLabel="Versées au pipeline"
        />
        <StatTile
          label="Prospects en attente"
          value={String(leads.length)}
          deltaLabel="Formulaires reçus non traités"
          foot={leads.length ? <Badge tone="warning" icon="✉️">À qualifier</Badge> : null}
        />
      </div>

      {!page ? (
        <Card>
          <EmptyState mark="🌐" title="Aucune page pour cette société" hint="Créez une page pour capter des demandes entrantes." />
        </Card>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 14, gap: 10 }}>
            <Segmented
              value={preview}
              options={[
                { value: 'edition', label: 'Édition' },
                { value: 'apercu', label: 'Aperçu' },
                { value: 'prospects', label: `Prospects (${leads.length})` },
              ]}
              onChange={(value) => setPreview(value as typeof preview)}
            />
            <EntityChip entity={page.entity} full />
            <Badge tone={page.published ? 'good' : 'neutre'} icon={page.published ? '✔' : '✎'}>
              {page.published ? 'Publiée' : 'Brouillon'}
            </Badge>
            <span className="small dim mono">/{page.slug}</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn"
              onClick={() => {
                const win = window.open('', '_blank');
                if (!win) {
                  toast('Le navigateur a bloqué l’onglet.', 'alerte');
                  return;
                }
                win.document.write(html);
                win.document.close();
              }}
            >
              Ouvrir dans un onglet
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              Supprimer
            </button>
          </div>

          {preview === 'apercu' ? (
            <Card flush>
              <iframe
                title="Aperçu de la page de prospection"
                srcDoc={html}
                style={{ width: '100%', height: '74vh', border: 0, borderRadius: 'var(--r-lg)', background: '#0c1017' }}
              />
            </Card>
          ) : null}

          {preview === 'edition' ? (
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
              <div className="stack">
                <Card title="Identité de la page">
                  <div className="grid g2" style={{ gap: 10 }}>
                    <Field label="Société">
                      <select value={page.entity} onChange={(event) => patch({ entity: event.target.value as EntityId })}>
                        {db.companies.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Adresse de la page (slug)">
                      <input value={page.slug} onChange={(event) => patch({ slug: slugify(event.target.value) })} />
                    </Field>
                    <Field label="Titre du navigateur / référencement" span={2}>
                      <input value={page.title} onChange={(event) => patch({ title: event.target.value })} />
                    </Field>
                    <Field label="Titre principal" span={2}>
                      <input value={page.heroTitle} onChange={(event) => patch({ heroTitle: event.target.value })} />
                    </Field>
                    <Field label="Accroche" span={2} hint="Deux lignes maximum : à qui vous parlez et ce qu’ils obtiennent">
                      <textarea rows={3} value={page.heroSubtitle} onChange={(event) => patch({ heroSubtitle: event.target.value })} />
                    </Field>
                    <Field label="Libellé du bouton">
                      <input value={page.ctaLabel} onChange={(event) => patch({ ctaLabel: event.target.value })} />
                    </Field>
                    <Field label="Thème">
                      <select value={page.palette} onChange={(event) => patch({ palette: event.target.value as LandingPage['palette'] })}>
                        <option value="nuit">Nuit</option>
                        <option value="maree">Marée</option>
                        <option value="ambre">Ambre</option>
                        <option value="clair">Clair</option>
                      </select>
                    </Field>
                    <Field label="Publication" span={2}>
                      <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={page.published} onChange={(event) => patch({ published: event.target.checked })} />
                        <span className="small">Page publiée (visible dans les statistiques et exportable)</span>
                      </label>
                    </Field>
                  </div>
                </Card>

                <Card
                  title="Sections"
                  subtitle="Chaque élément s’écrit « titre | détail », une ligne par entrée"
                  actions={
                    <select
                      className="btn btn-sm"
                      value=""
                      style={{ width: 'auto', padding: '4px 22px 4px 9px' }}
                      onChange={(event) => {
                        const kind = event.target.value as LandingSection['kind'];
                        if (!kind) return;
                        update((draft) => {
                          draft.pages
                            .find((entry) => entry.id === pageId)
                            ?.sections.push({
                              id: uid('sec'),
                              kind,
                              title: SECTION_KINDS.find((entry) => entry.id === kind)?.label ?? 'Section',
                              body: '',
                              items: [],
                            });
                        });
                      }}
                    >
                      <option value="">+ Ajouter…</option>
                      {SECTION_KINDS.map((kind) => (
                        <option key={kind.id} value={kind.id}>
                          {kind.label}
                        </option>
                      ))}
                    </select>
                  }
                >
                  <div className="stack">
                    {page.sections.map((section, index) => (
                      <div key={section.id} className="card" style={{ background: 'var(--surface-2)' }}>
                        <div className="row" style={{ marginBottom: 8, gap: 6 }}>
                          <Badge tone="info">{SECTION_KINDS.find((kind) => kind.id === section.kind)?.label}</Badge>
                          <span className="spacer" />
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={index === 0}
                            onClick={() =>
                              update((draft) => {
                                const target = draft.pages.find((entry) => entry.id === pageId);
                                if (!target) return;
                                const [moved] = target.sections.splice(index, 1);
                                target.sections.splice(index - 1, 0, moved);
                              })
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              update((draft) => {
                                const target = draft.pages.find((entry) => entry.id === pageId);
                                if (target) target.sections = target.sections.filter((entry) => entry.id !== section.id);
                              })
                            }
                          >
                            ✕
                          </button>
                        </div>
                        <div className="stack-sm">
                          <input value={section.title} onChange={(event) => patchSection(section.id, { title: event.target.value })} placeholder="Titre de la section" />
                          {section.kind === 'texte' ? (
                            <textarea rows={4} value={section.body} onChange={(event) => patchSection(section.id, { body: event.target.value })} />
                          ) : (
                            <textarea
                              rows={4}
                              value={section.items.join('\n')}
                              placeholder={SECTION_KINDS.find((kind) => kind.id === section.kind)?.hint}
                              onChange={(event) => patchSection(section.id, { items: event.target.value.split('\n').filter(Boolean) })}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                    {!page.sections.length ? <EmptyState mark="🧱" title="Aucune section" hint="Ajoutez des services, des chiffres ou une FAQ." /> : null}
                  </div>
                </Card>
              </div>

              <div className="stack">
                <Card title="Aperçu en direct" flush>
                  <iframe
                    title="Aperçu"
                    srcDoc={html}
                    style={{ width: '100%', height: '66vh', border: 0, borderRadius: 'var(--r-lg)', background: '#0c1017' }}
                  />
                </Card>
                <Card title="Mise en ligne">
                  <p className="small muted">
                    La page exportée est un fichier HTML autonome, sans dépendance externe : déposez-le chez n’importe
                    quel hébergeur. Le formulaire enregistre les demandes dans le navigateur du visiteur ; renseignez la
                    constante <span className="mono">ENDPOINT</span> en haut du script pour les envoyer vers votre API et
                    les récupérer directement dans le pipeline.
                  </p>
                </Card>
              </div>
            </div>
          ) : null}

          {preview === 'prospects' ? (
            <div className="grid g-2-1">
              <Card title="Demandes reçues" subtitle="Formulaires soumis depuis les pages exportées ouvertes sur ce navigateur">
                {leads.length ? (
                  <div className="stack-sm">
                    {leads
                      .slice()
                      .reverse()
                      .map((lead, index) => (
                        <div key={index} className="row" style={{ gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line-soft)' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="truncate">{lead.nom ?? 'Prospect'}</div>
                            <div className="small dim truncate">
                              {lead.email} · {lead.tel || 'sans téléphone'} · {lead.budget}
                            </div>
                            {lead.message ? <div className="small muted truncate">{lead.message}</div> : null}
                          </div>
                          <span className="small dim">{lead.recu ? formatDate(lead.recu.slice(0, 10)) : ''}</span>
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => importLead(lead)}>
                            Verser au pipeline
                          </button>
                        </div>
                      ))}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        localStorage.removeItem('irts.leads');
                        setLeads([]);
                        toast('Boîte de réception vidée.', 'succes');
                      }}
                    >
                      Vider la boîte de réception
                    </button>
                  </div>
                ) : (
                  <EmptyState
                    mark="✉️"
                    title="Aucune demande en attente"
                    hint="Ouvrez la page exportée et soumettez le formulaire pour tester la chaîne complète."
                  />
                )}
              </Card>
              <Card title="Trafic par page" subtitle="Visites cumulées">
                <BarList
                  items={pages.map((entry) => ({ label: entry.title, value: entry.views }))}
                  format={(value) => `${num(value)} vues`}
                  colorIndex={6}
                />
              </Card>
            </div>
          ) : null}
        </>
      )}

      {confirmDelete && page ? (
        <ConfirmDialog
          title="Supprimer cette page ?"
          message={`« ${page.title} » sera définitivement supprimée.`}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            update((draft) => {
              draft.pages = draft.pages.filter((entry) => entry.id !== page.id);
            });
            setConfirmDelete(false);
            toast('Page supprimée.', 'alerte');
          }}
        />
      ) : null}
    </div>
  );
}

function budgetValue(budget?: string): number {
  if (!budget) return 0;
  if (budget.includes('Moins')) return 1500;
  if (budget.includes('2 000')) return 6000;
  if (budget.includes('10 000')) return 20000;
  if (budget.includes('Plus')) return 45000;
  return 0;
}
