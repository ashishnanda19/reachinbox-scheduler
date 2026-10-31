import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { cancelScheduledEmail } from '../scheduler/emails.js';
import { emailQueue } from '../scheduler/queue.js';
import { ITEM_SELECT, toItem, type EmailItemRow } from '../services/emailItems.js';
import { removeFromIndex } from '../services/search.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';
import { parsePagination } from '../utils/pagination.js';

export const emailsRouter = Router();

const listQuerySchema = z.object({
  senderId: z.string().uuid().optional(),
  status: z.enum(['sent', 'failed']).optional(),
});

function listRoute(statuses: string[], orderBy: string, allowStatusFilter: boolean) {
  return asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const filters = listQuerySchema.safeParse(req.query);
    if (!pagination || !filters.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const userId = currentUser(req).id;
    const wanted = allowStatusFilter && filters.data.status ? [filters.data.status] : statuses;
    const params = [userId, wanted, filters.data.senderId ?? null];
    const where = 'e.user_id = $1 AND e.status = ANY($2::text[]) AND ($3::uuid IS NULL OR e.sender_id = $3)';

    const [rows, count] = await Promise.all([
      pool.query<EmailItemRow>(`${ITEM_SELECT} WHERE ${where} ORDER BY ${orderBy}, e.id LIMIT $4 OFFSET $5`, [
        ...params,
        pagination.limit,
        pagination.offset,
      ]),
      pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM emails e WHERE ${where}`, params),
    ]);

    res.json({ items: rows.rows.map(toItem), total: count.rows[0]!.total, page: pagination.page, limit: pagination.limit });
  });
}

emailsRouter.get('/scheduled', listRoute(['scheduled', 'processing'], 'e.scheduled_at ASC', false));
emailsRouter.get('/sent', listRoute(['sent', 'failed'], 'e.sent_at DESC NULLS LAST', true));

const idSchema = z.string().uuid();

emailsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const user = currentUser(req);

    const { rows } = await pool.query<EmailItemRow & { attempts: number; preview_url: string | null; message_id: string | null; campaign_id: string }>(
      `SELECT x.*, e.attempts, e.preview_url, e.message_id, e.campaign_id
         FROM (${ITEM_SELECT} WHERE e.id = $1 AND e.user_id = $2) x
         JOIN emails e ON e.id = x.id`,
      [id.data, user.id],
    );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const attachments = await pool.query<{ position: number; filename: string; content_type: string; size: number }>(
      'SELECT position, filename, content_type, size FROM campaign_attachments WHERE campaign_id = $1 ORDER BY position',
      [row.campaign_id],
    );

    res.json({
      ...toItem(row),
      body: row.body,
      senderName: user.name,
      attempts: row.attempts,
      previewUrl: row.preview_url,
      messageId: row.message_id,
      attachments: attachments.rows.map((a) => ({
        index: a.position,
        filename: a.filename,
        contentType: a.content_type,
        size: a.size,
      })),
    });
  }),
);

// Only raster images are shown inline; anything else (including SVG, which can carry script) is a download.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

emailsRouter.get(
  '/:id/attachments/:index',
  asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const index = z.coerce.number().int().min(0).safeParse(req.params.index);
    if (!id.success || !index.success) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const { rows } = await pool.query<{ filename: string; content_type: string; data: Buffer }>(
      `SELECT a.filename, a.content_type, a.data
         FROM emails e JOIN campaign_attachments a ON a.campaign_id = e.campaign_id
        WHERE e.id = $1 AND e.user_id = $2 AND a.position = $3`,
      [id.data, currentUser(req).id, index.data],
    );
    const file = rows[0];
    if (!file) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const inline = INLINE_TYPES.has(file.content_type);
    res.setHeader('Content-Type', inline ? file.content_type : 'application/octet-stream');
    res.setHeader('Content-Length', file.data.length);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(file.data);
  }),
);

emailsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success || !(await cancelScheduledEmail(id.data, currentUser(req).id))) {
      res.status(409).json({
        error: 'not_cancellable',
        message: 'Only emails that are still scheduled can be cancelled. This one is already sending, sent, failed or does not exist.',
      });
      return;
    }

    // The row is gone, so even if the job lingers the worker finds nothing to claim. Cleanup is best effort.
    await emailQueue.remove(id.data).catch((err: unknown) => logger.debug({ err }, 'queue.remove after cancel failed (ignored)'));
    removeFromIndex(id.data);
    res.json({ cancelled: true });
  }),
);
