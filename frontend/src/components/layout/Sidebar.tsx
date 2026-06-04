'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  FlaskConical,
  FileText,
  Briefcase,
  ListOrdered,
  ShieldAlert,
  BarChart2,
  Settings,
  Zap,
  LogOut,
  GitCompare,
  ChevronDown,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { authService } from '@/services/auth.service';

// ── Strategy sub-groups ──────────────────────────────────────────────────────

const STRATEGIES = [
  {
    key: 'b',
    label: 'B — 45-min ORB',
    color: 'text-purple-400',
    dot: 'bg-purple-500',
    links: [
      { href: '/orb15-backtest',  label: 'Backtest',    icon: FlaskConical },
      { href: '/paper-trading',   label: 'Paper Trade', icon: FileText },
    ],
  },
  {
    key: 'c1',
    label: 'C1 — IV Crush',
    color: 'text-blue-400',
    dot: 'bg-blue-500',
    links: [
      { href: '/iv-crush-backtest', label: 'Backtest',    icon: FlaskConical },
      { href: '/iv-crush',          label: 'Paper Trade', icon: FileText },
    ],
  },
  {
    key: 'd',
    label: 'D — Event Alpha',
    color: 'text-yellow-400',
    dot: 'bg-yellow-500',
    links: [
      { href: '/event-alpha-backtest', label: 'Backtest',    icon: FlaskConical },
      { href: '/event-alpha-paper',    label: 'Paper Trade', icon: FileText },
    ],
  },
];

// ── Top-level nav items ───────────────────────────────────────────────────────

const TOP_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
];

const TOOLS_NAV = [
  { href: '/portfolio-backtest', label: 'Portfolio Sim',     icon: BarChart2 },
  { href: '/strategy-compare',   label: 'Strategy Compare', icon: GitCompare },
];

const TRADING_NAV = [
  { href: '/live-trading', label: 'Live Trading', icon: Zap },
  { href: '/positions',    label: 'Positions',    icon: Briefcase },
  { href: '/orders',       label: 'Orders',       icon: ListOrdered },
  { href: '/risk',         label: 'Risk',         icon: ShieldAlert },
  { href: '/reports',      label: 'Reports',      icon: BarChart2 },
  { href: '/settings',     label: 'Settings',     icon: Settings },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function NavLink({ href, label, icon: Icon, indent = false }: { href: string; label: string; icon: any; indent?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + '/');
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-lg text-sm font-medium transition-colors
        ${indent ? 'pl-8 pr-3 py-1.5' : 'px-3 py-2'}
        ${active
          ? 'bg-emerald-500/10 text-emerald-400'
          : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
        }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-600 select-none">
      {children}
    </p>
  );
}

function StrategyGroup({ strategy, defaultOpen }: { strategy: typeof STRATEGIES[number]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const pathname = usePathname();
  const anyActive = strategy.links.some(l => pathname === l.href || pathname.startsWith(l.href + '/'));

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
          ${anyActive ? 'text-emerald-400' : 'text-gray-300 hover:text-gray-100 hover:bg-gray-800'}`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${strategy.dot}`} />
        <span className="flex-1 text-left">{strategy.label}</span>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
          : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
        }
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {strategy.links.map(link => (
            <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} indent />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

export default function Sidebar() {
  const pathname = usePathname();
  const [strategiesOpen, setStrategiesOpen] = useState(true);

  const anyStrategyActive = STRATEGIES.some(s => s.links.some(l => pathname === l.href || pathname.startsWith(l.href + '/')));

  return (
    <aside className="flex flex-col w-60 min-h-screen bg-gray-950 border-r border-gray-800 px-3 py-6">
      <div className="mb-8 px-2">
        <span className="text-xl font-bold text-emerald-400 tracking-tight">MoneyBox</span>
        <span className="ml-2 text-xs text-gray-500 uppercase tracking-widest">Algo</span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto">
        {/* Top */}
        {TOP_NAV.map(({ href, label, icon }) => (
          <NavLink key={href} href={href} label={label} icon={icon} />
        ))}

        {/* Strategies section */}
        <SectionLabel>Strategies</SectionLabel>
        <button
          onClick={() => setStrategiesOpen(o => !o)}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors
            ${anyStrategyActive ? 'text-emerald-400' : 'text-gray-300 hover:text-gray-100 hover:bg-gray-800'}`}
        >
          <TrendingUp className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left">Strategies</span>
          {strategiesOpen
            ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
            : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
          }
        </button>
        {strategiesOpen && (
          <div className="pl-3 space-y-0.5 border-l border-gray-800 ml-3 mt-1">
            {STRATEGIES.map(s => (
              <StrategyGroup
                key={s.key}
                strategy={s}
                defaultOpen={s.links.some(l => pathname.startsWith(l.href))}
              />
            ))}
          </div>
        )}

        {/* Tools */}
        <SectionLabel>Tools</SectionLabel>
        {TOOLS_NAV.map(({ href, label, icon }) => (
          <NavLink key={href} href={href} label={label} icon={icon} />
        ))}

        {/* Trading */}
        <SectionLabel>Trading</SectionLabel>
        {TRADING_NAV.map(({ href, label, icon }) => (
          <NavLink key={href} href={href} label={label} icon={icon} />
        ))}
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
