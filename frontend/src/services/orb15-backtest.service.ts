import api from '@/lib/api';
import type { OBRun } from './option-backtest.service';

export const orb15BacktestService = {
  run:  (fromDate: string, toDate: string, initialCapital = 100_000) => api.post<OBRun>('/orb15-backtest/run', { fromDate, toDate, initialCapital }).then(r => r.data),
  list: () => api.get<OBRun[]>('/orb15-backtest/list').then(r => r.data),
  get:  (id: string) => api.get<OBRun>(`/orb15-backtest/${id}`).then(r => r.data),
};
