import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../middleware/auth.js';
import { reindexUserEmails, searchEmails, SearchUnavailableError } from '../services/search.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parsePagination } from '../utils/pagination.js';

const MAX_QUERY_LENGTH = 200;

const STATUSES = ['scheduled', 'processing', 'sent', 'failed'] as const;

const searchQuerySchema = z.object({
  q: z.string().trim().max(MAX_QUERY_LENGTH).default(''),
  // One status or a comma separated list, e.g. status=sent,failed for the Sent tab.
  status: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',') : undefined))
    .pipe(z.array(z.enum(STATUSES)).optional()),
  senderId: z.string().uuid().optional(),
});

export const searchRouter = Router();

searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = searchQuerySchema.safeParse(req.query);
    const pagination = parsePagination(req.query);
    if (!query.success || !pagination) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    const { q, status, senderId } = query.data;
    res.json(
      await searchEmails({ userId: currentUser(req).id, q, statuses: status, senderId, page: pagination.page, limit: pagination.limit }),
    );
  }),
);

// Re-indexes the caller's emails from Postgres (repairs drift after an Elasticsearch outage or a wiped index).
searchRouter.post(
  '/reindex',
  asyncHandler(async (req, res) => {
    try {
      res.json({ indexed: await reindexUserEmails(currentUser(req).id) });
    } catch (err) {
      if (err instanceof SearchUnavailableError) {
        res.status(503).json({ error: 'elasticsearch_unavailable', message: err.message });
        return;
      }
      throw err;
    }
  }),
);
