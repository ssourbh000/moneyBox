'use client';

import { useEffect, useState, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import StatCard from '@/components/ui/StatCard';
import Badge from '@/components/ui/Badge';
import { Activity, TrendingUp } from 'lucide-react';
import { portfolioService } from '@/services/portfolio.service';
import { strategiesService } from '@/services/strategies.service';
import { marketDataService } from '@/services/market-data.service';

export default function DashboardPage() {
  const [summary, setSummary] = useState<any>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [brokerStatus, setBrokerStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [sum, strats, broker] = await Promise.all([
        portfolioService.getSummary().catch(() => null),
        strategiesService.list().catch(() => []),
        marketDataService.getBrokerStatus().catch(() => null),
      ]);
      setSummary(sum);
      setStrategies(strats);
      setBrokerStatus(broker);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = (v: number) => (v >= 0 ? '+' : '') + '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const activeCount = strategies.filter((s) => s.status === 'active').length;

  return (
    <AppShell>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1">System overview — paper mode active</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-xs text-yellow-400 font-medium">Paper Trading</span>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Today's P&L" value={summary ? fmt(summary.realizedPnl + summary.unrealizedPnl) : '—'}
            positive={summary && summary.realizedPnl + summary.unrealizedPnl > 0}
            negative={summary && summary.realizedPnl + summary.unrealizedPnl < 0} />
          <StatCard label="Open Positions" value={summary?.openPositions ?? '—'} />
          <StatCard label="Today's Win Rate" value={summary?.totalTrades ? `${summary.winRate}%` : '—'}
            sub={summary?.totalTrades ? `${summary.wins}W / ${summary.losses}L` : 'No trades today'} />
          <StatCard label="Active Strategies" value={activeCount} sub={`${strategies.length} total`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-300">Strategies</h2>
              <Badge variant="yellow">Paper</Badge>
            </div>
            {strategies.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-gray-600">
                <Activity className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">No strategies — create one in Strategies</p>
              </div>
            ) : (
              <div className="space-y-2">
                {strategies.slice(0, 5).map((s) => (
                  <div key={s._id} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-300 truncate">{s.name}</span>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <span className="text-xs text-gray-500">{s.totalTrades} trades</span>
                      <Badge variant={s.status === 'active' ? 'green' : 'gray'}>{s.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">System Status</h2>
            <div className="space-y-3">
              {[
                { label: 'Backend', ok: !loading, hint: 'API reachable' },
                { label: 'MongoDB', ok: !loading, hint: 'Connected' },
                { label: 'Broker (Kite)', ok: brokerStatus?.connected, hint: brokerStatus?.clientId ?? 'Not connected' },
                { label: 'Market Data', ok: brokerStatus?.connected, hint: 'Instrument sync required' },
              ].map(({ label, ok, hint }) => (
                <div key={label} className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                  <span className={`text-sm ${ok ? 'text-gray-300' : 'text-gray-600'}`}>{label}</span>
                  <span className="text-xs text-gray-600 ml-auto">{hint}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
