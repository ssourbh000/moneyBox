import api from '@/lib/api';

export const portfolioService = {
  async getSummary() {
    const { data } = await api.get('/portfolio/summary');
    return data as {
      date: string;
      realizedPnl: number;
      unrealizedPnl: number;
      totalTrades: number;
      wins: number;
      losses: number;
      winRate: string;
      openPositions: number;
    };
  },

  async getOpenPositions(strategyId?: string) {
    const { data } = await api.get('/portfolio/positions', { params: strategyId ? { strategyId } : {} });
    return data as any[];
  },

  async getAllPositions(limit = 100) {
    const { data } = await api.get('/portfolio/positions/all', { params: { limit } });
    return data as any[];
  },

  async getDailyPnl(days = 30) {
    const { data } = await api.get('/portfolio/pnl/daily', { params: { days } });
    return data as { date: string; realizedPnl: number; totalTrades: number; wins: number; losses: number }[];
  },
};
