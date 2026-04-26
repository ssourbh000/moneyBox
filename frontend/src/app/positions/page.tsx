'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import Badge from '@/components/ui/Badge';
import { Briefcase, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { portfolioService } from '@/services/portfolio.service';

type Position = Awaited<ReturnType<typeof portfolioService.getAllPositions>>[number];
type Tab = 'open' | 'closed';

function pnlClass(v: number) {
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400';
}

function fmt(v: number) {
  return (v >= 0 ? '+' : '') + '₹' + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function fmtPrice(v: number) {
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [tab, setTab] = useState<Tab>('open');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await portfolioService.getAllPositions(200);
      setPositions(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = positions.filter((p) => !p.isClosed);
  const closed = positions.filter((p) => p.isClosed);
  const visible = tab === 'open' ? open : closed;

  const openPnl = open.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
  const closedPnl = closed.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Positions</h1>
            <p className="text-gray-500 text-sm mt-1">Open and closed positions</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <p className="text-xs text-gray-500 mb-1">Open Positions</p>
            <p className="text-xl font-bold text-white">{open.length}</p>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <p className="text-xs text-gray-500 mb-1">Unrealized P&L</p>
            <p className={`text-xl font-bold ${pnlClass(openPnl)}`}>{fmt(openPnl)}</p>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <p className="text-xs text-gray-500 mb-1">Closed Trades</p>
            <p className="text-xl font-bold text-white">{closed.length}</p>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <p className="text-xs text-gray-500 mb-1">Realized P&L</p>
            <p className={`text-xl font-bold ${pnlClass(closedPnl)}`}>{fmt(closedPnl)}</p>
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
            <div className="flex gap-2">
              {(['open', 'closed'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                    tab === t
                      ? 'bg-emerald-600 text-white'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)} ({t === 'open' ? open.length : closed.length})
                </button>
              ))}
            </div>
            <Badge variant="blue">Paper</Badge>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500 text-sm">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <Briefcase className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">No {tab} positions</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-500 text-xs uppercase tracking-wide">
                    <th className="text-left px-5 py-3">Symbol</th>
                    <th className="text-right px-4 py-3">Qty</th>
                    <th className="text-right px-4 py-3">Avg Cost</th>
                    {tab === 'open' ? (
                      <>
                        <th className="text-right px-4 py-3">LTP</th>
                        <th className="text-right px-4 py-3">Unrealized P&L</th>
                      </>
                    ) : (
                      <>
                        <th className="text-right px-4 py-3">Exit Price</th>
                        <th className="text-right px-4 py-3">Realized P&L</th>
                      </>
                    )}
                    <th className="text-left px-4 py-3">Opened</th>
                    {tab === 'closed' && <th className="text-left px-4 py-3">Closed</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {visible.map((pos) => {
                    const pnl = tab === 'open' ? (pos.unrealizedPnl ?? 0) : (pos.realizedPnl ?? 0);
                    return (
                      <tr key={pos._id} className="hover:bg-gray-700/30 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {pnl > 0 ? (
                              <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0" />
                            )}
                            <span className="font-medium text-white">{pos.symbol}</span>
                            <span className="text-xs text-gray-500">{pos.exchange}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-200">{pos.quantity}</td>
                        <td className="px-4 py-3 text-right text-gray-400">{fmtPrice(pos.averageCost)}</td>
                        <td className="px-4 py-3 text-right text-gray-400">{fmtPrice(pos.lastPrice)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${pnlClass(pnl)}`}>{fmt(pnl)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {pos.openedAt ? new Date(pos.openedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                        </td>
                        {tab === 'closed' && (
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {pos.closedAt ? new Date(pos.closedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
