import { request } from './client';
import type { CreateCampaignRequest, CreateCampaignResponse } from './types';

export const createCampaign = (body: CreateCampaignRequest) =>
  request<CreateCampaignResponse>('/api/campaigns', { method: 'POST', body });
