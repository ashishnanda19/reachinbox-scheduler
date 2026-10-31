import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ListFilters, ListTab } from '../api/emails';
import { EmailList } from '../components/emails/EmailList';
import { SearchBar } from '../components/emails/SearchBar';
import { useDebounced } from '../hooks/useDebounced';
import { queryKeys, useEmailList } from '../hooks/useQueries';

/** Scheduled and Sent are the same screen with a different tab; this is that one screen. */
export function EmailListPage({ tab }: { tab: ListTab }) {
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<Omit<ListFilters, 'q'>>({});
  const q = useDebounced(text, 300);
  const queryClient = useQueryClient();
  const query = useEmailList(tab, { ...filters, q });

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const first = query.data?.pages[0];
  const searching = q.trim().length > 0;

  return (
    <>
      <SearchBar
        value={text}
        onChange={setText}
        filters={{ ...filters, q }}
        onFiltersChange={({ q: _ignored, ...rest }) => setFilters(rest)}
        showStatusFilter={tab === 'sent'}
        onRefresh={() => {
          void query.refetch();
          void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
        }}
        refreshing={query.isFetching}
      />
      {searching && first && (
        <p className="mt-2 pl-[2px] text-[12px] leading-4 text-ink-muted">
          {first.total} {first.total === 1 ? 'result' : 'results'}, via {first.source === 'elasticsearch' ? 'Elasticsearch' : 'SQL'}
        </p>
      )}
      <EmailList
        variant={tab}
        items={items}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        hasMore={Boolean(query.hasNextPage)}
        loadingMore={query.isFetchingNextPage}
        onLoadMore={() => void query.fetchNextPage()}
        searching={searching}
      />
    </>
  );
}
