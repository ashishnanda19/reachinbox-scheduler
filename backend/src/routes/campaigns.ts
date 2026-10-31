import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { htmlToText, sanitizeEmailHtml } from '../lib/html.js';
import { currentUser } from '../middleware/auth.js';
import { createCampaign, InvalidSenderError } from '../services/campaigns.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_BODY_CHARS = 500_000;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const decodedSize = (base64: string): number =>
  Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);

const attachmentSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .transform((name) => name.replace(/[\\/\r\n\0]/g, '_')),
  contentType: z.string().trim().min(1).max(127),
  dataBase64: z.string().min(1),
});

const createCampaignSchema = z.object({
  subject: z.string().trim().min(1).max(998),
  body: z
    .string()
    .min(1)
    .max(MAX_BODY_CHARS)
    .transform(sanitizeEmailHtml)
    .refine((html) => htmlToText(html).length > 0, { message: 'body must not be empty' }),
  recipients: z
    .array(z.string().trim().toLowerCase().email())
    .min(1)
    .transform((list) => [...new Set(list)])
    .refine((list) => list.length <= config.MAX_RECIPIENTS_PER_CAMPAIGN, {
      message: `at most ${config.MAX_RECIPIENTS_PER_CAMPAIGN} unique recipients per campaign`,
    }),
  startTime: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
  delayBetweenMs: z.number().int().min(0),
  hourlyLimit: z
    .number()
    .int()
    .min(1)
    .transform((value) => Math.min(value, config.MAX_EMAILS_PER_HOUR_PER_SENDER)),
  senderId: z.string().uuid().optional(),
  attachments: z
    .array(attachmentSchema)
    .max(MAX_ATTACHMENTS, { message: `at most ${MAX_ATTACHMENTS} attachments` })
    .optional()
    .superRefine((files, ctx) => {
      let total = 0;
      for (const file of files ?? []) {
        if (!BASE64.test(file.dataBase64)) {
          ctx.addIssue({ code: 'custom', message: `"${file.filename}" is not valid base64` });
          return;
        }
        const size = decodedSize(file.dataBase64);
        total += size;
        if (size > MAX_ATTACHMENT_BYTES) {
          ctx.addIssue({ code: 'custom', message: `"${file.filename}" is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB` });
        }
      }
      if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
        ctx.addIssue({ code: 'custom', message: `attachments total more than ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024} MB` });
      }
    })
    .transform((files) =>
      files?.map((file) => ({
        filename: file.filename,
        contentType: file.contentType,
        content: Buffer.from(file.dataBase64, 'base64'),
      })),
    ),
});

export const campaignsRouter = Router();

campaignsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
      res.status(400).json({ error: 'invalid_request', message, issues: parsed.error.issues });
      return;
    }

    try {
      res.status(201).json(await createCampaign(currentUser(req).id, parsed.data));
    } catch (err) {
      if (err instanceof InvalidSenderError) {
        res.status(400).json({ error: 'invalid_sender', message: err.message });
        return;
      }
      throw err;
    }
  }),
);
