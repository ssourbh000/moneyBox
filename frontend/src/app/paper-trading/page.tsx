'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import StatCard from '@/components/ui/StatCard';
import Badge from '@/components/ui/Badge';
import { FileText, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { portfolioService } from '@/services/portfolio.service';
import { strategiesService } from '@/services/strategies.service';

function pnlClass(v: number) {
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400';
}

function fmt(v: number) {
  return (v >= 0 ? '+' : '') + '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export default function PaperTradingPage() {
  const [summary, setSummary] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, pos, strats] = await Promise.all([
        portfolioService.getSummary(),
        portfolioService.getOpenPositions(),
        strategiesService.list(),
      ]);
      setSummary(sum);
      setPositions(pos);

      // Load signals from all active strategies
      const allSignals: any[] = [];
      for (const s of strats) {
        const sigs = await strategiesService.getSignals(s._id, 20);
        allSignals.push(...sigs.map((sig) => ({ ...sig, strategyName: s.name })));
      }
      allSignals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setSignals(allSignals.slice(0, 30));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Paper Trading</h1>
            <p className="text-gray-500 text-sm mt-1">Live simulation — no real capital</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="blue">Paper Mode</Badge>
            <button onClick={load} disabled={loading} className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Today's Realized P&L" value={summary ? fmt(summary.realizedPnl) : '—'}
            positive={summary?.realizedPnl > 0} negative={summary?.realizedPnl < 0} />
          <StatCard label="Unrealized P&L" value={summary ? fmt(summary.unrealizedPnl) : '—'}
            positive={summary?.unrealizedPnl > 0} negative={summary?.unrealizedPnl < 0} />
          <StatCard label="Today's Trades" value={summary?.totalTrades ?? '—'}
            sub={summary ? `${summary.wins}W / ${summary.losses}L` : ''} />
          <StatCard label="Win Rate (Today)" value={summary?.totalTrades ? `${summary.winRate}%` : '—'} />
        </div>

        {/* Open Positions */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">Open Positions ({positions.length})</h2>
          </div>
          {positions.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-gray-600">
              <FileText className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No open positions</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {positions.map((pos) => (
                <div key={pos._id} className="px-5 py-3 flex items-center gap-4">
                  <div className="flex-1">
                    <span className="font-medium text-white text-sm">{pos.symbol}</span>
                    <span className="ml-2 text-xs text-gray-500">{pos.exchange}</span>
                  </div>
                  <div className="text-xs text-gray-500 text-right">
                    <div>{pos.quantity} × ₹{pos.averageCost.toFixed(2)}</div>
                    <div>LTP ₹{pos.lastPrice.toFixed(2)}</div>
                  </div>
                  <div className={`text-sm font-medium text-right ${pnlClass(pos.unrealizedPnl)}`}>
                    {fmt(pos.unrealizedPnl)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Signal Feed */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="px-5 py-4 border-b border-gray-700">
            <h2 className="text-sm font-semibold text-gray-300">Signal Log</h2>
          </div>
          {signals.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-gray-600">
              <TrendingUp className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No signals yet</p>
              <p className="text-xs mt-1">Start a strategy and run the engine</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {signals.map((sig) => (
                <div key={sig._id} className="px-5 py-3 flex items-start gap-4">
                  <div className={`mt-0.5 ${sig.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {sig.direction === 'LONG' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{sig.symbol}</span>
                      <span className="text-xs text-gray-500">{sig.exchange}</span>
                      <Badge variant={sig.status === 'EXECUTED' ? 'green' : sig.status === 'REJECTED' ? 'red' : 'gray'}>
                        {sig.status}
                      </Badge>
                      {sig.strategyName && <span className="text-xs text-gray-600">{sig.strategyName}</span>}
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-gray-500">
                      <span>Entry ₹{sig.entryPrice?.toFixed(2)}</span>
                      <span>Stop ₹{sig.stopPrice?.toFixed(2)}</span>
                      <span>Target ₹{sig.targetPrice?.toFixed(2)}</span>
                      <span>Qty {sig.quantity}</span>
                    </div>
                    {sig.rejectionReason && <p className="text-xs text-red-400 mt-0.5">{sig.rejectionReason}</p>}
                    {sig.meta && (
                      <div className="flex gap-3 mt-1 text-xs text-gray-600">
                        <span>ADX {sig.meta.hourlyAdx}</span>
                        <span>RSI {sig.meta.hourlyRsi}</span>
                        <span>Vol ratio {sig.meta.volumeRatio}x</span>
                        <span>ATR {sig.meta.entryAtr}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-gray-600 shrink-0">
                    {new Date(sig.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
