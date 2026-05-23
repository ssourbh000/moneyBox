import api from '@/lib/api';
import type { OBRun } from './option-backtest.service';

export const vwapScalpService = {
  run:  (fromDate: string, toDate: string) => api.post<OBRun>('/vwap-scalp/run', { fromDate, toDate }).then(r => r.data),
  list: () => api.get<OBRun[]>('/vwap-scalp/list').then(r => r.data),
  get:  (id: string) => api.get<OBRun>(`/vwap-scalp/${id}`).then(r => r.data),
};
