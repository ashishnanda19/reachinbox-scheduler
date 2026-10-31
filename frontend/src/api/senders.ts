import { request } from './client';
import type { Sender } from './types';

export const listSenders = () => request<Sender[]>('/api/senders');
export const createSender = () => request<Sender>('/api/senders', { method: 'POST' });
