import { Inbox, SearchX, SendHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { EmailItem } from '../../api/types';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { useStarred } from '../../hooks/useStarred';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { EmailRow, EmailRowSkeleton, type RowVariant } from './EmailRow';

interface EmailListProps {
  variant: RowVariant;
  items: EmailItem[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** An active search text, for the "no results" empty state. */
  searching: boolean;
}

const SKELETON_ROWS = 7;

/** The list body shared by Scheduled and Sent: skeletons, empty state, error row and the rows themselves. */
export function EmailList({ variant, items, loading, error, onRetry, hasMore, loadingMore, onLoadMore, searching }: EmailListProps) {
  const navigate = useNavigate();
  const { isStarred, toggle } = useStarred();
  const sentinel = useInfiniteScroll(onLoadMore, hasMore && !loadingMore && !error);

  if (loading) {
    return (
      <div className="mt-[18px]" aria-busy>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <EmailRowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error && items.length === 0) return <ErrorRow message={error.message} onRetry={onRetry} />;

  if (items.length === 0) {
    if (searching) return <EmptyState icon={SearchX} text="No emails match your search." compose={false} />;
    return variant === 'scheduled' ? (
      <EmptyState icon={Inbox} text="No scheduled emails. Compose one and it will show up here." />
    ) : (
      <EmptyState icon={SendHorizontal} text="Nothing sent yet. Sent and failed emails will appear here." />
    );
  }

  return (
    <div className="mt-[18px]">
      {items.map((item) => (
        <EmailRow
          key={item.id}
          item={item}
          variant={variant}
          starred={isStarred(item.id)}
          onToggleStar={() => toggle(item.id)}
          onOpen={() => navigate(`/email/${item.id}`)}
        />
      ))}
      {error && <ErrorRow message={error.message} onRetry={onRetry} />}
      <div ref={sentinel} className="flex h-12 items-center justify-center text-ink-muted">
        {loadingMore && <Spinner size={18} />}
      </div>
    </div>
  );
}

function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-[18px] flex h-[62px] items-center justify-between border-b border-line pl-[27px] pr-[16px]">
      <span className="text-[16px] text-danger">Could not load emails: {message}</span>
      <Button variant="outline" onClick={onRetry} className="h-8 rounded-full px-4 text-[14px]">
        Retry
      </Button>
    </div>
  );
}
