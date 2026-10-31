import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} strokeWidth={1.75} className={cn('animate-spin', className)} aria-label="Loading" />;
}
