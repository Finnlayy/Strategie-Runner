# Fable / Neo Blind Perception

`app/perception/blind_patterns.py` is the pre-Propose perception adapter.
`blind_geometry_from_candles()` consumes a closed OHLC boundary and immediately
reduces it to ratios: body/range, wick balance, body position and direction.
`detect_blind_patterns()` / `rna_smart()` accept geometry only.

The output `BlindPatternPacket` contains:

```json
{
  "pattern_id": "BLIND_TREND_UP",
  "confidence": 0.7,
  "geometry_features": {"body_mean": 0.5, "wick_balance": 0.1},
  "closed_bar_only": true,
  "symbol_agnostic": true
}
```

Leakage guards reject symbol/ticker, timeframe, timestamps, raw OHLC,
absolute-price, future/next-bar and look-ahead fields.  An open candle is
rejected rather than guessed closed.  No perception function can submit a vote
to a broker or execute an order.
