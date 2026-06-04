import api from '@/lib/api';

export interface PortfolioRun {
  _id: string;
  fromDate: string;
  toDate: string;
  startingCapital: number;
  status: string;
  errorMessage?: string;
  metrics?: PortfolioMetrics;
  trades?: any[];
}

export interface StrategyStats {
  strategy: 'ORB' | 'C1' | 'EVENT';
  trades: number;
  winRate: number;
  netPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  contribution: number;
}

export interface MonthlyRow {
  month: string;
  orb: number;
  c1: number;
  event: number;
  total: number;
  orbN: number;
  c1N: number;
  eventN: number;
}

export interface PortfolioMetrics {
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
  startingCapital: number;
  winningMonths: number;
  losingMonths: number;
  bestMonth: { month: string; pnl: number };
  worstMonth: { month: string; pnl: number };
  strategyStats: StrategyStats[];
  monthlyBreakdown: MonthlyRow[];
  equityCurve: { t: string; e: number }[];
}

export const portfolioBacktestService = {
  run:  (fromDate: string, toDate: string, startingCapital: number) =>
    api.post<PortfolioRun>('/portfolio-backtest/run', { fromDate, toDate, startingCapital }).then(r => r.data),
  list: () => api.get<PortfolioRun[]>('/portfolio-backtest/list').then(r => r.data),
  get:  (id: string) => api.get<PortfolioRun>(`/portfolio-backtest/${id}`).then(r => r.data),
};
