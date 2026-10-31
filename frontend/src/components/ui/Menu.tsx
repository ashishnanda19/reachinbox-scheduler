import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Menu({ children, className }: { children: ReactNode; className?: string }) {
  return <div role="menu" className={cn('flex flex-col gap-px p-[6px]', className)}>{children}</div>;
}

interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  trailing?: ReactNode;
}

export function MenuItem({ icon, trailing, className, children, type = 'button', ...rest }: MenuItemProps) {
  return (
    <button
      type={type}
      role="menuitem"
      className={cn(
        'flex h-10 w-full items-center gap-[10px] rounded-lg px-[10px] text-left text-[15px] text-ink transition hover:bg-field disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-soft">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  );
}
