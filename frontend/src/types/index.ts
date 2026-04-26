export interface User {
  _id: string;
  email: string;
  name?: string;
  role: 'admin' | 'trader';
  isActive: boolean;
  lastLoginAt?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Strategy {
  _id: string;
  name: string;
  description?: string;
  status: 'active' | 'paused' | 'stopped';
  mode: 'paper' | 'live';
  universe: string[];
  parameters: Record<string, unknown>;
  riskLimits: {
    maxDailyLoss?: number;
    maxOpenPositions?: number;
    maxPositionSize?: number;
    maxExposurePercent?: number;
  };
  totalTrades: number;
  winRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface Position {
  _id: string;
  symbol: string;
  exchange: string;
  mode: string;
  quantity: number;
  averageCost: number;
  lastPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  isClosed: boolean;
  openedAt: string;
}

export interface Order {
  _id: string;
  symbol: string;
  exchange: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  quantity: number;
  price?: number;
  status: 'PENDING' | 'OPEN' | 'COMPLETE' | 'CANCELLED' | 'REJECTED';
  averagePrice?: number;
  filledQuantity: number;
  mode: 'paper' | 'live';
  createdAt: string;
}

export interface BacktestRun {
  _id: string;
  strategyId: string;
  fromDate: string;
  toDate: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  metrics?: {
    totalTrades?: number;
    winRate?: number;
    profitFactor?: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    netPnl?: number;
    expectancy?: number;
  };
  createdAt: string;
}

export interface DailyPnl {
  date: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
}
