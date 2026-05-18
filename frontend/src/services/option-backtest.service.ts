import api from '@/lib/api';

export interface OBTrade {
  symbol: string;
  direction: 'CALL' | 'PUT';
  entryTime: string;
  exitTime: string;
  strike: number;
  entryPremium: number;
  exitPremium: number;
  lots: number;
  lotSize: number;
  netPnl: number;
  exitReason: string;
  vix: number;
  meta: Record<string, number | string>;
}

export interface OBMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  roi: number;
  finalCapital: number;
  equityCurve: { t: string; e: number }[];
}

export interface OBRun {
  _id: string;
  fromDate: string;
  toDate: string;
  status: string;
  errorMessage?: string;
  metrics?: OBMetrics;
  trades?: OBTrade[];
  createdAt: string;
}

export interface SeedResult {
  series: string;
  fetched: number;
  stored: number;
  error?: string;
}

export const optionBacktestService = {
  seed: (fromDate: string, toDate: string) =>
    api.post<SeedResult[]>('/market-data/seed-index', { fromDate, toDate }).then((r) => r.data),

  seedAngel: (fromDate: string, toDate: string) =>
    api.post<SeedResult[]>('/market-data/seed-angel', { fromDate, toDate }).then((r) => r.data),

  run: (fromDate: string, toDate: string) =>
    api.post<OBRun>('/option-backtest/run', { fromDate, toDate }).then((r) => r.data),

  list: () =>
    api.get<OBRun[]>('/option-backtest/list').then((r) => r.data),

  get: (id: string) =>
    api.get<OBRun>(`/option-backtest/${id}`).then((r) => r.data),
};

export const liveSignalService = {
  today: () => api.get('/live-signal/today').then((r) => r.data),
  recent: (days = 30) => api.get(`/live-signal/recent?days=${days}`).then((r) => r.data),
  summary: (days = 30) => api.get(`/live-signal/summary?days=${days}`).then((r) => r.data),
};
