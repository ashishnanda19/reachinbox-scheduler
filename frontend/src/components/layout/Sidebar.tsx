import { Clock, Send } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useStats } from '../../hooks/useQueries';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';

function NavItem({ to, icon, label, count }: { to: string; icon: React.ReactNode; label: string; count: number | undefined }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex h-[41px] w-[262px] items-center rounded-[10px] pl-[17px] pr-[22px] text-[15.5px]',
          isActive ? 'bg-brand-light font-semibold text-ink-strong' : 'text-ink-soft hover:bg-field',
        )
      }
    >
      <span className="mr-3 flex h-[18px] w-[18px] items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="text-[14px] font-normal text-ink-muted">{count ?? ''}</span>
    </NavLink>
  );
}

export function Sidebar() {
  const stats = useStats().data;
  const navigate = useNavigate();
  return (
    <aside className="shrink-0 px-[9px] pt-5 max-[900px]:w-full min-[901px]:sticky min-[901px]:top-0 min-[901px]:h-screen min-[901px]:w-[280px]">
      <div className="px-[11px]">
        <Logo />
      </div>
      <div className="mt-3">
        <UserMenu />
      </div>
      <Button variant="outline" onClick={() => navigate('/compose')} className="mt-[10px] h-[38px] w-[264px] -translate-x-[1px] rounded-full text-[15.5px] font-medium">
        Compose
      </Button>
      <div className="mt-[26px] pl-[18px] text-[11px] uppercase leading-4 text-ink-faint">Core</div>
      <nav className="mt-[2px] flex flex-col">
        <NavItem to="/scheduled" label="Scheduled" count={stats?.scheduled} icon={<Clock size={18} strokeWidth={1.5} />} />
        <NavItem to="/sent" label="Sent" count={stats ? stats.sent + stats.failed : undefined} icon={<Send size={18} strokeWidth={1.5} />} />
      </nav>
    </aside>
  );
}
