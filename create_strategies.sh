#!/bin/bash

# Login
echo "🔐 Logging in..."
LOGIN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "xyz.ron008@gmail.com",
    "password": "Indorecity@111"
  }')

TOKEN=$(echo $LOGIN | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo "Token: $TOKEN"

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed"
  echo "$LOGIN" | head -20
  exit 1
fi

echo "✅ Logged in\n"

# Helper function to create strategy
create_strategy() {
  local name="$1"
  local universe="$2"
  local params="$3"
  
  echo "Creating: $name"
  curl -s -X POST http://localhost:3001/api/strategies \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"$name\",
      \"description\": \"High-performance auto-created strategy\",
      \"universe\": [$universe],
      \"exchange\": \"NSE\",
      \"parameters\": $params,
      \"riskLimits\": {
        \"maxDailyLoss\": 60000,
        \"maxOpenPositions\": 3,
        \"maxPositionSize\": 120000
      }
    }"
  echo "\n"
}

# Strategy 1: Momentum Surge
create_strategy "⚡ Momentum Surge — High Volume" \
  '"RELIANCE","TCS","INFY","HDFC","ICICIBANK"' \
  '{
    "dailyEma1": 30, "dailyEma2": 90,
    "hourlyEmaPeriod": 10, "hourlyRsiPeriod": 7, "hourlyAdxPeriod": 10,
    "hourlyAdxMin": 25, "hourlyRsiMin": 55, "hourlyRsiMax": 85,
    "entryEmaPeriod": 8, "entryAtrPeriod": 8,
    "stopAtrMultiplier": 1.2, "targetRiskRatio": 3.0,
    "entryVolumeRatioMin": 2.0, "riskPercentPerTrade": 2.0,
    "paperCapital": 500000
  }'

# Strategy 2: Trend Pulse
create_strategy "📈 Trend Pulse — Strong ADX" \
  '"INFY","WIPRO","TECHM","LT","MARUTI"' \
  '{
    "dailyEma1": 50, "dailyEma2": 200,
    "hourlyEmaPeriod": 20, "hourlyRsiPeriod": 14, "hourlyAdxPeriod": 20,
    "hourlyAdxMin": 30, "hourlyRsiMin": 40, "hourlyRsiMax": 70,
    "entryEmaPeriod": 20, "entryAtrPeriod": 14,
    "stopAtrMultiplier": 1.5, "targetRiskRatio": 2.5,
    "entryVolumeRatioMin": 1.5, "riskPercentPerTrade": 1.5,
    "paperCapital": 1000000
  }'

# Strategy 3: Volatility Breakout
create_strategy "🎯 Volatility Breakout — ATR Expansion" \
  '"BAJAJFINSV","SBIN","AXIS","KOTAKBANK","ICICIBANK"' \
  '{
    "dailyEma1": 35, "dailyEma2": 120,
    "hourlyEmaPeriod": 15, "hourlyRsiPeriod": 12, "hourlyAdxPeriod": 12,
    "hourlyAdxMin": 20, "hourlyRsiMin": 45, "hourlyRsiMax": 75,
    "entryEmaPeriod": 15, "entryAtrPeriod": 10,
    "stopAtrMultiplier": 1.3, "targetRiskRatio": 2.8,
    "entryVolumeRatioMin": 1.8, "riskPercentPerTrade": 1.8,
    "paperCapital": 750000
  }'

# Strategy 4: Multi-Timeframe Confluence
create_strategy "🔄 Multi-Timeframe Confluence" \
  '"TATASTEEL","JSWSTEEL","HEROMOTOCORP","BPCL","HINDPETRO"' \
  '{
    "dailyEma1": 50, "dailyEma2": 200,
    "hourlyEmaPeriod": 25, "hourlyRsiPeriod": 14, "hourlyAdxPeriod": 14,
    "hourlyAdxMin": 28, "hourlyRsiMin": 42, "hourlyRsiMax": 68,
    "entryEmaPeriod": 20, "entryAtrPeriod": 14,
    "stopAtrMultiplier": 1.6, "targetRiskRatio": 2.2,
    "entryVolumeRatioMin": 1.6, "riskPercentPerTrade": 1.2,
    "paperCapital": 1200000
  }'

# Strategy 5: High-Win Scalper
create_strategy "💎 High-Win Scalper — Tight Stops" \
  '"RELIANCE","TCS","INFY","AXISBANK","BAJAJ-AUTO"' \
  '{
    "dailyEma1": 40, "dailyEma2": 150,
    "hourlyEmaPeriod": 12, "hourlyRsiPeriod": 10, "hourlyAdxPeriod": 10,
    "hourlyAdxMin": 22, "hourlyRsiMin": 50, "hourlyRsiMax": 80,
    "entryEmaPeriod": 12, "entryAtrPeriod": 10,
    "stopAtrMultiplier": 0.9, "targetRiskRatio": 3.5,
    "entryVolumeRatioMin": 2.2, "riskPercentPerTrade": 2.5,
    "paperCapital": 600000
  }'

echo "✨ All 5 strategies created!"
