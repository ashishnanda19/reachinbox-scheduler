import { request } from './client';
import type { Me } from './types';

export const getMe = () => request<Me>('/api/auth/me');
export const logout = () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
