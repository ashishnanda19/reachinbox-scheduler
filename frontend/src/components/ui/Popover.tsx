import { type ReactNode, useRef } from 'react';
import { useDismiss } from '../../hooks/useOutsideClick';
import { cn } from '../../lib/cn';

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/** A floating panel that closes on outside click or Escape. Position it with `className`. */
export function Popover({ open, onClose, children, className }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose, open);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" className={cn('absolute z-30 border border-line bg-white shadow-popover', className)}>
      {children}
    </div>
  );
}
