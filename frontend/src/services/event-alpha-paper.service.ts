import api from '@/lib/api';

export interface EATrade {
  date: string;
  status: 'OPEN' | 'CLOSED' | 'SKIPPED' | 'WAITING';
  eventType?: string;
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
    eventType: string;
  };
}

export const eventAlphaPaperService = {
  today:     () => api.get<EATrade>('/event-alpha-paper/today').then(r => r.data),
  recent:    (days = 60) => api.get<EATrade[]>(`/event-alpha-paper/recent?days=${days}`).then(r => r.data),
  summary:   (days = 60) => api.get<Summary>(`/event-alpha-paper/summary?days=${days}`).then(r => r.data),
  lastTick:  () => api.get<LastTick>('/event-alpha-paper/last-tick').then(r => r.data),
  forceTick: () => api.post<LastTick>('/event-alpha-paper/force-tick').then(r => r.data),
};
