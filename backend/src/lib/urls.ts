import { config } from '../config.js';

const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`;

export const backendUrl = (path: string): string => join(config.BACKEND_URL, path);
export const frontendUrl = (path: string): string => join(config.FRONTEND_URL, path);
