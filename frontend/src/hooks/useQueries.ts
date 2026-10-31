import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getMe } from '../api/auth';
import { fetchEmailPage, getEmail, getStats, PAGE_SIZE, type ListFilters, type ListTab } from '../api/emails';
import { listSenders } from '../api/senders';
import { getSlackStatus } from '../api/slack';

/** Poll every 3 seconds, but only while the tab is visible. */
export const POLL_MS = 3000;
export const pollWhenVisible = () => (document.visibilityState === 'visible' ? POLL_MS : false);

export const queryKeys = {
  me: ['me'] as const,
  stats: ['stats'] as const,
  senders: ['senders'] as const,
  slack: ['slack'] as const,
  list: (tab: ListTab, filters: ListFilters) => ['emails', tab, filters] as const,
  email: (id: string) => ['email', id] as const,
};

export const useMe = () => useQuery({ queryKey: queryKeys.me, queryFn: getMe, retry: false, staleTime: 60_000 });
export const useStats = () => useQuery({ queryKey: queryKeys.stats, queryFn: getStats, refetchInterval: pollWhenVisible });
export const useSenders = () => useQuery({ queryKey: queryKeys.senders, queryFn: listSenders, staleTime: 30_000 });
export const useSlackStatus = () => useQuery({ queryKey: queryKeys.slack, queryFn: getSlackStatus });
export const useEmail = (id: string) =>
  useQuery({ queryKey: queryKeys.email(id), queryFn: () => getEmail(id), refetchInterval: pollWhenVisible });

/** Infinite list (page size 50) that re-fetches every 3 s, so rows visibly move from Scheduled to Sent. */
export function useEmailList(tab: ListTab, filters: ListFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.list(tab, filters),
    queryFn: ({ pageParam }) => fetchEmailPage(tab, filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.length * PAGE_SIZE < last.total ? last.page + 1 : undefined),
    refetchInterval: pollWhenVisible,
    placeholderData: keepPreviousData,
  });
}
