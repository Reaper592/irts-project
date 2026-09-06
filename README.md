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
| **Site de prospection** | Constructeur de pages d'atterrissage (accroche, services, chiffres, témoignages, FAQ), aperçu en direct, export d'un fichier HTML autonome avec formulaire de capture, versement des demandes reçues dans le pipeline. |
| **Clients** | Fiches multi-contacts, conditions négociées (délai, remise, encours autorisé), historique documentaire, chiffre d'affaires et encours par client, export CSV. |
| **Devis** | Éditeur complet : lignes catalogue, packs, import d'une scène 3D, dégressivité de location, remises ligne et globale, acompte, TVA multi-taux, contrôle de disponibilité en temps réel, rentabilité prévisionnelle, signature, conversion en facture, PDF imprimable. |
| **Factures & avoirs** | Facturation, règlements partiels, statuts recalculés (partiel, payé, en retard), pénalités de retard au taux légal et indemnité de recouvrement, avoirs, relances planifiées, export comptable CSV. |
| **Studio 3D** | Construction de l'environnement du client en temps réel — salle, plein air, chapiteau, club — implantation du matériel du catalogue, faisceaux volumétriques dans le brouillard, jauge instanciée, cadrages types, export PNG, fiche d'implantation client et génération du devis correspondant. |
| **Projets** | Chaque événement avec sa check-list de préparation, son équipe, ses documents, ses frais imputés et sa marge réelle. |
| **Planning** | Calendrier mensuel des exploitations, chronologie des projets, disponibilité du parc sur une période avec taux de charge par référence. |
| **Catalogue & parc** | Références de location, vente, prestation et forfait ; numéros de série et états ; barèmes dégressifs ; packs commerciaux ; rendement du parc et détection du matériel sous-exploité. |
| **Maintenance** | Tickets préventifs, curatifs et contrôles réglementaires ; l'ouverture d'un ticket retire le matériel des disponibilités. |
| **Équipe** | Permanents, intermittents et prestataires, coûts et tarifs journaliers, affectations aux projets, couverture des compétences et points de fragilité. |
| **Finance** | Compte de résultat par société et consolidé, trésorerie facturée contre encaissée, journal des charges, point mort, TVA collectée et déductible. |
| **Tâches** | Relances et engagements, reliés au document ou à l'affaire concernée. |
| **Paramètres** | Identité légale et bancaire des trois sociétés, mentions et CGV, numérotation continue, objectifs annuels, sauvegarde et restauration. |

## Démarrer

```bash
npm install
npm run dev        # serveur de développement
npm run build      # build de production dans dist/
npm run preview    # prévisualisation du build
npm run typecheck  # vérification TypeScript
npm run lint       # oxlint
```

Le build produit un site statique dans `dist/`, déployable tel quel sur
n'importe quel hébergeur.

## Choix techniques

- **React 19 + TypeScript + Vite.** Pas de framework applicatif : un magasin
  d'état unique (`src/core/store.tsx`) et un routage par vue suffisent.
- **Stockage local.** Les données vivent dans le `localStorage` du navigateur,
  derrière une interface unique (`update(draft => …)`). Aucune donnée ne quitte
  le poste. Pour brancher un back-office, il n'y a qu'un point à remplacer : la
  persistance du magasin. Les paramètres offrent l'export et la restauration
  d'une sauvegarde JSON complète.
- **Three.js** pour le Studio, chargé à la demande : le moteur 3D ne pèse sur
  aucune autre vue. Pipeline PBR complet — environnement IBL, tone mapping ACES
  filmique, ombres douces, halo sélectif, faisceaux volumétriques et foule
  instanciée pour l'échelle.
- **Graphiques faits main en SVG.** Palette catégorielle validée pour la vision
  des couleurs sur la surface sombre de l'application, un seul axe de valeurs
  par graphique, légende dès deux séries, étiquettes directes parcimonieuses et
  couche de survol partout.
- **Règles métier isolées** dans `src/core/calc.ts` : dégressivité de location,
  totaux et TVA multi-taux, statut effectif d'un document, pénalités de retard,
  disponibilité et taux d'occupation du parc, coût de revient par nature de
  ligne, agrégats financiers mensuels.

## Structure

```
src/
  core/       modèle de données, calculs métier, magasin, génération de documents
  ui/         composants d'interface et graphiques
  modules/    une vue par module métier
  modules/studio/  moteur de rendu 3D et son interface
  styles/     socle visuel
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
- La sauvegarde est locale : exportez régulièrement depuis **Paramètres →
  Données**.
