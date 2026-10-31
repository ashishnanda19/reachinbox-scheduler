import { cn } from '../../lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-[#EEF0EE]', className)} aria-hidden />;
}
