import type { ReactNode } from 'react';
import { Badge, type Tone } from './kit';
import type { Client, DealStage, DocStatus, EntityId, ProjectStatus } from '../core/types';
import { useStore } from '../core/store';
import { initials } from '../core/utils';

const DOC_STATUS: Record<DocStatus, { label: string; tone: Tone; icon: string }> = {
  brouillon: { label: 'Brouillon', tone: 'neutre', icon: '✎' },
  envoye: { label: 'Envoyé', tone: 'info', icon: '➤' },
  accepte: { label: 'Accepté', tone: 'good', icon: '✔' },
  refuse: { label: 'Refusé', tone: 'critical', icon: '✕' },
  expire: { label: 'Expiré', tone: 'warning', icon: '⏳' },
  partiel: { label: 'Partiel', tone: 'warning', icon: '◐' },
  paye: { label: 'Payé', tone: 'good', icon: '✔' },
  retard: { label: 'En retard', tone: 'critical', icon: '⚠' },
  annule: { label: 'Annulé', tone: 'neutre', icon: '⊘' },
};

export function DocStatusBadge({ status }: { status: DocStatus }) {
  const config = DOC_STATUS[status];
  return (
    <Badge tone={config.tone} icon={config.icon}>
      {config.label}
    </Badge>
  );
}

export const STAGES: { id: DealStage; label: string; tone: Tone; short: string }[] = [
  { id: 'nouveau', label: 'Nouveau', tone: 'neutre', short: 'NEW' },
  { id: 'contacte', label: 'Contacté', tone: 'info', short: 'CTC' },
  { id: 'qualifie', label: 'Qualifié', tone: 'info', short: 'QLF' },
  { id: 'devis', label: 'Devis envoyé', tone: 'accent', short: 'DEV' },
  { id: 'negociation', label: 'Négociation', tone: 'warning', short: 'NEG' },
  { id: 'gagne', label: 'Gagné', tone: 'good', short: 'WIN' },
  { id: 'perdu', label: 'Perdu', tone: 'critical', short: 'KO' },
];

export function StageBadge({ stage }: { stage: DealStage }) {
  const config = STAGES.find((entry) => entry.id === stage)!;
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: Tone; icon: string }> = {
  preparation: { label: 'En préparation', tone: 'info', icon: '◔' },
  confirme: { label: 'Confirmé', tone: 'accent', icon: '✔' },
  'en-cours': { label: 'En cours', tone: 'warning', icon: '▶' },
  termine: { label: 'Terminé', tone: 'good', icon: '✔' },
  annule: { label: 'Annulé', tone: 'neutre', icon: '⊘' },
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const config = PROJECT_STATUS[status];
  return (
    <Badge tone={config.tone} icon={config.icon}>
      {config.label}
    </Badge>
  );
}

/** Pastille de societe : l'entite doit rester lisible en vue consolidee. */
export function EntityChip({ entity, full }: { entity: EntityId; full?: boolean }) {
  const { companyOf } = useStore();
  const company = companyOf(entity);
  return (
    <span className="chip" style={{ borderColor: company.accent, color: 'var(--ink-2)' }}>
      <span className="scope-dot" style={{ background: company.accent }} />
      {full ? company.name : company.mark}
    </span>
  );
}

export function ClientCell({ client }: { client: Client | undefined }) {
  if (!client) return <span className="dim">Client supprimé</span>;
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="avatar">{initials(client.name)}</span>
      <div style={{ minWidth: 0 }}>
        <div className="truncate">{client.name}</div>
        <div className="small dim truncate">{client.city}</div>
      </div>
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row" style={{ gap: 12, padding: '5px 0', borderBottom: '1px solid var(--line-soft)' }}>
      <span className="small muted" style={{ minWidth: 132 }}>
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

export function Stars({ value }: { value: number }) {
  return (
    <span title={`${value} sur 5`} aria-label={`${value} sur 5`} style={{ color: '#c98500', letterSpacing: 1 }}>
      {'★'.repeat(value)}
      <span className="dim">{'★'.repeat(5 - value)}</span>
    </span>
  );
}
