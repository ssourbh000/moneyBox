import api from '@/lib/api';

export const riskService = {
  async getStatus() {
    const { data } = await api.get('/risk/status');
    return data as { killSwitchActive: boolean };
  },

  async activateKillSwitch() {
    const { data } = await api.post('/risk/kill-switch/activate');
    return data as { activated: boolean; message: string };
  },

  async deactivateKillSwitch() {
    const { data } = await api.delete('/risk/kill-switch');
    return data as { activated: boolean; message: string };
  },

  async getEvents() {
    const { data } = await api.get('/risk/events');
    return data as {
      _id: string;
      eventType: string;
      message: string;
      halted: boolean;
      createdAt: string;
    }[];
  },
};
