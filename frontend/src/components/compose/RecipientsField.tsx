import { Upload, X } from 'lucide-react';
import { type ClipboardEvent, type KeyboardEvent, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { chipWindow } from '../../lib/chips';
import { parseEmails } from '../../lib/csv';
import { Chip } from '../ui/Chip';
import { Input } from '../ui/Input';

interface RecipientsFieldProps {
  recipients: string[];
  onChange: (recipients: string[]) => void;
  onBlur?: () => void;
  error?: string;
}

const ACCEPT = '.csv,.txt,text/csv,text/plain';

/** Chips for typed, pasted and uploaded addresses. Only the first 3 plus "+N" are rendered until expanded. */
export function RecipientsField({ recipients, onChange, onBlur, error }: RecipientsFieldProps) {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { visible, hiddenCount } = chipWindow(recipients, expanded);

  /** Adds every address found in `text`, and says what was skipped. */
  function add(text: string, announce: boolean) {
    const { emails, invalid, duplicates } = parseEmails(text, recipients);
    if (emails.length > 0) onChange([...recipients, ...emails]);
    const skipped = invalid + duplicates;
    if (announce && (emails.length > 0 || skipped > 0)) {
      toast(`Added ${emails.length} emails (${skipped} duplicates or invalid skipped)`, { icon: emails.length > 0 ? '✅' : '⚠️' });
    } else if (!announce && emails.length === 0 && text.trim()) {
      toast.error(invalid > 0 ? 'That is not a valid email address' : 'That address is already added');
    }
  }

  const commitDraft = () => {
    if (draft.trim()) add(draft, false);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ' || event.key === ';') {
      event.preventDefault();
      commitDraft();
    } else if (event.key === 'Backspace' && !draft && recipients.length > 0) {
      onChange(recipients.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!/[\s,;]/.test(text.trim())) return; // a single address: let it land in the input
    event.preventDefault();
    add(text, true);
  };

  async function onFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) add(await file.text(), true);
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <div>
      <div className="flex min-h-[45px] items-center border-b border-line">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[6px] py-[9px] pl-[10px]">
          {visible.map((email) => (
            <Chip key={email} tone="recipient" className="group gap-1">
              {email}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={() => onChange(recipients.filter((r) => r !== email))}
                className="hidden h-4 w-4 items-center justify-center rounded-full text-ink-soft hover:text-danger group-hover:flex"
              >
                <X size={12} strokeWidth={2} />
              </button>
            </Chip>
          ))}
          {hiddenCount > 0 && (
            <button type="button" onClick={() => setExpanded(true)} aria-label={`Show ${hiddenCount} more recipients`}>
              <Chip tone="recipient" className="cursor-pointer px-[11px]">
                +{hiddenCount}
              </Chip>
            </button>
          )}
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => {
              commitDraft();
              onBlur?.();
            }}
            placeholder={recipients.length === 0 ? 'recipient@example.com' : ''}
            aria-label="Recipients"
            className="min-w-[120px] flex-1 bg-transparent py-1 text-[17px] text-ink"
          />
        </div>
        <div className="flex shrink-0 items-center gap-4 pr-[10px]">
          {recipients.length > 0 && (
            <span className="text-[13px] text-ink-muted" aria-live="polite">
              {recipients.length} {recipients.length === 1 ? 'email' : 'emails'} detected
            </span>
          )}
          <button type="button" onClick={() => fileInput.current?.click()} className="flex items-center gap-[7px] text-[16px] text-brand-text hover:underline">
            <Upload size={17} strokeWidth={1.5} />
            Upload List
          </button>
          <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        </div>
      </div>
      {error && <p className="mt-1 pl-[10px] text-[12px] text-danger">{error}</p>}
    </div>
  );
}
