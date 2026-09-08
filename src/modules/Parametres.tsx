import { useRef, useState } from 'react';
import { useStore } from '../core/store';
import { createSeedDatabase } from '../core/seed';
import type { Company, Database, EntityId } from '../core/types';
import { downloadFile, money0, num, today } from '../core/utils';
import { Badge, Card, ConfirmDialog, EmptyState, Field, PageHeader, Tabs } from '../ui/kit';
import { CategoryManager, DOMAIN_LABEL } from '../ui/CategoryManager';
import type { TaxonomyDomain } from '../core/types';

export default function Parametres() {
  const { db, update, replace, reset, toast, sync } = useStore();
  const [tab, setTab] = useState<EntityId | 'donnees' | 'general' | 'categories' | 'reseau'>('general');
  const [domain, setDomain] = useState<TaxonomyDomain | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const patchCompany = (id: EntityId, changes: Partial<Company>) =>
    update((draft) => {
      const company = draft.companies.find((entry) => entry.id === id);
      if (company) Object.assign(company, changes);
    });

  const importJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Database;
        if (!parsed.clients || !parsed.companies) throw new Error('structure inattendue');
        replace(parsed);
        toast('Sauvegarde restaurée.', 'succes');
      } catch {
        toast('Fichier illisible : ce n’est pas une sauvegarde IRTS.', 'alerte');
      }
    };
    reader.readAsText(file);
  };

  const counts = {
    clients: db.clients.length,
    docs: db.docs.length,
    products: db.products.length,
    deals: db.deals.length,
    projects: db.projects.length,
    expenses: db.expenses.length,
    scenes: db.scenes.length,
  };

  return (
    <div className="view view-narrow">
      <PageHeader title="Paramètres" subtitle="Identité des sociétés, numérotation, objectifs et sauvegardes" />

      <Tabs
        active={tab}
        onChange={(id) => setTab(id as typeof tab)}
        tabs={[
          { id: 'general', label: 'Général' },
          { id: 'categories', label: 'Catégories' },
          { id: 'reseau', label: 'Partage réseau' },
          ...db.companies.map((company) => ({ id: company.id, label: company.name })),
          { id: 'donnees', label: 'Données' },
        ]}
      />

      {tab === 'general' ? (
        <div className="stack">
          <Card title="Utilisateur et affichage">
            <div className="grid g2">
              <Field label="Opérateur connecté" hint="Signe les tâches et les activités enregistrées">
                <input
                  value={db.settings.operator}
                  onChange={(event) => update((draft) => void (draft.settings.operator = event.target.value))}
                />
              </Field>
              <Field label="Début d’exercice comptable">
                <input
                  value={db.settings.fiscalYearStart}
                  onChange={(event) => update((draft) => void (draft.settings.fiscalYearStart = event.target.value))}
                  placeholder="MM-JJ"
                />
              </Field>
              <Field label="Taux de TVA disponibles" span={2} hint="Séparés par des virgules">
                <input
                  value={db.settings.vatRates.join(', ')}
                  onChange={(event) =>
                    update(
                      (draft) =>
                        void (draft.settings.vatRates = event.target.value
                          .split(',')
                          .map((rate) => Number(rate.trim()))
                          .filter((rate) => Number.isFinite(rate))),
                    )
                  }
                />
              </Field>
            </div>
          </Card>

          <Card title="Objectifs annuels de chiffre d’affaires" subtitle="Servent de référence sur le tableau de pilotage">
            <div className="grid g3">
              {db.companies.map((company) => (
                <Field key={company.id} label={company.name}>
                  <input
                    type="number"
                    step={10000}
                    value={db.settings.revenueTargets[company.id] ?? 0}
                    onChange={(event) =>
                      update((draft) => void (draft.settings.revenueTargets[company.id] = Number(event.target.value)))
                    }
                  />
                </Field>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              Objectif consolidé : {money0(Object.values(db.settings.revenueTargets).reduce((a, b) => a + b, 0))} HT.
            </p>
          </Card>

          <Card title="Numérotation des documents" subtitle="Dernier numéro attribué par société et par type">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Société</th>
                    <th>Préfixe devis</th>
                    <th className="num">Dernier n°</th>
                    <th>Préfixe facture</th>
                    <th className="num">Dernier n°</th>
                    <th>Préfixe avoir</th>
                    <th className="num">Dernier n°</th>
                  </tr>
                </thead>
                <tbody>
                  {db.companies.map((company) => {
                    const numbering = db.settings.numbering[company.id] ?? { devis: 0, facture: 0, avoir: 0 };
                    return (
                      <tr key={company.id}>
                        <td>{company.name}</td>
                        <td className="mono small">{company.quotePrefix}</td>
                        <td className="num tnum">{num(numbering.devis)}</td>
                        <td className="mono small">{company.invoicePrefix}</td>
                        <td className="num tnum">{num(numbering.facture)}</td>
                        <td className="mono small">{company.creditPrefix}</td>
                        <td className="num tnum">{num(numbering.avoir)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              La numérotation est continue et sans rupture, comme l’exige la réglementation française sur la facturation.
              Elle s’incrémente automatiquement à chaque création de document.
            </p>
          </Card>
        </div>
      ) : null}

      {tab === 'categories' ? (
        <div className="stack">
          <Card title="Domaines de classement" subtitle="Chaque liste de l’application se règle ici — ou depuis son propre menu">
            <div className="grid g3">
              {(Object.keys(DOMAIN_LABEL) as TaxonomyDomain[]).map((entry) => {
                const count = db.categories.filter((category) => category.domain === entry && !category.archived).length;
                return (
                  <button
                    key={entry}
                    type="button"
                    className="card"
                    style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}
                    onClick={() => setDomain(entry)}
                  >
                    <div style={{ fontWeight: 570, fontSize: 13 }}>{DOMAIN_LABEL[entry]}</div>
                    <div className="small dim" style={{ marginTop: 6 }}>
                      {count} catégorie(s)
                    </div>
                    <div className="row row-wrap" style={{ gap: 4, marginTop: 8 }}>
                      {db.categories
                        .filter((category) => category.domain === entry && !category.archived)
                        .slice(0, 6)
                        .map((category) => (
                          <span key={category.id} className="chip" style={{ borderColor: category.color }}>
                            {category.icon} {category.label}
                          </span>
                        ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
          <Card title="Comment cela fonctionne">
            <p className="small muted" style={{ margin: 0 }}>
              Une catégorie porte un nom, une couleur, un pictogramme, une portée — une société ou tout le groupe — et,
              si besoin, des paramètres imposés à tous ses éléments : puissance d’un projecteur, surface couverte d’une
              tente, pitch d’une dalle LED. Ces paramètres apparaissent alors dans le formulaire de la fiche. À la
              suppression d’une catégorie, l’application demande vers quelle autre reclasser les éléments : rien n’est
              laissé orphelin.
            </p>
          </Card>
        </div>
      ) : null}

      {tab === 'reseau' ? (
        <div className="stack">
          <Card title="État de la connexion">
            <div className="row" style={{ gap: 10, marginBottom: 12 }}>
              {sync.status === 'connecte' ? (
                <Badge tone="good" icon="✔">
                  Connecté au serveur partagé
                </Badge>
              ) : sync.status === 'connexion' ? (
                <Badge tone="warning" icon="⟳">
                  Connexion en cours
                </Badge>
              ) : sync.status === 'erreur' ? (
                <Badge tone="critical" icon="⚠">
                  Erreur de synchronisation
                </Badge>
              ) : (
                <Badge icon="💾">Mode local — ce poste uniquement</Badge>
              )}
              {sync.status === 'connecte' ? <span className="small muted">Révision {sync.revision}</span> : null}
            </div>
            {sync.lastError ? <p className="small delta-down">{sync.lastError}</p> : null}
            <div className="grid g2">
              <Field label="Nom de ce poste" hint="Affiché aux autres utilisateurs connectés">
                <input
                  value={db.settings.station}
                  onChange={(event) => update((draft) => void (draft.settings.station = event.target.value))}
                />
              </Field>
              <Field label="Postes connectés">
                <div className="row row-wrap" style={{ gap: 5, padding: '6px 0' }}>
                  {sync.presence.length ? (
                    sync.presence.map((poste) => (
                      <span key={poste.id} className="chip">
                        🖥️ {poste.nom}
                      </span>
                    ))
                  ) : (
                    <span className="small dim">Aucun autre poste</span>
                  )}
                </div>
              </Field>
            </div>
            <div className="row row-wrap" style={{ gap: 8, marginTop: 12 }}>
              <button type="button" className="btn" disabled={sync.status !== 'connecte'} onClick={() => void sync.refresh()}>
                Recharger depuis le serveur
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={sync.status !== 'connecte'}
                onClick={() => {
                  if (!window.confirm('Remplacer la base du serveur par celle de ce poste ? Les autres postes seront resynchronisés.')) return;
                  void sync.publishLocal();
                }}
              >
                Publier la base de ce poste
              </button>
            </div>
          </Card>

          <Card title="Mettre l’application en réseau">
            <ol className="small muted" style={{ paddingLeft: 18, lineHeight: 1.8, margin: 0 }}>
              <li>
                Sur le poste qui fait office de serveur : <span className="mono">npm run build</span> puis{' '}
                <span className="mono">npm start</span>.
              </li>
              <li>
                Le terminal affiche l’adresse réseau, par exemple <span className="mono">http://192.168.1.20:8080</span>.
              </li>
              <li>
                Chaque autre ordinateur ouvre cette adresse dans son navigateur : la base est commune et les
                modifications apparaissent en direct.
              </li>
              <li>Pour un accès depuis l’extérieur, publiez ce port derrière votre routeur ou un tunnel HTTPS.</li>
            </ol>
            <p className="small dim" style={{ marginTop: 10 }}>
              Sans serveur joignable, l’application continue de fonctionner seule sur le poste, avec sa base locale.
            </p>
          </Card>
        </div>
      ) : null}

      {db.companies.map((company) =>
        tab === company.id ? (
          <div className="stack" key={company.id}>
            <Card title="Identité légale">
              <div className="grid g2">
                <Field label="Nom commercial">
                  <input value={company.name} onChange={(event) => patchCompany(company.id, { name: event.target.value })} />
                </Field>
                <Field label="Raison sociale">
                  <input value={company.legalName} onChange={(event) => patchCompany(company.id, { legalName: event.target.value })} />
                </Field>
                <Field label="Activité" span={2}>
                  <input value={company.activity} onChange={(event) => patchCompany(company.id, { activity: event.target.value })} />
                </Field>
                <Field label="Signature / accroche" span={2}>
                  <input value={company.tagline} onChange={(event) => patchCompany(company.id, { tagline: event.target.value })} />
                </Field>
                <Field label="SIRET">
                  <input value={company.siret} onChange={(event) => patchCompany(company.id, { siret: event.target.value })} />
                </Field>
                <Field label="RCS">
                  <input value={company.rcs} onChange={(event) => patchCompany(company.id, { rcs: event.target.value })} />
                </Field>
                <Field label="Code APE">
                  <input value={company.ape} onChange={(event) => patchCompany(company.id, { ape: event.target.value })} />
                </Field>
                <Field label="TVA intracommunautaire">
                  <input value={company.vatNumber} onChange={(event) => patchCompany(company.id, { vatNumber: event.target.value })} />
                </Field>
                <Field label="Capital social (€)">
                  <input
                    type="number"
                    value={company.capital}
                    onChange={(event) => patchCompany(company.id, { capital: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Assurance">
                  <input value={company.insurance} onChange={(event) => patchCompany(company.id, { insurance: event.target.value })} />
                </Field>
              </div>
            </Card>

            <Card title="Coordonnées">
              <div className="grid g2">
                <Field label="Adresse" span={2}>
                  <input value={company.address} onChange={(event) => patchCompany(company.id, { address: event.target.value })} />
                </Field>
                <Field label="Code postal">
                  <input value={company.zip} onChange={(event) => patchCompany(company.id, { zip: event.target.value })} />
                </Field>
                <Field label="Ville">
                  <input value={company.city} onChange={(event) => patchCompany(company.id, { city: event.target.value })} />
                </Field>
                <Field label="Téléphone">
                  <input value={company.phone} onChange={(event) => patchCompany(company.id, { phone: event.target.value })} />
                </Field>
                <Field label="E-mail">
                  <input value={company.email} onChange={(event) => patchCompany(company.id, { email: event.target.value })} />
                </Field>
                <Field label="Site web">
                  <input value={company.website} onChange={(event) => patchCompany(company.id, { website: event.target.value })} />
                </Field>
                <Field label="Couleur d’accent">
                  <input type="color" value={company.accent} onChange={(event) => patchCompany(company.id, { accent: event.target.value })} />
                </Field>
              </div>
            </Card>

            <Card title="Banque et facturation">
              <div className="grid g2">
                <Field label="Banque">
                  <input value={company.bank} onChange={(event) => patchCompany(company.id, { bank: event.target.value })} />
                </Field>
                <Field label="IBAN">
                  <input value={company.iban} onChange={(event) => patchCompany(company.id, { iban: event.target.value })} />
                </Field>
                <Field label="BIC">
                  <input value={company.bic} onChange={(event) => patchCompany(company.id, { bic: event.target.value })} />
                </Field>
                <Field label="Délai de paiement (jours)">
                  <input
                    type="number"
                    value={company.paymentTermsDays}
                    onChange={(event) => patchCompany(company.id, { paymentTermsDays: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Taux de pénalités de retard (annuel)" hint="0,1225 = 12,25 % l’an">
                  <input
                    type="number"
                    step={0.0025}
                    value={company.lateFeeRate}
                    onChange={(event) => patchCompany(company.id, { lateFeeRate: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Indemnité de recouvrement (€)">
                  <input
                    type="number"
                    value={company.recoveryFee}
                    onChange={(event) => patchCompany(company.id, { recoveryFee: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Validité des devis (jours)">
                  <input
                    type="number"
                    value={company.quoteValidityDays}
                    onChange={(event) => patchCompany(company.id, { quoteValidityDays: Number(event.target.value) })}
                  />
                </Field>
                <Field label="TVA par défaut (%)">
                  <input
                    type="number"
                    value={company.defaultVatRate}
                    onChange={(event) => patchCompany(company.id, { defaultVatRate: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Conditions générales" span={2} hint="Reprises en bas de chaque devis et facture">
                  <textarea rows={4} value={company.cgv} onChange={(event) => patchCompany(company.id, { cgv: event.target.value })} />
                </Field>
              </div>
            </Card>
          </div>
        ) : null,
      )}

      {tab === 'donnees' ? (
        <div className="stack">
          <Card title="Contenu de la base">
            <div className="grid g4">
              {Object.entries(counts).map(([label, value]) => (
                <div key={label} className="tile">
                  <span className="tile-label">{label}</span>
                  <span className="tile-value">{num(value)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Sauvegarde et restauration" subtitle="Les données vivent dans ce navigateur — exportez régulièrement">
            <div className="row row-wrap" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  downloadFile(`irts-sauvegarde-${today()}.json`, JSON.stringify(db, null, 2), 'application/json');
                  toast('Sauvegarde exportée.', 'succes');
                }}
              >
                Exporter la sauvegarde complète
              </button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                Restaurer depuis un fichier
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importJSON(file);
                  event.target.value = '';
                }}
              />
              <span className="spacer" />
              <button type="button" className="btn btn-danger" onClick={() => setConfirmReset(true)}>
                Réinitialiser avec le jeu de démonstration
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              {/* Le message doit dire ou vivent reellement les donnees : en mode
                  partage, elles sont sur le poste serveur, pas seulement ici. */}
              {sync.status === 'connecte' ? (
                <Badge tone="info" icon="ℹ">
                  Base partagée sur le poste serveur — la sauvegarde exportée est celle de tout le réseau
                </Badge>
              ) : (
                <Badge tone="info" icon="ℹ">
                  Stockage local du navigateur — aucune donnée ne quitte ce poste
                </Badge>
              )}
            </div>
          </Card>

          <Card title="Vider une collection" subtitle="Utile pour repartir d’une base propre en conservant les sociétés">
            <div className="row row-wrap" style={{ gap: 8 }}>
              {(
                [
                  ['clients', 'Clients'],
                  ['docs', 'Devis & factures'],
                  ['deals', 'Affaires'],
                  ['expenses', 'Charges'],
                  ['projects', 'Projets'],
                  ['scenes', 'Scènes 3D'],
                  ['tasks', 'Tâches'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className="btn"
                  onClick={() => {
                    update((draft) => {
                      (draft[key] as unknown[]) = [];
                    });
                    toast(`${label} : collection vidée.`, 'alerte');
                  }}
                >
                  Vider {label.toLowerCase()}
                </button>
              ))}
            </div>
          </Card>

          <Card title="À propos">
            <EmptyState
              mark="🦉"
              title="IRTS Suite"
              hint="Interface de pilotage de Marée Sonore, MSR et Owlaris — prospection, devis, facturation, parc, planning, finance et Studio 3D."
            />
          </Card>
        </div>
      ) : null}

      {domain ? <CategoryManager domain={domain} onClose={() => setDomain(null)} /> : null}

      {confirmReset ? (
        <ConfirmDialog
          title="Réinitialiser toutes les données ?"
          message="La base actuelle sera remplacée par le jeu de démonstration. Exportez une sauvegarde avant de continuer si vous souhaitez conserver votre travail."
          confirmLabel="Réinitialiser"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            replace(createSeedDatabase());
            reset();
            setConfirmReset(false);
            toast('Base réinitialisée.', 'alerte');
          }}
        />
      ) : null}
    </div>
  );
}
