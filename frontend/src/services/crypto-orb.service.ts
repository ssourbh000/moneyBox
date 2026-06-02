import api from '@/lib/api';

export interface CryptoTrade {
  _id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice?: number;
  entryTime: string;
  exitTime?: string;
  exitReason?: string;
  status: string;
  slPrice: number;
  quantity: number;
  peakPrice?: number;
  trailSL: boolean;
  partialBooked: boolean;
  netPnlUsdt?: number;
  capitalBefore?: number;
  capitalAfter?: number;
  sessionKey?: string;
  meta?: Record<string, string | number>;
}

export interface CryptoAccount {
  startingCapital: number;
  currency: string;
  equity: number;
  netPnl: number;
  roi: number;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  equityCurve: { date: string; equity: number }[];
}

export const cryptoOrbService = {
  account: () => api.get<CryptoAccount>('/crypto-orb/account').then(r => r.data),
  today:   () => api.get<CryptoTrade[]>('/crypto-orb/today').then(r => r.data),
  recent:  (days = 30) => api.get<CryptoTrade[]>(`/crypto-orb/recent?days=${days}`).then(r => r.data),
  forceTick: () => api.post('/crypto-orb/force-tick').then(r => r.data),
  closeAll:  () => api.post('/crypto-orb/close-all').then(r => r.data),
};
