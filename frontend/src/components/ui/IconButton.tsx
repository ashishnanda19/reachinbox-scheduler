import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  /** Green (used for a set clock / attached files). */
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={rest.title ?? label}
      className={cn(
        'relative inline-flex h-[34px] w-[34px] items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'text-brand-text' : 'text-ink-faint hover:text-ink-soft',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
