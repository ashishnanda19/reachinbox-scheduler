import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'solid' | 'soft' | 'outline' | 'text';

const VARIANTS: Record<Variant, string> = {
  solid: 'bg-brand text-white hover:brightness-95',
  soft: 'bg-brand-light text-ink-strong hover:brightness-95',
  outline: 'border-[1.5px] border-brand-text text-brand-text bg-white hover:bg-brand-light',
  text: 'text-ink hover:bg-field',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'solid', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 transition disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
});
