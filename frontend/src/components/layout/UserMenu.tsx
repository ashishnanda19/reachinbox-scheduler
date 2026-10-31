import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ChevronDown, Hash, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { logout } from '../../api/auth';
import { apiUrl } from '../../api/client';
import { disconnectSlack } from '../../api/slack';
import { queryKeys, useMe, useSlackStatus } from '../../hooks/useQueries';
import { Avatar } from '../ui/Avatar';
import { Menu, MenuItem } from '../ui/Menu';
import { Popover } from '../ui/Popover';

/** User card with the account menu: Slack, Queue monitor, Log out. */
export function UserMenu() {
  const [open, setOpen] = useState(false);
  const me = useMe().data;
  const slack = useSlackStatus().data;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  // Back from Slack's consent screen: ?slack=connected
  useEffect(() => {
    const result = params.get('slack');
    if (!result) return;
    if (result === 'connected') toast.success('Slack connected');
    else toast.error(result === 'denied' ? 'Slack connection was cancelled' : 'Could not connect Slack, please try again');
    void queryClient.invalidateQueries({ queryKey: queryKeys.slack });
    params.delete('slack');
    setParams(params, { replace: true });
  }, [params, setParams, queryClient]);

  const disconnect = useMutation({
    mutationFn: disconnectSlack,
    onSuccess: () => {
      toast.success('Slack disconnected');
      void queryClient.invalidateQueries({ queryKey: queryKeys.slack });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  if (!me) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-[64px] w-[260px] items-center gap-[10px] rounded-xl bg-field pl-[11px] pr-[14px] text-left"
      >
        <Avatar name={me.name} src={me.avatar_url} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-5 text-ink">{me.name}</span>
          <span className="block truncate text-[11px] leading-4 text-ink-muted">{me.email}</span>
        </span>
        <ChevronDown size={18} strokeWidth={1.5} className="shrink-0 text-ink-faint" />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} className="left-0 top-[70px] w-[260px] rounded-xl shadow-menu">
        <Menu>
          {slack?.connected ? (
            <MenuItem
              icon={<Hash size={18} strokeWidth={1.5} />}
              trailing={<span className="text-[13px] text-brand-text">Disconnect</span>}
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              title="Disconnect Slack"
            >
              Slack: {slack.channel ?? 'connected'}
            </MenuItem>
          ) : (
            <MenuItem icon={<Hash size={18} strokeWidth={1.5} />} onClick={() => window.location.assign(apiUrl('/api/slack/connect'))}>
              Connect Slack
            </MenuItem>
          )}
          <MenuItem icon={<Activity size={18} strokeWidth={1.5} />} onClick={() => window.open(apiUrl('/admin/queues'), '_blank', 'noopener')}>
            Queue monitor
          </MenuItem>
          <MenuItem icon={<LogOut size={18} strokeWidth={1.5} />} onClick={() => signOut.mutate()}>
            Log out
          </MenuItem>
        </Menu>
      </Popover>
    </div>
  );
}
