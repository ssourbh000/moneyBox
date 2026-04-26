'use client';

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import type { EquityPoint } from '@/services/backtest.service';

interface Props {
  data: EquityPoint[];
  initialCapital: number;
}

function fmt(v: number) {
  return '₹' + Math.round(v).toLocaleString('en-IN');
}

export default function EquityChart({ data, initialCapital }: Props) {
  if (!data.length) return null;

  const deduped = data.reduce<EquityPoint[]>((acc, pt) => {
    if (acc.length && acc[acc.length - 1].t === pt.t) {
      acc[acc.length - 1] = pt;
    } else {
      acc.push(pt);
    }
    return acc;
  }, []);

  const min = Math.min(...deduped.map((p) => p.e));
  const max = Math.max(...deduped.map((p) => p.e));
  const padding = (max - min) * 0.05 || 1000;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={deduped} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="t"
          tick={{ fill: '#6b7280', fontSize: 11 }}
          tickLine={false}
          tickFormatter={(v: string) => v.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[min - padding, max + padding]}
          tick={{ fill: '#6b7280', fontSize: 11 }}
          tickLine={false}
          tickFormatter={fmt}
          width={88}
        />
        <Tooltip
          contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
          labelStyle={{ color: '#9ca3af', fontSize: 12 }}
          formatter={(v: any) => [fmt(v as number), 'Equity']}
        />
        <ReferenceLine y={initialCapital} stroke="#6b7280" strokeDasharray="4 4" />
        <Area
          type="monotone"
          dataKey="e"
          stroke="#10b981"
          strokeWidth={2}
          fill="url(#eq)"
          dot={false}
          activeDot={{ r: 4, fill: '#10b981' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
