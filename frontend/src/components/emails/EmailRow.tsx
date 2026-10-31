import { Clock, Star } from 'lucide-react';
import type { EmailItem } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatScheduled, formatSentTime } from '../../lib/date';
import { Chip } from '../ui/Chip';
import { Pill } from '../ui/Pill';
import { Skeleton } from '../ui/Skeleton';
import { Spinner } from '../ui/Spinner';

export type RowVariant = 'scheduled' | 'sent';

interface EmailRowProps {
  item: EmailItem;
  variant: RowVariant;
  starred: boolean;
  onToggleStar: () => void;
  onOpen: () => void;
}

function StatusElement({ item }: { item: EmailItem }) {
  if (item.status === 'scheduled') {
    return (
      <Pill tone="scheduled">
        <Clock size={14} strokeWidth={1.75} />
        {formatScheduled(item.scheduledAt)}
      </Pill>
    );
  }
  if (item.status === 'processing') {
    return (
      <Pill tone="sending">
        <Spinner size={13} />
        Sending
      </Pill>
    );
  }
  if (item.status === 'failed') {
    return (
      <Chip tone="failed" title={item.error ?? 'Failed'}>
        Failed
      </Chip>
    );
  }
  return <Chip tone="sent">Sent</Chip>;
}

/** One list row (62px). Used by both Scheduled and Sent; `variant` only decides whether the sent time shows. */
export function EmailRow({ item, variant, starred, onToggleStar, onOpen }: EmailRowProps) {
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="flex h-[62px] cursor-pointer items-center border-b border-line pl-[27px] pr-[16px] hover:bg-[#FAFBFA]"
    >
      <div className="w-[230px] shrink-0 truncate pr-4 text-[16px] text-ink">To: {item.recipient}</div>
      <div className="flex min-w-0 flex-1 items-center gap-[5px]">
        <StatusElement item={item} />
        <span className="min-w-0 truncate text-[16px] text-ink-muted">
          <span className="font-medium text-ink-strong">{item.subject}</span>
          {item.preview && <> - {item.preview}</>}
        </span>
      </div>
      {variant === 'sent' && item.sentAt && (
        <time className="ml-4 shrink-0 whitespace-nowrap text-[14px] text-ink-muted" dateTime={item.sentAt}>
          {formatSentTime(item.sentAt)}
        </time>
      )}
      <button
        type="button"
        aria-label={starred ? 'Unstar' : 'Star'}
        aria-pressed={starred}
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar();
        }}
        className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center"
      >
        <Star size={18} strokeWidth={1.5} className={cn(starred ? 'fill-star-active text-star-active' : 'text-[#C6CAC6]')} />
      </button>
    </div>
  );
}

/** Placeholder with the exact geometry of a row. */
export function EmailRowSkeleton() {
  return (
    <div className="flex h-[62px] items-center border-b border-line pl-[27px] pr-[16px]">
      <Skeleton className="h-4 w-[170px]" />
      <div className="ml-[60px] flex flex-1 items-center gap-[5px]">
        <Skeleton className="h-6 w-[137px] rounded-full" />
        <Skeleton className="h-4 w-[55%]" />
      </div>
    </div>
  );
}
