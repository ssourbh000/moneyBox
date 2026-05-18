'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { Activity, RefreshCw } from 'lucide-react';
import { liveSignalService } from '@/services/option-backtest.service';

interface PaperTrade {
  _id: string;
  symbol: string;
  direction: string;
  strike: number;
  entryPremium: number;
  exitPremium?: number;
  entryTime: string;
  exitTime?: string;
  exitReason?: string;
  status: string;
  slPremium: number;
  lots: number;
  lotSize: number;
  netPnl?: number;
  vix: number;
  meta: Record<string, any>;
}

interface Summary {
  total: number;
  open: number;
  closed: number;
  wins: number;
  winRate: number;
  netPnl: number;
}

export default function LiveSignalsPage() {
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [recent, sum] = await Promise.all([
        liveSignalService.recent(30),
        liveSignalService.summary(30),
      ]);
      setTrades(recent);
      setSummary(sum);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity size={24} className="text-green-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Live Paper Trading</h1>
              <p className="text-sm text-gray-400">Auto-refreshes every 30s — signals fire every 5 min during market hours</p>
            </div>
          </div>
          <button onClick={refresh} disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Summary */}
        {summary && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[
              { label: 'Total (30d)', value: summary.total },
              { label: 'Open', value: summary.open },
              { label: 'Closed', value: summary.closed },
              { label: 'Wins', value: summary.wins },
              { label: 'Win Rate', value: `${summary.winRate}%` },
              { label: 'Net P&L', value: `₹${summary.netPnl.toLocaleString()}`, color: summary.netPnl >= 0 ? 'text-green-400' : 'text-red-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gray-800 rounded-lg p-3">
                <p className="text-xs text-gray-400">{label}</p>
                <p className={`text-lg font-bold ${color ?? 'text-white'}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Trades table */}
        <div className="bg-gray-800 rounded-lg p-4 overflow-x-auto">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Paper Trades (last 30 days)</h2>
          {trades.length === 0 ? (
            <p className="text-sm text-gray-500">No paper trades yet. Signals fire automatically during market hours (9:30–10:30 AM IST) when conditions align.</p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-700">
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Dir</th>
                  <th className="py-2 px-3">Strike</th>
                  <th className="py-2 px-3">Entry ₹</th>
                  <th className="py-2 px-3">SL ₹</th>
                  <th className="py-2 px-3">Exit ₹</th>
                  <th className="py-2 px-3">Lots</th>
                  <th className="py-2 px-3">P&amp;L</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t._id} className="border-b border-gray-700 text-sm">
                    <td className="py-2 px-3 text-gray-300">{t.symbol}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${t.direction === 'CALL' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                        {t.direction}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-300">{t.strike}</td>
                    <td className="py-2 px-3 text-gray-300">₹{t.entryPremium}</td>
                    <td className="py-2 px-3 text-red-400">₹{t.slPremium}</td>
                    <td className="py-2 px-3 text-gray-400">{t.exitPremium ? `₹${t.exitPremium}` : '—'}</td>
                    <td className="py-2 px-3 text-gray-400">{t.lots}</td>
                    <td className={`py-2 px-3 font-medium ${(t.netPnl ?? 0) > 0 ? 'text-green-400' : t.netPnl != null ? 'text-red-400' : 'text-gray-400'}`}>
                      {t.netPnl != null ? `${t.netPnl >= 0 ? '+' : ''}₹${t.netPnl.toLocaleString()}` : '—'}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${t.status === 'OPEN' ? 'bg-yellow-900 text-yellow-300' : 'bg-gray-700 text-gray-300'}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-500">
                      {new Date(t.entryTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
