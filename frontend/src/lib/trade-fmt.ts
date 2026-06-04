export function fmt(v: number, showSign = true): string {
  const sign = showSign ? (v >= 0 ? '+' : '') : '';
  return sign + '₹' + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function pnlCls(v: number): string {
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400';
}

export function exitReasonCls(r?: string): string {
  if (r === 'TP')       return 'text-emerald-400';
  if (r === 'TRAIL_SL') return 'text-yellow-400';
  if (r === 'SL')       return 'text-red-400';
  if (r === 'TIME')     return 'text-gray-400';
  if (r === 'EOD')      return 'text-gray-400';
  return 'text-gray-500';
}

export function statusBadge(status: string): string {
  const map: Record<string, string> = {
    OPEN:    'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30',
    CLOSED:  'bg-gray-700 text-gray-300',
    SKIPPED: 'bg-gray-800 text-gray-500',
    WAITING: 'bg-blue-500/10 text-blue-400',
  };
  return `px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? 'bg-gray-700 text-gray-400'}`;
}

export function isEngineActive(tick: { time: string; status?: string; results?: string[] } | null, mode: 'status' | 'results'): boolean {
  if (!tick) return false;
  const ageMs = Date.now() - new Date(tick.time).getTime();
  const recent = ageMs < 10 * 60 * 1000;
  if (mode === 'status') {
    return recent && tick.status !== 'OUTSIDE_WINDOW';
  }
  // mode === 'results'
  const notOutside = !tick.results!.some(r => r.toLowerCase().includes('outside'));
  return recent && notOutside;
}

export const TICK_STATUS_CLS: Record<string, string> = {
  OPEN:           'text-yellow-300',
  CLOSED:         'text-emerald-400',
  SKIPPED:        'text-gray-500',
  WAITING:        'text-blue-400',
  ERROR:          'text-red-400',
  OUTSIDE_WINDOW: 'text-gray-600',
};
