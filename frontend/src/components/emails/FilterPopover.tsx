import type { ListFilters } from '../../api/emails';
import { useSenders } from '../../hooks/useQueries';
import { Popover } from '../ui/Popover';

interface FilterPopoverProps {
  open: boolean;
  onClose: () => void;
  filters: ListFilters;
  onChange: (filters: ListFilters) => void;
  /** The Sent tab also filters by sent / failed. */
  showStatus: boolean;
}

const SELECT = 'h-10 w-full rounded-lg bg-field px-3 text-[15px] text-ink outline-none';

export function FilterPopover({ open, onClose, filters, onChange, showStatus }: FilterPopoverProps) {
  const senders = useSenders().data ?? [];
  return (
    <Popover open={open} onClose={onClose} className="right-0 top-[42px] w-[280px] rounded-xl p-4">
      <label className="mb-1 block text-[13px] text-ink-muted" htmlFor="filter-sender">
        Sender
      </label>
      <select id="filter-sender" className={SELECT} value={filters.senderId ?? ''} onChange={(e) => onChange({ ...filters, senderId: e.target.value || undefined })}>
        <option value="">All senders</option>
        {senders.map((sender) => (
          <option key={sender.id} value={sender.id}>
            {sender.email}
          </option>
        ))}
      </select>
      {showStatus && (
        <>
          <label className="mb-1 mt-3 block text-[13px] text-ink-muted" htmlFor="filter-status">
            Status
          </label>
          <select
            id="filter-status"
            className={SELECT}
            value={filters.status ?? ''}
            onChange={(e) => onChange({ ...filters, status: (e.target.value || undefined) as ListFilters['status'] })}
          >
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </>
      )}
    </Popover>
  );
}
