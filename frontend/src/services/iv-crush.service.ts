import api from '@/lib/api';

export interface IVCTrade {
  date: string;
  status: 'OPEN' | 'CLOSED' | 'SKIPPED' | 'WAITING';
  entryTime?: string;
  exitTime?: string;
  spot?: number;
  strike?: number;
  entryStraddle?: number;
  exitStraddle?: number;
  lots?: number;
  vix?: number;
  gapPct?: number;
  grossPnl?: number;
  netPnl?: number;
  exitReason?: string;
  skipReason?: string;
  currentStraddle?: number;
  currentPnl?: number;
  lastUpdated?: string;
}

export interface Summary {
  total: number;
  wins: number;
  losses: number;
  skipped: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
}

export interface LastTick {
  time: string;
  istHHMM: number;
  status: string;
  message: string;
  trade?: {
    spot: number;
    strike: number;
    entryStraddle: number;
    currentStraddle: number;
    pnlPct: number;
    pnl: number;
    lots: number;
  };
}

export const ivCrushService = {
  today:     () => api.get<IVCTrade>('/iv-crush/today').then(r => r.data),
  recent:    (days = 60) => api.get<IVCTrade[]>(`/iv-crush/recent?days=${days}`).then(r => r.data),
  summary:   (days = 60) => api.get<Summary>(`/iv-crush/summary?days=${days}`).then(r => r.data),
  lastTick:  () => api.get<LastTick>('/iv-crush/last-tick').then(r => r.data),
  forceTick: () => api.post<LastTick>('/iv-crush/force-tick').then(r => r.data),
};
