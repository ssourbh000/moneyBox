import api from '@/lib/api';

export interface HBTrade {
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

export interface HBMetrics {
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

export interface HBRun {
  _id: string;
  fromDate: string;
  toDate: string;
  status: string;
  errorMessage?: string;
  metrics?: HBMetrics;
  trades?: HBTrade[];
  createdAt: string;
}

export const hftBacktestService = {
  run:  (fromDate: string, toDate: string) =>
    api.post<HBRun>('/hft-backtest/run', { fromDate, toDate }).then((r) => r.data),

  list: () =>
    api.get<HBRun[]>('/hft-backtest/list').then((r) => r.data),

  get:  (id: string) =>
    api.get<HBRun>(`/hft-backtest/${id}`).then((r) => r.data),
};
