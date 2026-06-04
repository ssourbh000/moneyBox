import api from '@/lib/api';
import type { OBRun } from './option-backtest.service';

export const eventAlphaBacktestService = {
  run:  (fromDate: string, toDate: string, initialCapital = 100_000) => api.post<OBRun>('/event-alpha-backtest/run', { fromDate, toDate, initialCapital }).then(r => r.data),
  list: () => api.get<OBRun[]>('/event-alpha-backtest/list').then(r => r.data),
  get:  (id: string) => api.get<OBRun>(`/event-alpha-backtest/${id}`).then(r => r.data),
};
