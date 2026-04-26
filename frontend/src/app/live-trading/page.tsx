'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import Badge from '@/components/ui/Badge';
import StatCard from '@/components/ui/StatCard';
import { Zap, AlertTriangle, CheckCircle, Circle, RefreshCw } from 'lucide-react';
import { portfolioService } from '@/services/portfolio.service';
import { strategiesService } from '@/services/strategies.service';
import { riskService } from '@/services/risk.service';

interface Prerequisite {
  label: string;
  description: string;
  met: boolean;
}

export default function LiveTradingPage() {
  const [summary, setSummary] = useState<any>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [killActive, setKillActive] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, strats, riskStatus] = await Promise.all([
        portfolioService.getSummary(),
        strategiesService.list(),
        riskService.getStatus(),
      ]);
      setSummary(sum);
      setStrategies(strats);
      setKillActive(riskStatus.killSwitchActive);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeStrategies = strategies.filter((s) => s.status === 'running');
  const hasStrategy = strategies.length > 0;
  const hasRiskLimits = strategies.some(
    (s) => s.riskLimits?.maxDailyLoss > 0 && s.riskLimits?.maxOpenPositions > 0,
  );
  const hasTrades = (summary?.totalTrades ?? 0) > 0;
  const killSwitchOk = !killActive;

  const prerequisites: Prerequisite[] = [
    {
      label: 'Strategy created',
      description: 'At least one trading strategy must exist',
      met: hasStrategy,
    },
    {
      label: 'Risk limits configured',
      description: 'Max daily loss and max open positions must be set',
      met: hasRiskLimits,
    },
    {
      label: 'Paper trading session completed',
      description: 'At least one paper trade executed successfully',
      met: hasTrades,
    },
    {
      label: 'Kill switch inactive',
      description: 'Emergency halt must be off before enabling live mode',
      met: killSwitchOk,
    },
    {
      label: 'Broker connected',
      description: 'Real Zerodha account connected in Settings',
      met: false, // intentionally false — this requires manual verification
    },
  ];

  const metCount = prerequisites.filter((p) => p.met).length;
  const allMet = metCount === prerequisites.length;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Live Trading</h1>
            <p className="text-gray-500 text-sm mt-1">Real capital execution — requires broker connection</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={allMet ? 'yellow' : 'gray'}>
              {allMet ? 'Ready to Enable' : 'Locked'}
            </Badge>
            <button
              onClick={load}
              disabled={loading}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Paper trading stats as baseline */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Paper Trades (Today)"
            value={summary ? String(summary.totalTrades) : '—'}
            sub={summary?.totalTrades ? `${summary.wins}W / ${summary.losses}L` : ''}
          />
          <StatCard
            label="Paper Win Rate"
            value={summary?.totalTrades ? `${summary.winRate}%` : '—'}
            positive={parseFloat(summary?.winRate) >= 50}
          />
          <StatCard
            label="Active Strategies"
            value={String(activeStrategies.length)}
            sub={`${strategies.length} total`}
          />
          <StatCard
            label="Prerequisites"
            value={`${metCount}/${prerequisites.length}`}
            positive={allMet}
            negative={!allMet}
          />
        </div>

        {/* Prerequisites checklist */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-700">
            <h2 className="text-sm font-semibold text-gray-300">Prerequisites Checklist</h2>
            <p className="text-xs text-gray-600 mt-0.5">Complete all requirements before enabling live trading</p>
          </div>
          <div className="divide-y divide-gray-700/50">
            {prerequisites.map((p) => (
              <div key={p.label} className="px-5 py-4 flex items-start gap-4">
                {p.met ? (
                  <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <Circle className="w-5 h-5 text-gray-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className={`text-sm font-medium ${p.met ? 'text-white' : 'text-gray-500'}`}>{p.label}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{p.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Warning / Enable section */}
        <div className={`border rounded-xl p-6 flex items-start gap-4 ${allMet ? 'bg-yellow-500/5 border-yellow-500/30' : 'bg-gray-800 border-gray-700'}`}>
          <AlertTriangle className={`w-5 h-5 mt-0.5 shrink-0 ${allMet ? 'text-yellow-400' : 'text-gray-600'}`} />
          <div className="flex-1">
            <h3 className={`text-sm font-semibold mb-2 ${allMet ? 'text-yellow-400' : 'text-gray-500'}`}>
              {allMet ? 'All prerequisites met — live trading can be enabled' : 'Live trading is locked'}
            </h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              Live trading uses real capital. Once enabled, the strategy engine will route orders through your connected
              Zerodha account instead of simulating them. All existing risk controls (kill switch, max daily loss,
              position limits) apply to live orders.
            </p>
            <button
              disabled={!allMet}
              className="mt-4 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Enable Live Trading
              </div>
            </button>
            {!allMet && (
              <p className="mt-2 text-xs text-gray-600">
                Complete all {prerequisites.length - metCount} remaining prerequisite{prerequisites.length - metCount > 1 ? 's' : ''} above to unlock
              </p>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
