import axios from 'axios';

const API = axios.create({ baseURL: 'http://localhost:3001/api' });

interface Strategy {
  name: string;
  universe: string[];
  parameters: Record<string, number>;
  riskLimits: Record<string, number>;
}

const STRATEGIES: Strategy[] = [
  {
    name: '⚡ Momentum Surge — High Volume Acceleration',
    universe: ['RELIANCE', 'TCS', 'INFY', 'HDFC', 'ICICIBANK'],
    parameters: {
      dailyEma1: 30,
      dailyEma2: 90,
      hourlyEmaPeriod: 10,
      hourlyRsiPeriod: 7,
      hourlyAdxPeriod: 10,
      hourlyAdxMin: 25,
      hourlyRsiMin: 55,
      hourlyRsiMax: 85,
      entryEmaPeriod: 8,
      entryAtrPeriod: 8,
      stopAtrMultiplier: 1.2,
      targetRiskRatio: 3.0,
      entryVolumeRatioMin: 2.0,
      riskPercentPerTrade: 2.0,
      paperCapital: 500000,
    },
    riskLimits: {
      maxDailyLoss: 50000,
      maxOpenPositions: 3,
      maxPositionSize: 100000,
    },
  },
  {
    name: '📈 Trend Pulse — Strong ADX + EMA Alignment',
    universe: ['INFY', 'WIPRO', 'TECHM', 'LT', 'MARUTI'],
    parameters: {
      dailyEma1: 50,
      dailyEma2: 200,
      hourlyEmaPeriod: 20,
      hourlyRsiPeriod: 14,
      hourlyAdxPeriod: 20,
      hourlyAdxMin: 30,
      hourlyRsiMin: 40,
      hourlyRsiMax: 70,
      entryEmaPeriod: 20,
      entryAtrPeriod: 14,
      stopAtrMultiplier: 1.5,
      targetRiskRatio: 2.5,
      entryVolumeRatioMin: 1.5,
      riskPercentPerTrade: 1.5,
      paperCapital: 1000000,
    },
    riskLimits: {
      maxDailyLoss: 75000,
      maxOpenPositions: 2,
      maxPositionSize: 150000,
    },
  },
  {
    name: '🎯 Volatility Breakout — ATR Expansion Trades',
    universe: ['BAJAJFINSV', 'SBIN', 'AXIS', 'KOTAKBANK', 'ICICIBANK'],
    parameters: {
      dailyEma1: 35,
      dailyEma2: 120,
      hourlyEmaPeriod: 15,
      hourlyRsiPeriod: 12,
      hourlyAdxPeriod: 12,
      hourlyAdxMin: 20,
      hourlyRsiMin: 45,
      hourlyRsiMax: 75,
      entryEmaPeriod: 15,
      entryAtrPeriod: 10,
      stopAtrMultiplier: 1.3,
      targetRiskRatio: 2.8,
      entryVolumeRatioMin: 1.8,
      riskPercentPerTrade: 1.8,
      paperCapital: 750000,
    },
    riskLimits: {
      maxDailyLoss: 60000,
      maxOpenPositions: 3,
      maxPositionSize: 125000,
    },
  },
  {
    name: '🔄 Multi-Timeframe Confluence — Perfect Alignment',
    universe: ['TATASTEEL', 'JSWSTEEL', 'HEROMOTOCORP', 'BPCL', 'HINDPETRO'],
    parameters: {
      dailyEma1: 50,
      dailyEma2: 200,
      hourlyEmaPeriod: 25,
      hourlyRsiPeriod: 14,
      hourlyAdxPeriod: 14,
      hourlyAdxMin: 28,
      hourlyRsiMin: 42,
      hourlyRsiMax: 68,
      entryEmaPeriod: 20,
      entryAtrPeriod: 14,
      stopAtrMultiplier: 1.6,
      targetRiskRatio: 2.2,
      entryVolumeRatioMin: 1.6,
      riskPercentPerTrade: 1.2,
      paperCapital: 1200000,
    },
    riskLimits: {
      maxDailyLoss: 80000,
      maxOpenPositions: 2,
      maxPositionSize: 180000,
    },
  },
  {
    name: '💎 High-Win Scalper — Tight Stops, Big Targets',
    universe: ['RELIANCE', 'TCS', 'INFY', 'AXISBANK', 'BAJAJ-AUTO'],
    parameters: {
      dailyEma1: 40,
      dailyEma2: 150,
      hourlyEmaPeriod: 12,
      hourlyRsiPeriod: 10,
      hourlyAdxPeriod: 10,
      hourlyAdxMin: 22,
      hourlyRsiMin: 50,
      hourlyRsiMax: 80,
      entryEmaPeriod: 12,
      entryAtrPeriod: 10,
      stopAtrMultiplier: 0.9,
      targetRiskRatio: 3.5,
      entryVolumeRatioMin: 2.2,
      riskPercentPerTrade: 2.5,
      paperCapital: 600000,
    },
    riskLimits: {
      maxDailyLoss: 55000,
      maxOpenPositions: 4,
      maxPositionSize: 80000,
    },
  },
];

async function run() {
  try {
    console.log('🔐 Logging in...');
    const login = await API.post('/auth/login', {
      email: 'xyz.ron008@gmail.com',
      password: 'Indorecity@111',
    });
    const token = login.data.token;
    API.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    console.log('✅ Logged in\n');

    console.log('📊 Creating 5 strategies...\n');
    const strategies = [];
    for (const strat of STRATEGIES) {
      const res = await API.post('/strategies', {
        name: strat.name,
        description: `Auto-created strategy with focus on ${strat.universe.join(', ')}`,
        universe: strat.universe,
        exchange: 'NSE',
        parameters: strat.parameters,
        riskLimits: strat.riskLimits,
      });
      strategies.push(res.data);
      console.log(`✅ ${strat.name}`);
      console.log(`   ID: ${res.data._id}\n`);
    }

    console.log('🔄 Fetching historical candles (6 months)...');
    const symbols = new Set<string>();
    STRATEGIES.forEach((s) => s.universe.forEach((sym) => symbols.add(sym)));
    
    for (const symbol of Array.from(symbols)) {
      try {
        const fromDate = new Date();
        fromDate.setMonth(fromDate.getMonth() - 6);
        const toDate = new Date();
        
        await API.post('/market-data/candles/fetch', {
          symbol,
          exchange: 'NSE',
          interval: 'day',
          fromDate: fromDate.toISOString().split('T')[0],
          toDate: toDate.toISOString().split('T')[0],
        });
        console.log(`✅ ${symbol}`);
      } catch (e: any) {
        console.log(`⚠️  ${symbol}: ${e.response?.data?.message || 'fetch failed'}`);
      }
    }

    console.log('\n✨ Strategy setup complete!');
    console.log('📋 Created strategies:');
    strategies.forEach((s) => console.log(`   • ${s.name}`));
    console.log('\n🎯 Next: Go to http://localhost:3000 → Backtests → Run Backtest');
  } catch (err: any) {
    console.error('❌ Error:', err.response?.data || err.message);
  }
}

run();
