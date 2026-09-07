/**
 * Modele de donnees de la suite IRTS.
 * Trois entites juridiques partagent le meme socle : Maree Sonore (prestation),
 * MSR / Maree Sonore Rental (location de parc) et Owlaris (conception & integration).
 */

export type EntityId = 'maree-sonore' | 'msr' | 'owlaris';

export type Scope = EntityId | 'groupe';

export interface Company {
  id: EntityId;
  name: string;
  legalName: string;
  tagline: string;
  activity: string;
  accent: string;
  accentSoft: string;
  mark: string;
  siret: string;
  rcs: string;
  ape: string;
  vatNumber: string;
  capital: number;
  address: string;
  zip: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  iban: string;
  bic: string;
  bank: string;
  insurance: string;
  /** Delai de paiement par defaut, en jours. */
  paymentTermsDays: number;
  /** Taux des penalites de retard (annuel, ex. 0.1225). */
  lateFeeRate: number;
  /** Indemnite forfaitaire de recouvrement (40 EUR en France). */
  recoveryFee: number;
  quotePrefix: string;
  invoicePrefix: string;
  creditPrefix: string;
  defaultVatRate: number;
  quoteValidityDays: number;
  cgv: string;
}


/* ------------------------------------------------------------- taxonomie */

/**
 * Domaines de classement geres par l'utilisateur. Chaque domaine possede sa
 * propre liste de categories, creables, renommables et supprimables depuis
 * l'interface, avec les parametres qu'elles imposent a leurs elements.
 */
export type TaxonomyDomain =
  | 'catalogue'
  | 'objet3d'
  | 'charge'
  | 'source'
  | 'competence'
  | 'projet'
  | 'client'
  | 'etiquette';

export type FieldKind = 'texte' | 'nombre' | 'booleen' | 'liste';

/** Parametre additionnel porte par tous les elements d'une categorie. */
export interface CategoryField {
  id: string;
  label: string;
  kind: FieldKind;
  /** Valeurs proposees pour un parametre de type liste. */
  options: string[];
  unit: string;
  defaultValue: string;
  required: boolean;
}

export interface Category {
  id: string;
  domain: TaxonomyDomain;
  /** Portee : une societe, ou « groupe » pour une categorie partagee. */
  entity: EntityId | 'groupe';
  label: string;
  color: string;
  icon: string;
  parentId: string | null;
  order: number;
  fields: CategoryField[];
  archived: boolean;
  notes: string;
}

export type ClientKind = 'pro' | 'particulier' | 'collectivite' | 'association';
export type ClientStatus = 'prospect' | 'actif' | 'inactif' | 'bloque';

export interface Contact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  primary: boolean;
}

export interface Client {
  id: string;
  entity: EntityId;
  kind: ClientKind;
  name: string;
  status: ClientStatus;
  contacts: Contact[];
  email: string;
  phone: string;
  address: string;
  zip: string;
  city: string;
  country: string;
  siret: string;
  vatNumber: string;
  source: string;
  tags: string[];
  /** Remise permanente negociee, en pourcentage. */
  discountRate: number;
  paymentTermsDays: number;
  /** Encours maximum autorise en EUR TTC. */
  creditLimit: number;
  rating: number;
  notes: string;
  createdAt: string;
}

export type DealStage =
  | 'nouveau'
  | 'contacte'
  | 'qualifie'
  | 'devis'
  | 'negociation'
  | 'gagne'
  | 'perdu';

export interface Activity {
  id: string;
  date: string;
  type: 'appel' | 'email' | 'rdv' | 'note' | 'relance' | 'visite';
  summary: string;
  author: string;
}

export interface Deal {
  id: string;
  entity: EntityId;
  title: string;
  clientId: string | null;
  prospectName: string;
  contactEmail: string;
  contactPhone: string;
  stage: DealStage;
  value: number;
  probability: number;
  source: string;
  owner: string;
  expectedDate: string;
  nextAction: string;
  nextActionDate: string;
  lostReason: string;
  landingPageId: string | null;
  activities: Activity[];
  createdAt: string;
}

export type ProductMode = 'location' | 'vente' | 'service' | 'forfait';
export type GearState = 'ok' | 'maintenance' | 'hs' | 'reserve';

export interface SerialItem {
  id: string;
  serial: string;
  state: GearState;
  purchaseDate: string;
  purchasePrice: number;
  lastMaintenance: string;
  note: string;
}

export interface DegressiveStep {
  minDays: number;
  coef: number;
}

export interface Product {
  id: string;
  entity: EntityId;
  ref: string;
  name: string;
  brand: string;
  model: string;
  /** Libelle de categorie, aligne sur la taxonomie « catalogue ». */
  category: string;
  /** Identifiant de la categorie geree, quand elle est renseignee. */
  categoryId: string | null;
  /** Valeurs des parametres definis par la categorie. */
  attributes: Record<string, string>;
  mode: ProductMode;
  unit: string;
  /** Prix de location HT pour une journee. */
  priceDay: number;
  /** Prix de vente HT. */
  priceSale: number;
  /** Cout d'achat / cout de revient HT. */
  cost: number;
  vatRate: number;
  stock: number;
  weightKg: number;
  powerW: number;
  specs: Record<string, string>;
  degressive: DegressiveStep[];
  mark: string;
  /** Cle du modele 3D utilise dans le Studio. null = non representable. */
  model3d: string | null;
  serials: SerialItem[];
  active: boolean;
}

export interface PackLine {
  productId: string;
  qty: number;
}

export interface Pack {
  id: string;
  entity: EntityId;
  name: string;
  description: string;
  category: string;
  lines: PackLine[];
  /** Remise appliquee au pack, en pourcentage. */
  discountPct: number;
  mark: string;
}

export type DocKind = 'devis' | 'facture' | 'avoir';
export type DocStatus =
  | 'brouillon'
  | 'envoye'
  | 'accepte'
  | 'refuse'
  | 'expire'
  | 'partiel'
  | 'paye'
  | 'retard'
  | 'annule';

export interface DocLine {
  id: string;
  productId: string | null;
  designation: string;
  description: string;
  qty: number;
  /** Nombre de jours de location. 1 pour la vente et les services. */
  days: number;
  unitPrice: number;
  discountPct: number;
  vatRate: number;
  /** Applique le coefficient degressif du produit sur la duree. */
  degressive: boolean;
  kind: ProductMode;
}

export interface Payment {
  id: string;
  date: string;
  amount: number;
  method: 'virement' | 'cb' | 'cheque' | 'especes' | 'prelevement';
  reference: string;
}

export interface BusinessDoc {
  id: string;
  entity: EntityId;
  kind: DocKind;
  number: string;
  clientId: string;
  projectId: string | null;
  dealId: string | null;
  sceneId: string | null;
  /** Devis dont provient la facture. */
  sourceDocId: string | null;
  title: string;
  date: string;
  /** Date de validite (devis) ou d'echeance (facture). */
  dueDate: string;
  status: DocStatus;
  lines: DocLine[];
  globalDiscountPct: number;
  depositPct: number;
  /** Frais de livraison / transport HT. */
  shipping: number;
  eventStart: string;
  eventEnd: string;
  venue: string;
  notes: string;
  terms: string;
  payments: Payment[];
  sentAt: string | null;
  signedAt: string | null;
  signedBy: string;
  createdAt: string;
}

export type ProjectStatus = 'preparation' | 'confirme' | 'en-cours' | 'termine' | 'annule';

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  owner: string;
}

export interface Project {
  id: string;
  entity: EntityId;
  name: string;
  clientId: string;
  status: ProjectStatus;
  start: string;
  end: string;
  venue: string;
  address: string;
  categoryId: string | null;
  /** Budget de vente HT vise. */
  budget: number;
  manager: string;
  checklist: ChecklistItem[];
  notes: string;
}

export type StaffStatus = 'salarie' | 'intermittent' | 'freelance' | 'apprenti';

export interface Staff {
  id: string;
  entity: EntityId;
  name: string;
  role: string;
  status: StaffStatus;
  /** Cout journalier charge, HT. */
  dailyCost: number;
  /** Tarif journalier facture au client, HT. */
  dailyRate: number;
  skills: string[];
  email: string;
  phone: string;
  active: boolean;
}

export interface Assignment {
  id: string;
  entity: EntityId;
  projectId: string;
  staffId: string;
  start: string;
  end: string;
  role: string;
}

/** Categorie de charge : identifiant d'une categorie du domaine « charge ». */
export type ExpenseCategory = string;

export interface Expense {
  id: string;
  entity: EntityId;
  date: string;
  label: string;
  category: ExpenseCategory;
  amountHT: number;
  vatRate: number;
  supplier: string;
  projectId: string | null;
  method: string;
  recurring: boolean;
}

export type TicketType = 'preventive' | 'curative' | 'controle';
export type TicketStatus = 'ouvert' | 'en-cours' | 'clos';

export interface MaintenanceTicket {
  id: string;
  entity: EntityId;
  productId: string;
  serialId: string | null;
  type: TicketType;
  status: TicketStatus;
  openedAt: string;
  closedAt: string | null;
  cost: number;
  description: string;
  technician: string;
}

export interface LandingSection {
  id: string;
  kind: 'texte' | 'services' | 'galerie' | 'chiffres' | 'temoignages' | 'faq';
  title: string;
  body: string;
  /** Items serialises "titre | detail" separes par des retours a la ligne. */
  items: string[];
}

export interface LandingPage {
  id: string;
  entity: EntityId;
  slug: string;
  title: string;
  heroTitle: string;
  heroSubtitle: string;
  ctaLabel: string;
  ctaTarget: string;
  sections: LandingSection[];
  palette: 'nuit' | 'maree' | 'ambre' | 'clair';
  published: boolean;
  views: number;
  createdAt: string;
}

export type VenueType = 'salle' | 'plein-air' | 'chapiteau' | 'club' | 'eglise' | 'showroom';

/** Forme de l'emprise du terrain. */
export type GroundShape = 'rectangle' | 'l' | 'cercle' | 'ovale' | 'polygone';

export interface GroundPoint {
  x: number;
  z: number;
}

/**
 * Surface dessinee a l'interieur du terrain : plancher, piste, allee gravier,
 * zone bar. Chaque zone a son contour libre, sa nature de sol et sa hauteur.
 */
export interface SurfaceZone {
  id: string;
  label: string;
  /** Nature de sol, parmi celles du terrain. */
  ground: string;
  polygon: GroundPoint[];
  /** Hauteur du plancher au-dessus du terrain, en metres. */
  elevation: number;
  visible: boolean;
}

export interface SceneItem {
  id: string;
  productId: string | null;
  model3d: string;
  label: string;
  categoryId: string | null;
  qty: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Inclinaison, en radians : lyres accrochees, ecrans, pentes. */
  rotX: number;
  scale: number;
  /** Dimensions imposees en metres. Absentes = dimensions nominales du modele. */
  width: number | null;
  height: number | null;
  depth: number | null;
  color: string;
  /** Intensite du faisceau pour les projecteurs (0 = eteint). */
  beam: number;
  /** Objet verrouille : ni deplacable ni redimensionnable a la souris. */
  locked: boolean;
  notes: string;
}

export interface Scene {
  id: string;
  entity: EntityId;
  name: string;
  clientId: string | null;
  projectId: string | null;
  venueType: VenueType;
  width: number;
  depth: number;
  height: number;
  audience: number;
  ambient: number;
  haze: number;
  exposure: number;
  bloom: number;
  timeOfDay: 'jour' | 'crepuscule' | 'nuit';
  floorTone: string;
  wallTone: string;
  groundShape: GroundShape;
  /** Sommets de l'emprise, en metres, pour la forme « polygone ». */
  polygon: GroundPoint[];
  /** Surfaces dessinees a l'interieur du terrain. */
  zones: SurfaceZone[];
  /** Pas d'accrochage de la grille, en metres. 0 = accrochage desactive. */
  gridSnap: number;
  showGrid: boolean;
  /** Qualite de rendu : « rapide » privilegie la fluidite, « photo » l'image. */
  quality: 'rapide' | 'equilibre' | 'photo';
  /** Azimut du soleil en degres, pour l'ombre portee en exterieur. */
  sunAzimuth: number;
  items: SceneItem[];
  notes: string;
  createdAt: string;
}

export interface TaskItem {
  id: string;
  entity: EntityId;
  label: string;
  detail: string;
  due: string;
  done: boolean;
  priority: 'basse' | 'normale' | 'haute';
  owner: string;
  linkKind: 'client' | 'devis' | 'facture' | 'projet' | 'lead' | null;
  linkId: string | null;
}

export interface Settings {
  activeScope: Scope;
  numbering: Record<EntityId, { devis: number; facture: number; avoir: number }>;
  vatRates: number[];
  fiscalYearStart: string;
  currency: string;
  locale: string;
  /** Objectif de chiffre d'affaires HT annuel par entite. */
  revenueTargets: Record<EntityId, number>;
  operator: string;
  /** Nom du poste affiche aux autres utilisateurs connectes. */
  station: string;
}

export interface Database {
  version: number;
  companies: Company[];
  clients: Client[];
  deals: Deal[];
  products: Product[];
  packs: Pack[];
  docs: BusinessDoc[];
  projects: Project[];
  staff: Staff[];
  assignments: Assignment[];
  expenses: Expense[];
  tickets: MaintenanceTicket[];
  pages: LandingPage[];
  scenes: Scene[];
  tasks: TaskItem[];
  categories: Category[];
  settings: Settings;
}
