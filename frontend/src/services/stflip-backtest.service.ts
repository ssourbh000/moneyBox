import api from '@/lib/api';
import type { OBRun } from './option-backtest.service';

export const stflipBacktestService = {
  run:  (fromDate: string, toDate: string) => api.post<OBRun>('/stflip-backtest/run', { fromDate, toDate }).then(r => r.data),
  list: () => api.get<OBRun[]>('/stflip-backtest/list').then(r => r.data),
  get:  (id: string) => api.get<OBRun>(`/stflip-backtest/${id}`).then(r => r.data),
};
