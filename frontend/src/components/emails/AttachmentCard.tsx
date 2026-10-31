import { FileText, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatSize } from '../../lib/date';

interface AttachmentCardProps {
  filename: string;
  size: number;
  /** Image URL for the 130px thumbnail; without it a file icon is shown. */
  thumbnailUrl?: string;
  onOpen?: () => void;
  onRemove?: () => void;
}

/** 233px attachment card, shared by the email detail and the compose attachments strip. */
export function AttachmentCard({ filename, size, thumbnailUrl, onOpen, onRemove }: AttachmentCardProps) {
  return (
    <div className="group relative w-[233px] shrink-0 overflow-hidden rounded-[10px] bg-card">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className={cn('block w-full text-left', onOpen ? 'cursor-pointer' : 'cursor-default')}
      >
        <div className="flex h-[130px] w-full items-center justify-center bg-[#EEF0EE]">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <FileText size={40} strokeWidth={1.25} className="text-ink-faint" />
          )}
        </div>
        <div className="px-[10px] pb-[9px] pt-[9px]">
          <div className="truncate text-[15.5px] leading-[22px] text-ink">{filename}</div>
          <div className="text-[13px] leading-5 text-ink-muted">{formatSize(size)}</div>
        </div>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${filename}`}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-ink-soft shadow hover:text-danger"
        >
          <X size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
