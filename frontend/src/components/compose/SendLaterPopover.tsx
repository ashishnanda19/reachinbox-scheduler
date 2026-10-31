import dayjs, { type Dayjs } from 'dayjs';
import { Calendar } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { sendLaterPresets, toLocalInput } from '../../lib/date';
import { Button } from '../ui/Button';
import { Popover } from '../ui/Popover';

interface SendLaterPopoverProps {
  open: boolean;
  onClose: () => void;
  /** The time currently set (null = send now). */
  value: Dayjs | null;
  onDone: (value: Dayjs | null) => void;
}

/** 355px popover under the header: pick a date & time or one of four presets. */
export function SendLaterPopover({ open, onClose, value, onDone }: SendLaterPopoverProps) {
  const [draft, setDraft] = useState<Dayjs | null>(value);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const done = () => {
    if (draft && !draft.isAfter(dayjs())) {
      toast.error('Pick a time in the future');
      return;
    }
    onDone(draft);
    onClose();
  };

  return (
    <Popover open={open} onClose={onClose} className="right-5 top-[81px] w-[355px] rounded-xl px-[19px] pb-[16px] pt-[19px]">
      <h2 className="text-[18px] font-medium leading-6 text-ink-strong">Send Later</h2>

      <div className="relative mt-[22px]">
        <button
          type="button"
          onClick={() => picker.current?.showPicker?.()}
          className="flex h-[36px] w-full items-center justify-between border-b border-line text-left text-[15px]"
        >
          <span className={draft ? 'text-ink' : 'text-ink-muted'}>{draft ? draft.format('MMM D, YYYY, h:mm A') : 'Pick date & time'}</span>
          <Calendar size={18} strokeWidth={1.5} className="text-ink-muted" />
        </button>
        <input
          ref={picker}
          type="datetime-local"
          aria-label="Pick date and time"
          value={draft ? toLocalInput(draft) : ''}
          onChange={(e) => setDraft(e.target.value ? dayjs(e.target.value) : null)}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0"
          tabIndex={-1}
        />
      </div>

      <ul className="mt-[15px]">
        {sendLaterPresets().map((preset) => (
          <li key={preset.label}>
            <button
              type="button"
              onClick={() => setDraft(preset.at)}
              className="h-[39px] w-full rounded-md px-0 text-left text-[15px] text-ink-soft hover:bg-field"
            >
              {preset.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-[79px] flex items-center justify-end gap-[28px]">
        <Button variant="text" onClick={onClose} className="h-[37px] px-2 text-[15px] hover:bg-transparent hover:underline">
          Cancel
        </Button>
        <Button variant="outline" onClick={done} className="h-[37px] w-[91px] rounded-full text-[15px]">
          Done
        </Button>
      </div>
    </Popover>
  );
}
