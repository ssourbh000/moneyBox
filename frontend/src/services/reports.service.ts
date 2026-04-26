import api from '@/lib/api';

export const reportsService = {
  async getDailyPnl(days = 30) {
    const { data } = await api.get('/reports/daily-pnl', { params: { days } });
    return data as { date: string; realizedPnl: number; totalTrades: number; wins: number; losses: number }[];
  },

  async getMonthlySummary(months = 6) {
    const { data } = await api.get('/reports/monthly-summary', { params: { months } });
    return data as { month: string; realizedPnl: number; totalTrades: number; wins: number; losses: number; winRate: number }[];
  },

  async getTradeJournal(limit = 100) {
    const { data } = await api.get('/reports/trade-journal', { params: { limit } });
    return data as {
      _id: string;
      symbol: string;
      exchange: string;
      quantity: number;
      entryPrice: number;
      exitPrice: number;
      realizedPnl: number;
      openedAt: string;
      closedAt: string;
      holdingHours: number | null;
      strategyName: string;
      result: 'WIN' | 'LOSS' | 'BREAKEVEN';
    }[];
  },

  async getPerformanceSummary() {
    const { data } = await api.get('/reports/performance');
    return data as {
      totalTrades: number;
      wins: number;
      losses: number;
      winRate: number;
      totalPnl: number;
      grossProfit: number;
      grossLoss: number;
      profitFactor: number;
      avgWin: number;
      avgLoss: number;
      bestTrade: { symbol: string; pnl: number } | null;
      worstTrade: { symbol: string; pnl: number } | null;
      currentStreak: number;
      streakType: 'WIN' | 'LOSS';
      tradingDays: number;
    };
  },
};
