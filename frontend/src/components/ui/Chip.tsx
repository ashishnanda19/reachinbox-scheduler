import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'sent' | 'failed' | 'recipient';

const TONES: Record<Tone, string> = {
  sent: 'h-[27px] bg-chip-fill px-[11px] text-[13px] text-ink-soft',
  failed: 'h-[27px] bg-[#FDECEA] px-[11px] text-[13px] text-danger',
  recipient: 'h-7 border border-brand bg-brand-light px-[10px] text-[15px] text-ink',
};

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone: Tone;
}

export function Chip({ tone, className, ...rest }: ChipProps) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full leading-none', TONES[tone], className)} {...rest} />;
}
