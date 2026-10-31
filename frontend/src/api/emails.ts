import { request } from './client';
import type { EmailDetail, EmailStatus, Page, SearchPage, Stats } from './types';
import type { EmailItem } from './types';

export type ListTab = 'scheduled' | 'sent';

export interface ListFilters {
  q: string;
  senderId?: string;
  /** Sent tab only. */
  status?: 'sent' | 'failed';
}

export const PAGE_SIZE = 50;

const TAB_STATUSES: Record<ListTab, EmailStatus[]> = {
  scheduled: ['scheduled', 'processing'],
  sent: ['sent', 'failed'],
};

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  return search.toString();
}

/** One page of a tab. A non-empty search text goes through /api/search with the tab's statuses. */
export function fetchEmailPage(tab: ListTab, filters: ListFilters, page: number): Promise<Page<EmailItem> & { source?: SearchPage['source'] }> {
  const common = { page, limit: PAGE_SIZE, senderId: filters.senderId };
  if (filters.q.trim()) {
    const statuses = filters.status ? [filters.status] : TAB_STATUSES[tab];
    return request<SearchPage>(`/api/search?${query({ ...common, q: filters.q.trim(), status: statuses.join(',') })}`);
  }
  return request<Page<EmailItem>>(`/api/emails/${tab}?${query({ ...common, status: tab === 'sent' ? filters.status : undefined })}`);
}

export const getEmail = (id: string) => request<EmailDetail>(`/api/emails/${id}`);
export const cancelEmail = (id: string) => request<{ cancelled: boolean }>(`/api/emails/${id}`, { method: 'DELETE' });
export const getStats = () => request<Stats>('/api/stats');
