export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed';

export interface EmailItem {
  id: string;
  recipient: string;
  subject: string;
  preview: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  senderId: string;
  senderEmail: string;
  error: string | null;
  attachmentCount: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface SearchPage extends Page<EmailItem> {
  source: 'elasticsearch' | 'sql';
}

export interface AttachmentMeta {
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

export interface EmailDetail extends EmailItem {
  body: string;
  senderName: string;
  attempts: number;
  previewUrl: string | null;
  messageId: string | null;
  attachments: AttachmentMeta[];
}

export interface Stats {
  scheduled: number;
  sent: number;
  failed: number;
}

export interface Sender {
  id: string;
  email: string;
  displayName: string;
}

export interface Me {
  name: string;
  email: string;
  avatar_url: string | null;
}

export interface SlackStatus {
  connected: boolean;
  channel: string | null;
}

export interface AttachmentUpload {
  filename: string;
  contentType: string;
  dataBase64: string;
}

export interface CreateCampaignRequest {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenMs: number;
  hourlyLimit: number;
  senderId?: string;
  attachments?: AttachmentUpload[];
}

export interface CreateCampaignResponse {
  id: string;
  total: number;
  hourlyLimit: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
  enqueued: boolean;
}
