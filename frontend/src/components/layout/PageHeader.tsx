import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from '../ui/IconButton';

interface PageHeaderProps {
  title: string;
  /** Back arrow handler; defaults to the previous page. */
  onBack?: () => void;
  children?: ReactNode;
}

/** The 80px header of the full-page screens (email detail, compose). */
export function PageHeader({ title, onBack, children }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="relative flex h-20 items-center pl-[10px] pr-[17px]">
      <IconButton label="Back" onClick={onBack ?? (() => navigate(-1))} className="h-10 w-10 text-ink-strong hover:text-ink-strong">
        <ArrowLeft size={24} strokeWidth={1.5} />
      </IconButton>
      <h1 className="ml-[6px] min-w-0 flex-1 truncate text-[26px] font-normal leading-9 text-ink-strong">{title}</h1>
      <div className="flex shrink-0 items-center">{children}</div>
    </header>
  );
}
