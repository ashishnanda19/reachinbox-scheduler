import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const TONES = {
  scheduled: 'border-pill-border bg-pill-fill text-pill-text',
  sending: 'border-info-border bg-info-fill text-info-text',
} as const;

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone: keyof typeof TONES;
}

export function Pill({ tone, className, ...rest }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[27px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full border px-[7px] text-[13px] font-medium leading-none',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}
