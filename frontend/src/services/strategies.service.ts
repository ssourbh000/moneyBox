import api from '@/lib/api';
import { Strategy } from '@/types';

export const strategiesService = {
  async list(): Promise<Strategy[]> {
    const { data } = await api.get<Strategy[]>('/strategies');
    return data;
  },

  async get(id: string): Promise<Strategy> {
    const { data } = await api.get<Strategy>(`/strategies/${id}`);
    return data;
  },

  async create(payload: any): Promise<Strategy> {
    const { data } = await api.post<Strategy>('/strategies', payload);
    return data;
  },

  async update(id: string, payload: Partial<Strategy>): Promise<Strategy> {
    const { data } = await api.patch<Strategy>(`/strategies/${id}`, payload);
    return data;
  },

  async start(id: string): Promise<Strategy> {
    const { data } = await api.post<Strategy>(`/strategies/${id}/start`);
    return data;
  },

  async stop(id: string): Promise<Strategy> {
    const { data } = await api.post<Strategy>(`/strategies/${id}/stop`);
    return data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/strategies/${id}`);
  },

  async getSignals(id: string, limit = 50): Promise<any[]> {
    const { data } = await api.get(`/strategies/${id}/signals`, { params: { limit } });
    return data;
  },

  async runEngine(): Promise<{ processed: number; signals: number }> {
    const { data } = await api.post('/strategies/engine/run');
    return data;
  },
};
