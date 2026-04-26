import api from '@/lib/api';

export type CandleInterval =
  | 'minute' | '3minute' | '5minute' | '10minute' | '15minute'
  | '30minute' | '60minute' | 'day' | 'week' | 'month';

export const marketDataService = {
  async syncInstruments(exchanges = ['NSE', 'BSE', 'NFO']) {
    const { data } = await api.post('/market-data/instruments/sync', { exchanges });
    return data as { synced: number };
  },

  async searchInstruments(q: string, exchange?: string, limit = 20) {
    const params: Record<string, any> = { q, limit };
    if (exchange) params.exchange = exchange;
    const { data } = await api.get('/market-data/instruments/search', { params });
    return data as any[];
  },

  async fetchCandles(symbol: string, exchange: string, interval: CandleInterval, from: string, to: string) {
    const { data } = await api.post('/market-data/candles/fetch', { symbol, exchange, interval, from, to });
    return data as { fetched: number; stored: number };
  },

  async bulkFetch(symbols: string[], exchange: string, interval: CandleInterval, from: string, to: string) {
    const { data } = await api.post('/market-data/candles/bulk-fetch', { symbols, exchange, interval, from, to });
    return data as { symbol: string; fetched: number; stored: number; error?: string }[];
  },

  async getCandles(symbol: string, exchange: string, interval: CandleInterval, from: string, to: string) {
    const { data } = await api.get('/market-data/candles', { params: { symbol, exchange, interval, from, to } });
    return data as any[];
  },

  async getCoverage(symbol: string, exchange: string, interval: CandleInterval) {
    const { data } = await api.get('/market-data/candles/coverage', { params: { symbol, exchange, interval } });
    return data;
  },

  async getBrokerStatus() {
    const { data } = await api.get('/broker/status');
    return data as { connected: boolean; clientId?: string; tokenExpiresAt?: string; status: string };
  },

  async getBrokerLoginUrl() {
    const { data } = await api.get('/broker/zerodha/login');
    return data as { url: string };
  },

  async disconnectBroker() {
    await api.delete('/broker/disconnect');
  },

  async handleBrokerCallback(requestToken: string | null, status: string | null) {
    console.log('[handleBrokerCallback] Input:', { requestToken, status, tokenLength: requestToken?.length });
    if (!requestToken || !status) {
      return { success: false, error: 'Missing request_token or status' };
    }
    console.log('[handleBrokerCallback] Calling API with token:', requestToken.substring(0, 30));
    const { data } = await api.post('/broker/zerodha/callback', {}, {
      params: { request_token: requestToken, status },
    });
    console.log('[handleBrokerCallback] Response:', data);
    return data as { success: boolean; error?: string };
  },

  async completeKiteCallback(callbackId: string) {
    console.log('[completeKiteCallback] Completing with ID:', callbackId);
    const { data } = await api.post('/broker/zerodha/complete', {}, {
      params: { callback_id: callbackId },
    });
    console.log('[completeKiteCallback] Response:', data);
    return data as { success: boolean; error?: string };
  },

  async initPaperTrading() {
    const { data } = await api.post('/broker/paper/init');
    return data;
  },
};
