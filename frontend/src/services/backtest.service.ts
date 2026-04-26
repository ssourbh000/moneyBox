import api from '@/lib/api';

export interface FullMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  roi: number;
  finalCapital: number;
  tradingDays: number;
  fromDate?: string;
  toDate?: string;
}

export interface EquityPoint {
  t: string;
  e: number;
}

export interface BacktestRunFull {
  _id: string;
  strategyId: string;
  fromDate: string;
  toDate: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  parameters?: Record<string, unknown>;
  metrics?: FullMetrics & {
    equityCurve?: EquityPoint[];
    inSampleMetrics?: FullMetrics;
    outOfSampleMetrics?: FullMetrics;
  };
  trades?: BacktestTrade[];
  errorMessage?: string;
  completedAt?: string;
  createdAt: string;
}

export interface BacktestTrade {
  symbol: string;
  direction: 'LONG';
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  quantity: number;
  exitReason: 'STOP' | 'TARGET' | 'EOD';
  grossPnl: number;
  costs: number;
  netPnl: number;
  capitalBefore: number;
  capitalAfter: number;
  meta: Record<string, number | string>;
}

export interface RunBacktestPayload {
  strategyId: string;
  fromDate: string;
  toDate: string;
  inSampleRatio?: number;
  costConfig?: {
    brokeragePerSide?: number;
    brokerageRatePct?: number;
    otherChargesPct?: number;
  };
}

export const backtestService = {
  async run(payload: RunBacktestPayload): Promise<BacktestRunFull> {
    const { data } = await api.post('/backtest', payload);
    return data;
  },

  async list(): Promise<BacktestRunFull[]> {
    const { data } = await api.get('/backtest');
    return data;
  },

  async get(id: string): Promise<BacktestRunFull> {
    const { data } = await api.get(`/backtest/${id}`);
    return data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/backtest/${id}`);
  },
};
