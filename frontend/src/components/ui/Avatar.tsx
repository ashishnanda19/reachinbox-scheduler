import { useState } from 'react';
import { cn } from '../../lib/cn';

interface AvatarProps {
  name: string;
  src?: string | null;
  size: number;
  /** Solid green circle with the initial (the sender in the email detail). */
  solid?: boolean;
  className?: string;
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

export function Avatar({ name, src, size, solid, className }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * (solid ? 0.43 : 0.38)) };

  if (src && !broken && !solid) {
    return (
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={style}
        className={cn('shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      style={style}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium',
        solid ? 'bg-avatar text-white' : 'bg-brand-light text-brand-text',
        className,
      )}
    >
      {solid ? name.trim()[0]?.toUpperCase() : initialsOf(name)}
    </span>
  );
}
