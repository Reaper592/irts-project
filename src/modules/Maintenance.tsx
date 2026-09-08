import { useMemo, useState } from 'react';
import { useStore } from '../core/store';
import type { EntityId, MaintenanceTicket, TicketStatus, TicketType } from '../core/types';
import { daysBetween, formatDate, money, money0, sum, today, uid } from '../core/utils';
import { Badge, Card, ConfirmDialog, DataTable, EmptyState, Field, Modal, PageHeader, type Column } from '../ui/kit';
import { BarList, StatTile } from '../ui/charts';
import { EntityChip } from '../ui/shared';

const TYPE_LABEL: Record<TicketType, string> = {
  preventive: 'Préventive',
  curative: 'Curative',
  controle: 'Contrôle réglementaire',
};

const STATUS_TONE: Record<TicketStatus, 'critical' | 'warning' | 'good'> = {
  ouvert: 'critical',
  'en-cours': 'warning',
  clos: 'good',
};

function emptyTicket(entity: EntityId, productId: string): MaintenanceTicket {
  return {
    id: uid('tk'),
    entity,
    productId,
    serialId: null,
    type: 'curative',
    status: 'ouvert',
    openedAt: today(),
    closedAt: null,
    cost: 0,
    description: '',
    technician: '',
  };
}

export default function Maintenance() {
  const { db, scope, visible, update, defaultEntity, toast } = useStore();
  const [draft, setDraft] = useState<MaintenanceTicket | null>(null);
  const [filter, setFilter] = useState<'tous' | TicketStatus>('tous');

  const tickets = useMemo(
    () =>
      visible(db.tickets)
        .filter((ticket) => (filter === 'tous' ? true : ticket.status === filter))
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    [db.tickets, visible, filter],
  );

  const stats = useMemo(() => {
    const all = visible(db.tickets);
    const open = all.filter((ticket) => ticket.status !== 'clos');
    const closed = all.filter((ticket) => ticket.status === 'clos' && ticket.closedAt);
    const byProduct = new Map<string, number>();
    for (const ticket of all) {
      const name = db.products.find((product) => product.id === ticket.productId)?.name ?? 'Inconnu';
      byProduct.set(name, (byProduct.get(name) ?? 0) + ticket.cost);
    }
    const immobilised = visible(db.products).reduce(
      (acc, product) => acc + product.serials.filter((serial) => serial.state !== 'ok').length,
      0,
    );
    return {
      open: open.length,
      cost: sum(all, (ticket) => ticket.cost),
      immobilised,
      averageDelay: closed.length
        ? sum(closed, (ticket) => daysBetween(ticket.openedAt, ticket.closedAt!)) / closed.length
        : 0,
      byProduct: [...byProduct.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8),
    };
  }, [db.tickets, db.products, visible]);

  const columns: Column<MaintenanceTicket>[] = [
    {
      key: 'product',
      header: 'Matériel',
      sort: (row) => db.products.find((product) => product.id === row.productId)?.name ?? '',
      cell: (row) => {
        const product = db.products.find((entry) => entry.id === row.productId);
        const serial = product?.serials.find((entry) => entry.id === row.serialId);
        return (
          <div className="row" style={{ gap: 8 }}>
            {scope === 'groupe' ? <EntityChip entity={row.entity} /> : null}
            <div style={{ minWidth: 0 }}>
              <div className="truncate">{product?.name ?? 'Référence supprimée'}</div>
              <div className="small dim">{serial ? serial.serial : 'Lot complet'}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'type',
      header: 'Type',
      sort: (row) => row.type,
      cell: (row) => <span className="small muted">{TYPE_LABEL[row.type]}</span>,
    },
    {
      key: 'description',
      header: 'Description',
      cell: (row) => (
        <span className="truncate" style={{ display: 'block', maxWidth: 320 }}>
          {row.description}
        </span>
      ),
    },
    {
      key: 'opened',
      header: 'Ouvert le',
      sort: (row) => row.openedAt,
      cell: (row) => <span className="small">{formatDate(row.openedAt)}</span>,
    },
    {
      key: 'delay',
      header: 'Immobilisation',
      align: 'right',
      sort: (row) => daysBetween(row.openedAt, row.closedAt ?? today()),
      cell: (row) => <span className="tnum small">{daysBetween(row.openedAt, row.closedAt ?? today())} j</span>,
    },
    {
      key: 'cost',
      header: 'Coût',
      align: 'right',
      sort: (row) => row.cost,
      cell: (row) => <span className="tnum">{row.cost ? money(row.cost) : '—'}</span>,
    },
    {
      key: 'status',
      header: 'Statut',
      sort: (row) => row.status,
      cell: (row) => (
        <Badge tone={STATUS_TONE[row.status]} icon={row.status === 'clos' ? '✔' : '🔧'}>
          {row.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="view">
      <PageHeader
        title="Maintenance du parc"
        subtitle="Incidents, révisions préventives et contrôles réglementaires"
        actions={
          <>
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} style={{ width: 150 }}>
              <option value="tous">Tous les tickets</option>
              <option value="ouvert">Ouverts</option>
              <option value="en-cours">En cours</option>
              <option value="clos">Clos</option>
            </select>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setDraft(emptyTicket(defaultEntity, db.products.find((p) => p.mode === 'location')?.id ?? db.products[0]?.id ?? ''))}
            >
              + Ouvrir un ticket
            </button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <StatTile
          label="Tickets ouverts"
          value={String(stats.open)}
          foot={
            stats.open ? (
              <Badge tone="warning" icon="🔧">
                Intervention requise
              </Badge>
            ) : (
              <Badge tone="good" icon="✔">
                Parc sain
              </Badge>
            )
          }
        />
        <StatTile label="Unités immobilisées" value={String(stats.immobilised)} deltaLabel="Retirées de la disponibilité" />
        <StatTile label="Coût de maintenance" value={money0(stats.cost)} deltaLabel="Cumul des interventions" />
        <StatTile label="Délai moyen de remise en service" value={`${Math.round(stats.averageDelay)} j`} deltaLabel="Tickets clos" />
      </div>

      <div className="grid g-2-1">
        <Card title="Tickets" flush>
          <DataTable
            rows={tickets}
            columns={columns}
            onRowClick={(row) => setDraft(structuredClone(row))}
            initialSort={{ key: 'opened', dir: -1 }}
            empty={<EmptyState mark="🔧" title="Aucun ticket" hint="Le parc n’a aucun incident enregistré." />}
          />
        </Card>
        <Card title="Coût par référence" subtitle="Cumul des interventions">
          {stats.byProduct.length ? <BarList items={stats.byProduct} colorIndex={1} /> : <EmptyState mark="✔" title="Aucun coût" />}
        </Card>
      </div>

      {draft ? (
        <TicketForm
          value={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => {
            update((db2) => {
              const index = db2.tickets.findIndex((ticket) => ticket.id === draft.id);
              if (index >= 0) db2.tickets[index] = draft;
              else db2.tickets.unshift(draft);
              // L'etat du materiel suit le ticket : il sort du parc disponible.
              const product = db2.products.find((entry) => entry.id === draft.productId);
              const serial = product?.serials.find((entry) => entry.id === draft.serialId);
              if (serial) serial.state = draft.status === 'clos' ? 'ok' : 'maintenance';
            });
            toast('Ticket enregistré.', 'succes');
            setDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TicketForm({
  value,
  onChange,
  onSave,
  onClose,
}: {
  value: MaintenanceTicket;
  onChange: (ticket: MaintenanceTicket) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { db, update, toast } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exists = db.tickets.some((ticket) => ticket.id === value.id);
  const product = db.products.find((entry) => entry.id === value.productId);
  const set = <K extends keyof MaintenanceTicket>(key: K, next: MaintenanceTicket[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <>
      <Modal
        title={exists ? 'Ticket de maintenance' : 'Nouveau ticket'}
        onClose={onClose}
        footer={
          <>
            {exists ? (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                Supprimer
              </button>
            ) : null}
            <div className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
            <button type="button" className="btn btn-primary" disabled={!value.description.trim()} onClick={onSave}>
              Enregistrer
            </button>
          </>
        }
      >
        <div className="grid g2">
          <Field label="Matériel">
            <select
              value={value.productId}
              onChange={(event) => {
                const next = db.products.find((entry) => entry.id === event.target.value);
                onChange({ ...value, productId: event.target.value, serialId: null, entity: next?.entity ?? value.entity });
              }}
            >
              {db.products.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Numéro de série">
            <select value={value.serialId ?? ''} onChange={(event) => set('serialId', event.target.value || null)}>
              <option value="">— lot complet —</option>
              {product?.serials.map((serial) => (
                <option key={serial.id} value={serial.id}>
                  {serial.serial}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type d’intervention">
            <select value={value.type} onChange={(event) => set('type', event.target.value as TicketType)}>
              {Object.entries(TYPE_LABEL).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Statut">
            <select
              value={value.status}
              onChange={(event) => {
                const status = event.target.value as TicketStatus;
                onChange({ ...value, status, closedAt: status === 'clos' ? value.closedAt ?? today() : null });
              }}
            >
              <option value="ouvert">Ouvert</option>
              <option value="en-cours">En cours</option>
              <option value="clos">Clos</option>
            </select>
          </Field>
          <Field label="Ouvert le">
            <input type="date" value={value.openedAt} onChange={(event) => set('openedAt', event.target.value)} />
          </Field>
          <Field label="Clos le">
            <input type="date" value={value.closedAt ?? ''} onChange={(event) => set('closedAt', event.target.value || null)} />
          </Field>
          <Field label="Coût HT">
            <input type="number" min={0} step={10} value={value.cost} onChange={(event) => set('cost', Number(event.target.value))} />
          </Field>
          <Field label="Technicien / prestataire">
            <input value={value.technician} onChange={(event) => set('technician', event.target.value)} />
          </Field>
          <Field label="Description" span={2}>
            <textarea rows={3} value={value.description} onChange={(event) => set('description', event.target.value)} autoFocus />
          </Field>
        </div>
      </Modal>

      {confirmDelete ? (
        <ConfirmDialog
          title="Supprimer ce ticket ?"
          message="L’historique de maintenance de ce matériel perdra cette intervention."
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            update((draft) => {
              draft.tickets = draft.tickets.filter((ticket) => ticket.id !== value.id);
            });
            toast('Ticket supprimé.', 'alerte');
            setConfirmDelete(false);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
