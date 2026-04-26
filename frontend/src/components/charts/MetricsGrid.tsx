'use client';

import type { FullMetrics } from '@/services/backtest.service';

interface Props {
  metrics: FullMetrics;
  label?: string;
}

function fmt(v: number, sign = true) {
  return (sign && v > 0 ? '+' : '') + '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function color(v: number, inverse = false) {
  if (inverse) return v < 0 ? 'text-emerald-400' : 'text-red-400';
  return v > 0 ? 'text-emerald-400' : 'text-red-400';
}

export default function MetricsGrid({ metrics, label }: Props) {
  const data = [
    { label: 'Net P&L', value: fmt(metrics.netPnl), colr: color(metrics.netPnl) },
    { label: 'Total Trades', value: metrics.totalTrades, colr: 'text-gray-300' },
    { label: 'Win Rate', value: `${metrics.winRate}%`, colr: color(metrics.winRate / 50 - 1) },
    { label: 'Profit Factor', value: metrics.profitFactor, colr: color(metrics.profitFactor - 1) },
    { label: 'Avg Win', value: fmt(metrics.avgWin), colr: 'text-emerald-400' },
    { label: 'Avg Loss', value: fmt(metrics.avgLoss, false), colr: 'text-red-400' },
    { label: 'Expectancy', value: fmt(metrics.expectancy), colr: color(metrics.expectancy) },
    { label: 'ROI', value: `${metrics.roi}%`, colr: color(metrics.roi) },
    { label: 'Sharpe', value: metrics.sharpeRatio.toFixed(2), colr: color(metrics.sharpeRatio) },
    { label: 'Sortino', value: metrics.sortinoRatio.toFixed(2), colr: color(metrics.sortinoRatio) },
    { label: 'Max Drawdown', value: `${metrics.maxDrawdownPct.toFixed(1)}%`, colr: color(metrics.maxDrawdownPct, true) },
    { label: 'Final Capital', value: fmt(metrics.finalCapital, false), colr: 'text-gray-300' },
  ];

  return (
    <div>
      {label && <h3 className="text-xs font-semibold text-gray-400 mb-3">{label}</h3>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {data.map(({ label: lbl, value, colr }) => (
          <div key={lbl} className="bg-gray-700/40 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{lbl}</p>
            <p className={`text-sm font-semibold ${colr}`}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
