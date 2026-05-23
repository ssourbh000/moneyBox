'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  TrendingUp,
  FlaskConical,
  FileText,
  Briefcase,
  ListOrdered,
  ShieldAlert,
  BarChart2,
  Settings,
  Zap,
  LogOut,
  CandlestickChart,
  TrendingDown,
  Activity,
  GitCompare,
} from 'lucide-react';
import { authService } from '@/services/auth.service';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/strategies', label: 'Strategies', icon: TrendingUp },
  { href: '/backtests', label: 'Backtests', icon: FlaskConical },
  { href: '/strategy-compare', label: 'Strategy Compare', icon: GitCompare },
  { href: '/option-backtest', label: 'Original Strategy', icon: CandlestickChart },
  { href: '/orb15-backtest', label: 'B — 45-min ORB', icon: CandlestickChart },
  { href: '/expiry-spread-backtest', label: 'C — Expiry Spread', icon: TrendingDown },
  { href: '/event-alpha-backtest', label: 'D — Event Alpha', icon: Zap },
  { href: '/live-signals', label: 'Live Signals', icon: Activity },
  { href: '/paper-trading', label: 'Paper Trading', icon: FileText },
  { href: '/live-trading', label: 'Live Trading', icon: Zap },
  { href: '/positions', label: 'Positions', icon: Briefcase },
  { href: '/orders', label: 'Orders', icon: ListOrdered },
  { href: '/risk', label: 'Risk', icon: ShieldAlert },
  { href: '/reports', label: 'Reports', icon: BarChart2 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col w-60 min-h-screen bg-gray-950 border-r border-gray-800 px-3 py-6">
      <div className="mb-8 px-2">
        <span className="text-xl font-bold text-emerald-400 tracking-tight">MoneyBox</span>
        <span className="ml-2 text-xs text-gray-500 uppercase tracking-widest">Algo</span>
      </div>

      <nav className="flex-1 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={() => authService.logout()}
        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors mt-4"
      >
        <LogOut className="w-4 h-4" />
        Sign out
      </button>
    </aside>
  );
}
