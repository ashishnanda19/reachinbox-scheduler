import { previewOf } from '../lib/html.js';

// One shape for every email list (scheduled, sent, search) so the frontend renders them with one component.
export interface EmailItem {
  id: string;
  recipient: string;
  subject: string;
  preview: string;
  status: 'scheduled' | 'processing' | 'sent' | 'failed';
  scheduledAt: string;
  sentAt: string | null;
  senderId: string;
  senderEmail: string;
  error: string | null;
  attachmentCount: number;
}

export interface EmailItemRow {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailItem['status'];
  scheduled_at: Date;
  sent_at: Date | null;
  sender_id: string;
  sender_email: string;
  error: string | null;
  attachment_count: number;
}

export const ITEM_SELECT = `
  SELECT e.id, e.recipient, e.subject, e.body, e.status, e.scheduled_at, e.sent_at, e.sender_id,
         s.email AS sender_email, e.error,
         (SELECT count(*)::int FROM campaign_attachments a WHERE a.campaign_id = e.campaign_id) AS attachment_count
    FROM emails e JOIN senders s ON s.id = e.sender_id`;

export function toItem(row: EmailItemRow): EmailItem {
  return {
    id: row.id,
    recipient: row.recipient,
    subject: row.subject,
    preview: previewOf(row.body),
    status: row.status,
    scheduledAt: row.scheduled_at.toISOString(),
    sentAt: row.sent_at ? row.sent_at.toISOString() : null,
    senderId: row.sender_id,
    senderEmail: row.sender_email,
    error: row.error,
    attachmentCount: row.attachment_count,
  };
}
