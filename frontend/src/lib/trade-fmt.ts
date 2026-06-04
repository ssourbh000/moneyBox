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

// Convert HHMM integer to total minutes (e.g. 920 → 560)
function toMins(hhmm: number): number {
  return Math.floor(hhmm / 100) * 60 + (hhmm % 100);
}

// Current IST time as HHMM integer
function istNowHHMM(): number {
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.getUTCHours() * 100 + ist.getUTCMinutes();
}

// Is today a weekday (Mon–Fri) in IST?
function isISTWeekday(): boolean {
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  const day = ist.getUTCDay(); // 0=Sun, 6=Sat
  return day >= 1 && day <= 5;
}

/**
 * Returns true if the paper trading engine should be considered "active":
 *   1. Time-based: weekday AND current IST time is within 30 min before windowStart
 *      OR between windowStart and windowEnd (shows active even before first tick fires)
 *   2. Tick-based: a recent tick (<10 min old) that isn't OUTSIDE_WINDOW
 *
 * @param windowStart  HHMM when the strategy's entry window opens (e.g. 920)
 * @param windowEnd    HHMM when the strategy's window closes   (e.g. 1000)
 */
export function isEngineActive(
  tick: { time: string; status?: string; results?: string[] } | null,
  mode: 'status' | 'results',
  windowStart?: number,
  windowEnd?: number,
): boolean {
  // Time-based check — show active 30 min before window opens
  if (windowStart !== undefined && windowEnd !== undefined && isISTWeekday()) {
    const hhmm    = istNowHHMM();
    const preFrom = toMins(windowStart) - 30; // 30 min before window
    const current = toMins(hhmm);
    const end     = toMins(windowEnd);
    if (current >= preFrom && current <= end) return true;
  }

  // Tick-based check — fallback for when cron has fired
  if (!tick) return false;
  const ageMs  = Date.now() - new Date(tick.time).getTime();
  const recent = ageMs < 10 * 60_000;
  if (mode === 'status') return recent && tick.status !== 'OUTSIDE_WINDOW';
  return recent && !tick.results!.some(r => r.toLowerCase().includes('outside'));
}

export const TICK_STATUS_CLS: Record<string, string> = {
  OPEN:           'text-yellow-300',
  CLOSED:         'text-emerald-400',
  SKIPPED:        'text-gray-500',
  WAITING:        'text-blue-400',
  ERROR:          'text-red-400',
  OUTSIDE_WINDOW: 'text-gray-600',
};
