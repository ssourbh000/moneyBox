'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import Badge from '@/components/ui/Badge';
import { Settings, Link2, Database, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { marketDataService } from '@/services/market-data.service';

type BrokerStatus = {
  connected: boolean;
  clientId?: string;
  tokenExpiresAt?: string;
  status: string;
};

export default function SettingsPage() {
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const loadBrokerStatus = useCallback(async () => {
    try {
      const status = await marketDataService.getBrokerStatus();
      if (status && typeof status === 'object' && 'connected' in status) {
        setBrokerStatus(status);
      } else {
        setBrokerStatus({ connected: false, status: 'disconnected' });
      }
    } catch (err) {
      console.error('Broker status error:', err);
      setBrokerStatus({ connected: false, status: 'disconnected' });
    }
  }, []);

  useEffect(() => {
    const handleCallback = async () => {
      loadBrokerStatus();
      const params = new URLSearchParams(window.location.search);
      const callbackId = params.get('kite_callback');
      const brokerResult = params.get('broker');

      if (callbackId) {
        setSyncResult('Completing broker connection...');
        try {
          const result = await marketDataService.completeKiteCallback(callbackId);
          if (result?.success) {
            setSyncResult('Broker connected successfully.');
            await loadBrokerStatus();
          } else {
            setSyncResult(`Connection failed: ${result?.error || 'Unknown error'}`);
          }
        } catch (err: any) {
          const msg = typeof err.response?.data?.message === 'string'
            ? err.response.data.message
            : 'Broker connection failed.';
          setSyncResult(msg);
        }
        window.history.replaceState({}, '', '/settings');
      } else if (brokerResult === 'connected') {
        setSyncResult('Broker connected successfully.');
        await loadBrokerStatus();
        window.history.replaceState({}, '', '/settings');
      } else if (brokerResult === 'error') {
        setSyncResult('Broker connection failed. Check your API credentials.');
        window.history.replaceState({}, '', '/settings');
      }
    };

    handleCallback();
  }, [loadBrokerStatus]);

  async function handleConnect() {
    setConnecting(true);
    try {
      const result = await marketDataService.getBrokerLoginUrl();
      if (result?.url) {
        window.location.href = result.url;
      } else {
        setSyncResult('Failed to get login URL. Check KITE_API_KEY in backend .env');
        setConnecting(false);
      }
    } catch (err: any) {
      const msg = typeof err.response?.data?.message === 'string' ? err.response.data.message : 'Failed to get login URL. Check KITE_API_KEY in backend .env';
      setSyncResult(msg);
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await marketDataService.disconnectBroker();
    await loadBrokerStatus();
  }

  async function handleSyncInstruments() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await marketDataService.syncInstruments(['NSE', 'BSE', 'NFO']);
      if (result?.synced) {
        setSyncResult(`Synced ${result.synced.toLocaleString()} instruments across NSE, BSE, NFO.`);
      } else {
        setSyncResult('Sync failed. Broker must be connected for instrument download.');
      }
    } catch (err: any) {
      const msg = typeof err.response?.data?.message === 'string' ? err.response.data.message : 'Sync failed. Broker must be connected for instrument download.';
      setSyncResult(msg);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-gray-500 text-sm mt-1">Broker connections, market data, and system config</p>
        </div>

        {syncResult && (
          <div className="text-sm bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-gray-300">
            {syncResult}
          </div>
        )}

        {/* Broker Connection */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 divide-y divide-gray-700">
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Link2 className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-300">Broker — Zerodha Kite</h2>
            </div>

            <div className="flex items-center justify-between">
              <div>
                {brokerStatus?.connected ? (
                  <>
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm text-emerald-400 font-medium">Connected</span>
                      <span className="text-xs text-gray-500">— {brokerStatus.clientId}</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      Session expires:{' '}
                      {brokerStatus.tokenExpiresAt
                        ? new Date(brokerStatus.tokenExpiresAt).toLocaleString()
                        : 'Unknown'}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-gray-600" />
                      <span className="text-sm text-gray-500">Not connected</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      Set KITE_API_KEY and KITE_API_SECRET in backend/.env first
                    </p>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                {brokerStatus?.connected ? (
                  <button
                    onClick={handleDisconnect}
                    className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={handleConnect}
                    disabled={connecting}
                    className="text-xs bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-gray-950 font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {connecting ? 'Redirecting…' : 'Connect with Zerodha'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Instrument Sync */}
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Database className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-300">Instrument Master</h2>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">NSE + BSE + NFO instruments</p>
                <p className="text-xs text-gray-600 mt-0.5">
                  Auto-syncs daily at 8:00 AM. Run manually after first setup.
                </p>
              </div>
              <button
                onClick={handleSyncInstruments}
                disabled={syncing}
                className="flex items-center gap-2 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing…' : 'Sync Now'}
              </button>
            </div>
          </div>

          {/* Trading Mode */}
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-300">Trading Mode</h2>
            </div>
            <div className="flex items-center gap-3">
              <button className="text-xs bg-blue-500/10 border border-blue-500/30 text-blue-400 font-medium px-4 py-1.5 rounded-lg">
                Paper (active)
              </button>
              <button
                disabled
                className="text-xs bg-gray-700 text-gray-600 px-4 py-1.5 rounded-lg cursor-not-allowed"
                title="Complete paper trading validation before enabling live mode"
              >
                Live (locked)
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              Live mode unlocks after: broker connected + backtest validated + 20 paper sessions completed + risk limits set.
            </p>
          </div>
        </div>

        {/* API info */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Backend Setup</h2>
          <div className="space-y-1.5 font-mono text-xs text-gray-500">
            <p><span className="text-gray-400">API base:</span> http://localhost:3001/api</p>
            <p><span className="text-gray-400">Swagger:</span> http://localhost:3001/api/docs</p>
            <p><span className="text-gray-400">Kite callback:</span> http://localhost:3001/api/broker/zerodha/callback</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
