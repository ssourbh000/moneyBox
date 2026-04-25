#!/bin/bash

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2OWU2NmMzMDYyYzU0OTRjNjgzMmZlNTkiLCJlbWFpbCI6Inh5ei5yb24wMDhAZ21haWwuY29tIiwiaWF0IjoxNzc2NzA5MDg4LCJleHAiOjE3NzczMTM4ODh9.k7KEDdn6rq-Ai5jsOVXceMPji5W_SpElLbIaWVbdKvE"

SYMBOLS=("RELIANCE" "TCS" "INFY" "HDFC" "ICICIBANK" "WIPRO" "TECHM" "LT" "MARUTI" "BAJAJFINSV" "SBIN" "AXIS" "KOTAKBANK" "TATASTEEL" "JSWSTEEL" "HEROMOTOCORP" "BPCL" "HINDPETRO" "AXISBANK" "BAJAJ-AUTO")

# Dates: 6 months back
FROM_DATE="2025-10-20"
TO_DATE="2026-04-20"

echo "📊 Fetching candles for 20 symbols (6 months)...\n"

for symbol in "${SYMBOLS[@]}"; do
  echo -n "Fetching $symbol... "
  
  # Fetch day candles
  RESULT=$(curl -s -X POST http://localhost:3001/api/market-data/candles/fetch \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"symbol\": \"$symbol\",
      \"exchange\": \"NSE\",
      \"interval\": \"day\",
      \"fromDate\": \"$FROM_DATE\",
      \"toDate\": \"$TO_DATE\"
    }")
  
  if echo "$RESULT" | grep -q "fetched"; then
    FETCHED=$(echo "$RESULT" | grep -o '"fetched":[0-9]*' | cut -d':' -f2)
    STORED=$(echo "$RESULT" | grep -o '"stored":[0-9]*' | cut -d':' -f2)
    echo "✅ $FETCHED fetched, $STORED stored"
  else
    echo "⚠️  $(echo "$RESULT" | grep -o '"message":"[^"]*' | cut -d'"' -f4 || echo 'unknown error')"
  fi
  
  sleep 0.5  # Rate limit
done

echo "\n✨ Candle fetch complete!"
echo "Now go to http://localhost:3000 → Backtests → Run Backtest"
