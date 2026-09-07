# IRTS Suite

Interface unique de pilotage des trois sociétés du groupe : **Marée Sonore**
(prestation et régie technique), **MSR — Marée Sonore Rental** (location de parc
son, lumière, vidéo et structure) et **Owlaris** (ingénierie, conception 3D et
intégration audiovisuelle).

L'application couvre la chaîne complète : capter la demande, la qualifier, la
chiffrer, la montrer au client en 3D, l'exploiter, la facturer, l'encaisser et
en mesurer la rentabilité.

## Modules

| Module | Ce qu'il fait |
|---|---|
| **Pilotage** | Chiffre d'affaires glissant contre objectif, marge brute, encours, pipeline pondéré, taux de transformation, occupation du parc, alertes de sur-réservation, échéances et tâches du jour. |
| **Prospection** | Pipeline en kanban glissé-déposé sur sept étapes, historique d'activité par affaire, entonnoir de conversion, origine des affaires, motifs de perte, création de devis en un clic. |
| **Site de prospection** | Constructeur de pages d'atterrissage (accroche, services, chiffres, témoignages, FAQ), aperçu en direct, export d'un fichier HTML autonome dont le formulaire poste au serveur IRTS : la demande entre au pipeline comme affaire « nouveau » et apparaît sur les postes connectés sans rechargement. |
| **Clients** | Fiches multi-contacts, conditions négociées (délai, remise, encours autorisé), historique documentaire, chiffre d'affaires et encours par client, export CSV. |
| **Devis** | Éditeur complet : lignes catalogue, packs, import d'une scène 3D, dégressivité de location, remises ligne et globale, acompte, TVA multi-taux, contrôle de disponibilité en temps réel, rentabilité prévisionnelle, signature, conversion en facture, PDF imprimable. |
| **Factures & avoirs** | Facturation, règlements partiels, statuts recalculés (partiel, payé, en retard), pénalités de retard au taux légal et indemnité de recouvrement, avoirs, relances planifiées, export comptable CSV. |
| **Studio 3D** | Terrain dessiné point par point, surfaces libres, sélection multiple, répétition en réseau, décamètre, calques par famille. Construction de l'environnement du client en temps réel — salle, plein air, chapiteau, club — implantation du matériel du catalogue, faisceaux volumétriques dans le brouillard, jauge instanciée, cadrages types, export PNG, fiche d'implantation client et génération du devis correspondant. |
| **Projets** | Chaque événement avec sa check-list de préparation, son équipe, ses documents, ses frais imputés et sa marge réelle. |
| **Planning** | Calendrier mensuel des exploitations, chronologie des projets, disponibilité du parc sur une période avec taux de charge par référence. |
| **Catalogue & parc** | Références de location, vente, prestation et forfait ; numéros de série et états ; barèmes dégressifs ; packs commerciaux ; rendement du parc et détection du matériel sous-exploité. |
| **Maintenance** | Tickets préventifs, curatifs et contrôles réglementaires ; l'ouverture d'un ticket retire le matériel des disponibilités. |
| **Équipe** | Permanents, intermittents et prestataires, coûts et tarifs journaliers, affectations aux projets, couverture des compétences et points de fragilité. |
| **Finance** | Compte de résultat par société et consolidé, trésorerie facturée contre encaissée, journal des charges, point mort, TVA collectée et déductible. |
| **Tâches** | Relances et engagements, reliés au document ou à l'affaire concernée. |
| **Paramètres** | Identité légale et bancaire des trois sociétés, mentions et CGV, numérotation continue, objectifs annuels, gestion des catégories, état du partage réseau, sauvegarde et restauration. |

## Démarrer

```bash
npm install
npm run build      # construit l'application
npm start          # sert l'application et la base partagée sur le réseau
```

Le terminal affiche l'adresse à ouvrir, par exemple `http://192.168.1.20:8080`.
**Chaque ordinateur du réseau ouvre cette adresse : tous travaillent sur la même
base et voient les modifications des autres en direct.** Sans serveur joignable,
l'application fonctionne seule sur le poste avec sa base locale.

```bash
npm run dev        # serveur de développement (relaie /api vers le serveur)
npm run serve      # build puis démarrage du serveur partagé
npm run preview    # prévisualisation du build statique
npm run typecheck  # vérification TypeScript
npm run lint       # oxlint
```

### Mise en réseau

Le serveur (`server/index.js`, sans aucune dépendance) sert l'application
construite et expose une base commune :

- `GET /api/etat` — la base et sa révision ;
- `POST /api/ops` — les modifications, fiche par fiche ;
- `GET /api/flux` — le flux d'événements qui prévient les autres postes.

La fusion se fait par enregistrement : deux personnes qui éditent deux clients
différents ne s'écrasent jamais ; sur la même fiche, la dernière écriture
l'emporte. La base vit dans `data/irts-db.json`, écrite de façon atomique.
Pour un accès depuis l'extérieur, publiez ce port derrière votre routeur ou un
tunnel HTTPS.

## Choix techniques

- **React 19 + TypeScript + Vite.** Pas de framework applicatif : un magasin
  d'état unique (`src/core/store.tsx`) et un routage par vue suffisent.
- **Base partagée ou locale.** Quand un serveur IRTS est joignable, tous les
  postes travaillent sur la même base et sont prévenus en direct ; sinon
  l'application retombe sur le `localStorage` du navigateur. Les deux modes
  passent par la même interface (`update(draft => …)`), et les paramètres
  offrent l'export et la restauration d'une sauvegarde JSON complète.
- **Catégories gérées par l'utilisateur.** Huit domaines — catalogue, familles
  d'objets 3D, charges, origines d'affaires, compétences, types de projets,
  segments clients, étiquettes — se règlent depuis leur propre menu ou depuis
  les paramètres : nom, couleur, pictogramme, portée et paramètres imposés aux
  fiches. À la suppression, l'application demande vers quelle catégorie
  reclasser les éléments.
- **Three.js** pour le Studio, chargé à la demande : le moteur 3D ne pèse sur
  aucune autre vue. Pipeline PBR complet — tone mapping ACES filmique, ombres
  portées cadrées sur l'emprise, occlusion ambiante en espace écran calibrée sur
  la taille du site, halo appliqué après la conversion en sRGB, faisceaux
  volumétriques et foule instanciée avec de vraies silhouettes.
  L'éclairage indirect est capté depuis le ciel de la scène : un environnement
  de studio d'intérieur avait été essayé, son irradiance effaçait les ombres en
  extérieur.
- **Graphiques faits main en SVG.** Palette catégorielle validée pour la vision
  des couleurs sur la surface sombre de l'application, un seul axe de valeurs
  par graphique, légende dès deux séries, étiquettes directes parcimonieuses et
  couche de survol partout.
- **Règles métier isolées** dans `src/core/calc.ts` : dégressivité de location,
  totaux et TVA multi-taux, statut effectif d'un document, pénalités de retard,
  disponibilité et taux d'occupation du parc, coût de revient par nature de
  ligne, agrégats financiers mensuels.

## Le Studio en pratique

Chaque objet de la bibliothèque porte à la fois son modèle 3D et sa fiche
produit : marque, modèle, unité de facturation, prix, poids et puissance. Le
catalogue de l'application est **généré depuis cette bibliothèque** — cent
vingt-sept objets, treize familles — si bien qu'un objet posé dans une scène
arrive dans le devis sans ressaisie, avec sa désignation, ses cotes réelles et
son prix. Une base déjà en service reçoit les objets ajoutés d'une version à
l'autre : la migration complète le catalogue sans écraser les prix ni les
stocks ajustés. Les quantités facturées suivent la
nature de l'objet : un bar au mètre de comptoir, un mur LED à la dalle, une
piste de danse au mètre carré, une guirlande à la longueur, un bloc de sièges à
la place.

### Dessiner le terrain

L'emprise n'est pas limitée à un rectangle. Un préréglage donne le point de
départ — rectangle, forme en L, cercle, ovale — puis **✎ Dessiner le contour**
bascule en vue en plan et affiche les poignées : un point bleu par sommet, un
point clair au milieu de chaque segment.

- glisser un point bleu déplace le sommet ;
- glisser un point clair insère un nouveau sommet à cet endroit ;
- `Suppr` sur un point survolé le retire (le contour garde au moins 3 sommets).

L'accrochage suit le pas de la grille et la surface se recalcule en direct.

Sous le contour du site, la section **Surfaces** ajoute autant de zones que
nécessaire — plancher, piste de danse, allée gravier, terrasse — chacune avec
son propre contour libre, sa nature de sol et sa hauteur. Une zone surélevée est
extrudée et porte ses ombres ; une zone masquée reste dans la scène sans être
rendue.

### Sélection multiple, réseau, décamètre, calques

**Maj+clic** ajoute ou retire un objet de la sélection, `Ctrl+A` prend toute la
scène, et le clic sur une famille dans les calques prend d'un coup tout un
corps de métier. Dès qu'il y a plusieurs objets, le gizmo se pose sur un pivot
virtuel au centre de la sélection : le déplacement et l'échelle s'appliquent au
groupe entier, la rotation se fait autour de la verticale. Aucun objet n'est
reparenté, donc les coordonnées du modèle restent celles du terrain.

**⊞ Répéter en réseau** recopie la sélection sur une grille — nombre de
colonnes, nombre de rangées, pas dans chaque direction. Le pas proposé est
l'emprise de la sélection : trente tables ou une ligne de barrières se posent
en une fois.

**📏 Décamètre** (`M`) mesure au sol clic par clic : chaque segment porte sa
longueur, une chaîne affiche son cumul, `Suppr` retire le dernier point et
`Échap` referme l'outil. C'est ce qu'on cherche pour vérifier un passage
pompier ou le recul devant une scène.

**Calques** masque une famille entière — le son, les sanitaires, la structure —
pour montrer une seule couche au client. Les objets masqués restent dans la
scène et dans le devis : isoler un corps de métier ne doit pas fausser le
chiffrage.

Une scène s'exporte en JSON et se réimporte : le fichier passe par la même
normalisation que la base, reçoit des identifiants neufs pour ne rien écraser,
et un export d'une version antérieure s'ouvre sans manquer une emprise, une
qualité de rendu ou un calque.

Raccourcis : `D` déplacer · `R` tourner · `T` dimensionner · `M` décamètre ·
`P` vue en plan · `G` grille · `Ctrl+A` tout sélectionner · `Suppr` supprimer ·
`Ctrl+Z` annuler.

### Chaîne de rendu

Rendu direct puis occlusion ambiante en espace écran (GTAO), sortie tonemappée,
halo, antialiasing SMAA et étalonnage final — vignettage, aberration
chromatique et grain. La courbe de tone mapping est la courbe neutre PBR de
Khronos, qui garde la couleur exacte des matériaux dans les tons moyens là où
ACES sature et où AgX délave. L'éclairage indirect est capturé depuis le ciel
de la scène et le rebond du sol, jamais depuis un environnement de studio : une
irradiance d'intérieur débouche les ombres au point de les faire disparaître en
extérieur. Le brouillard prend la couleur de l'horizon, ce qui fond le sol
lointain dans la voûte au lieu de l'arrêter sur une arête.

Le Studio tient la charge : environ 330 ms pour bâtir une scène de 1 200
objets, et la mémoire vidéo reste stable au fil des manipulations. C'est une
propriété qui se vérifie, pas qui se suppose : three.js ne libère rien tout
seul, et la scène est reconstruite à chaque déplacement d'objet. Le moteur
libère donc les mailles et les textures fabriquées pour la construction
précédente — celles du cache portent la marque `shared` et survivent — et ne
rebâtit la chaîne de rendu qu'au changement réel de qualité.

Le moteur expose deux relevés pour le support et les tests de non-régression :
`window.irtsStudio.diagnostics()` donne l'état des ombres, des passes de rendu
et de l'éclairage ; `window.irtsStudio.contactReport()` donne, pour chaque
objet posé, la hauteur du bas de sa boîte englobante ainsi que les cotes
réellement occupées face aux cotes annoncées au devis.

Deux règles s'y vérifient. Un objet posé au sol lit zéro — seuls les objets
accrochés (guirlandes, fanions, ponts, lyres) descendent sous leur point
d'accroche. Et les cotes occupées valent les cotes annoncées : c'est
indispensable pour les objets non paramétriques, dont le redimensionnement
divise par la cote nominale — une maille qui ne la respecte pas fait mentir le
devis *et* l'outil « Dimensionner ». Seuls dépassent les éléments qui sortent
réellement de l'enveloppe du produit : la flamme d'un brasero, le trépied
déployé d'un pied d'enceinte, la flèche d'un pied de micro, l'affaissement
d'une guirlande, les haubans et ancrages d'une tente stretch.

Le gizmo repose automatiquement un objet dont la maille passerait sous le
terrain, et le bouton **⤓ Poser au sol** rattrape une hauteur saisie à la main.

## Structure

```
server/index.js   serveur de partage réseau et hébergement de l'application
src/
  core/           modèle de données, calculs métier, magasin, synchronisation,
                  génération de documents
  ui/             composants d'interface, graphiques, gestion des catégories
  modules/        une vue par module métier
  modules/studio/ bibliothèque d'objets, modèles 3D, matériaux, moteur de rendu
                  et interface du Studio
  styles/         socle visuel
data/             base partagée écrite par le serveur
```

## Données de démonstration

Au premier lancement, la base est remplie d'un jeu cohérent : trois sociétés
avec leur identité légale complète, une trentaine de références de catalogue,
douze clients, trente mois d'historique de facturation et de charges, des devis
gagnés et perdus, des projets, des affectations, des tickets de maintenance,
trois pages de prospection et trois implantations 3D. Les paramètres permettent
de vider une collection ou de tout réinitialiser.

## Points d'attention

- Les calculs de TVA et le compte de résultat donnent un ordre de grandeur pour
  piloter ; ils ne remplacent pas la comptabilité de l'expert-comptable.
- Le coût de revient d'une ligne de location amortit le matériel sur une durée
  de vie commerciale exprimée en journées louées (`RENTAL_LIFE_DAYS`) et ajoute
  une part de manutention (`HANDLING_RATE`). Ces deux constantes sont à caler
  sur la réalité du parc.
- En mode partagé, la base vit sur le poste serveur (`data/irts-db.json`) :
  sauvegardez ce fichier, ou exportez depuis **Paramètres → Données**.
- Le formulaire d'une page de prospection poste sur `/api/prospect`. Une page
  exportée puis hébergée ailleurs garde l'adresse absolue du serveur ; si
  l'envoi échoue malgré tout, la demande reste dans le navigateur du visiteur
  et la page affiche le téléphone — mieux vaut un appel qu'une demande perdue
  en silence.
- Le serveur n'a ni comptes ni mots de passe : il est prévu pour un réseau de
  confiance. Avant toute exposition sur Internet, placez-le derrière une
  authentification et du HTTPS.
- Les prix et références du catalogue sont réalistes mais indicatifs : calez-les
  sur vos tarifs avant de les présenter à un client.
