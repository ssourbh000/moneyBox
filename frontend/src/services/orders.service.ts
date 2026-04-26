import api from '@/lib/api';

export const ordersService = {
  async getOrders(params: { mode?: string; status?: string; limit?: number } = {}) {
    const { data } = await api.get('/orders', { params });
    return data as {
      _id: string;
      symbol: string;
      exchange: string;
      side: 'BUY' | 'SELL';
      orderType: string;
      quantity: number;
      price?: number;
      averagePrice?: number;
      filledQuantity: number;
      status: 'PENDING' | 'OPEN' | 'COMPLETE' | 'CANCELLED' | 'REJECTED';
      mode: 'paper' | 'live';
      rejectionReason?: string;
      createdAt: string;
    }[];
  },
};
