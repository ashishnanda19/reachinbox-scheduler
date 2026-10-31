import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

interface EmptyStateProps {
  icon: LucideIcon;
  text: string;
  /** Show the "Compose" link. */
  compose?: boolean;
}

export function EmptyState({ icon: Icon, text, compose = true }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 pt-[120px] text-center">
      <Icon size={32} strokeWidth={1.25} className="text-ink-faint" />
      <p className="text-[16px] text-ink-muted">{text}</p>
      {compose && (
        <Link to="/compose" className="text-[15px] font-medium text-brand-text hover:underline">
          Compose an email
        </Link>
      )}
    </div>
  );
}
