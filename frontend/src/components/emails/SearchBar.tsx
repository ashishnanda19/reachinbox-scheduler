import { Filter, RotateCw, Search } from 'lucide-react';
import { useState } from 'react';
import type { ListFilters } from '../../api/emails';
import { cn } from '../../lib/cn';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { FilterPopover } from './FilterPopover';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  filters: ListFilters;
  onFiltersChange: (filters: ListFilters) => void;
  showStatusFilter: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}

/** Search pill (746px) + funnel + refresh, at the top of Scheduled and Sent. */
export function SearchBar({ value, onChange, filters, onFiltersChange, showStatusFilter, onRefresh, refreshing }: SearchBarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const filtered = Boolean(filters.senderId || filters.status);
  return (
    <div className="flex items-center pt-5">
      <div className="relative h-[43px] w-[746px] max-w-full">
        <Search size={18} strokeWidth={1.5} className="pointer-events-none absolute left-[17px] top-1/2 -translate-y-1/2 text-ink-faint" />
        <Input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search"
          aria-label="Search emails"
          className="h-full w-full rounded-full bg-field pl-[42px] pr-5 text-[15px] text-ink [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <div className="relative ml-3 flex items-center gap-3">
        <IconButton label="Filter" active={filtered} onClick={() => setFilterOpen((v) => !v)} aria-expanded={filterOpen}>
          <Filter size={18} strokeWidth={1.5} />
        </IconButton>
        <FilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} filters={filters} onChange={onFiltersChange} showStatus={showStatusFilter} />
        <IconButton label="Refresh" onClick={onRefresh}>
          <RotateCw size={18} strokeWidth={1.5} className={cn(refreshing && 'animate-spin')} />
        </IconButton>
      </div>
    </div>
  );
}
