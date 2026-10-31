import { z } from 'zod';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

export function parsePagination(query: unknown): Pagination | null {
  const parsed = paginationSchema.safeParse(query);
  if (!parsed.success) return null;
  const { page, limit } = parsed.data;
  return { page, limit, offset: (page - 1) * limit };
}

export function paginated<T>(data: T[], total: number, { page, limit }: Pagination) {
  return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
}
