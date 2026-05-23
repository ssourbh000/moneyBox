import api from '@/lib/api';
import type { OBRun } from './option-backtest.service';

export const expirySpreadBacktestService = {
  run:  (fromDate: string, toDate: string) => api.post<OBRun>('/expiry-spread-backtest/run', { fromDate, toDate }).then(r => r.data),
  list: () => api.get<OBRun[]>('/expiry-spread-backtest/list').then(r => r.data),
  get:  (id: string) => api.get<OBRun>(`/expiry-spread-backtest/${id}`).then(r => r.data),
};
