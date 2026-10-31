import { request } from './client';
import type { SlackStatus } from './types';

export const getSlackStatus = () => request<SlackStatus>('/api/slack/status');
export const disconnectSlack = () => request<SlackStatus>('/api/slack/disconnect', { method: 'DELETE' });
