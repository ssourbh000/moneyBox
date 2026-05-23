import api from '@/lib/api';
import type { OBRun } from './option-backtest.service';

export const emacrossBacktestService = {
  run:  (fromDate: string, toDate: string) => api.post<OBRun>('/emacross-backtest/run', { fromDate, toDate }).then(r => r.data),
  list: () => api.get<OBRun[]>('/emacross-backtest/list').then(r => r.data),
  get:  (id: string) => api.get<OBRun>(`/emacross-backtest/${id}`).then(r => r.data),
};
