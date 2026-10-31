import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { createSender } from '../../api/senders';
import { queryKeys, useSenders } from '../../hooks/useQueries';
import { cn } from '../../lib/cn';
import { Menu, MenuItem } from '../ui/Menu';
import { Popover } from '../ui/Popover';
import { Spinner } from '../ui/Spinner';

export const AUTO_SENDER = 'auto';

interface FromSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export function FromSelect({ value, onChange }: FromSelectProps) {
  const [open, setOpen] = useState(false);
  const senders = useSenders().data ?? [];
  const queryClient = useQueryClient();

  const add = useMutation({
    mutationFn: createSender,
    onSuccess: (sender) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.senders });
      onChange(sender.id);
      toast.success(`Added ${sender.email}`);
      setOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const label = value === AUTO_SENDER ? 'Auto (rotate all senders)' : (senders.find((s) => s.id === value)?.email ?? 'Auto (rotate all senders)');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-[42px] min-w-[246px] items-center justify-between gap-3 rounded-[10px] bg-field px-[10px] text-[16px] text-ink-strong"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={16} strokeWidth={1.5} className="shrink-0 text-ink-faint" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="left-0 top-[46px] w-[340px] rounded-xl shadow-menu">
        <Menu>
          <MenuItem className={cn(value === AUTO_SENDER && 'bg-field')} onClick={() => { onChange(AUTO_SENDER); setOpen(false); }}>
            Auto (rotate all senders)
          </MenuItem>
          {senders.map((sender) => (
            <MenuItem key={sender.id} className={cn(value === sender.id && 'bg-field')} onClick={() => { onChange(sender.id); setOpen(false); }}>
              {sender.email}
            </MenuItem>
          ))}
          <MenuItem disabled={add.isPending} trailing={add.isPending ? <Spinner /> : undefined} className="text-brand-text" onClick={() => add.mutate()}>
            + Add Ethereal sender
          </MenuItem>
        </Menu>
      </Popover>
    </div>
  );
}
