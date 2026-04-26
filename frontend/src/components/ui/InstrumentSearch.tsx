'use client';

import { useState, useCallback } from 'react';
import { marketDataService } from '@/services/market-data.service';
import { Search } from 'lucide-react';

interface Instrument {
  symbol: string;
  exchange: string;
  name: string;
  instrumentType: string;
}

interface Props {
  onSelect: (instrument: Instrument) => void;
  placeholder?: string;
}

export default function InstrumentSearch({ onSelect, placeholder = 'Search instrument…' }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Instrument[]>([]);
  const [open, setOpen] = useState(false);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    try {
      const data = await marketDataService.searchInstruments(q, undefined, 10);
      setResults(data);
      setOpen(true);
    } catch {
      setResults([]);
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    search(v);
  }

  function handleSelect(inst: Instrument) {
    setQuery(`${inst.symbol} (${inst.exchange})`);
    setOpen(false);
    onSelect(inst);
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
        />
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
          {results.map((inst) => (
            <li
              key={`${inst.symbol}:${inst.exchange}`}
              onMouseDown={() => handleSelect(inst)}
              className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-700 cursor-pointer"
            >
              <div>
                <span className="text-sm font-medium text-white">{inst.symbol}</span>
                <span className="ml-2 text-xs text-gray-500">{inst.name}</span>
              </div>
              <span className="text-xs text-gray-500 font-mono">{inst.exchange} · {inst.instrumentType}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
