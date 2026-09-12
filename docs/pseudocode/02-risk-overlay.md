# 02-risk-overlay.md — Risk Overlay Architecture (Gates R0–R8)

This document specifies the **Risk Overlay** (`applyOverlay`), which evaluates strategy proposals against 9 hard risk gates in order.

---

## 1. Core Invariants & Rules

1. **Only Narrow (Einzige Richtung: Verengen):**
   - The Risk Overlay can **only reduce quantity** (`sizeOut <= sizeIn`) or **block entry** (`allowOpen = false`).
   - It can **never** increase order size or relax lower-layer gates.
   - High AI confidence (e.g. `1.0`) **cannot bypass or relax any risk gate**.
2. **Sigma Disposes (Sigma-Kammer verfügt):**
   - In any conflict between Alpha proposal / Screener and Sigma risk rules, **Sigma wins unconditionally**.
3. **AI Never Live Order:**
   - LLMs and AI Swarms produce thesis comments and proposals only.
   - Live order dispatch requires explicit environment flag `AI_LIVE_ORDERS=true` plus human promote check.
4. **Fail-Closed:**
   - Unapproved data (`data_approved = false`), missing order book, or active daily loss breaker sets `sizeOut = 0` and `allowOpen = false`.
   - Paper positions are allowed to reduce or close, but never open or increase.
5. **Symbol Agnostic:**
   - Risk rules apply uniformly to symbol instances passed in context. Symbol names are never hardcoded in gate logic.

---

## 2. Gate Definitions (R0–R8)

| ID | Gate Name | Evaluation Condition | Fail Code | Action on Fail |
|---|---|---|---|---|
| **R0** | Data Approval Gate | `ctx.dataApproval.approved === true` | `RISK_DATA` | `allowOpen = false`, `sizeOut = 0` |
| **R1** | Regime Matrix Gate | Module allowed in `ctx.regime` per `REGIME_SOURCE_MATRIX` | `RISK_REGIME` | `allowOpen = false`, `sizeOut = 0` |
| **R2** | Regime Flip Gate | Active regime flipped counter to open position side | `RISK_REGIME_FLIP` | `allowOpen = false`, `allowReduce = true` |
| **R3** | Cooldown Gate | `currentBarIndex - lastExecutionBar >= cooldownBars` | `RISK_COOLDOWN` | `allowOpen = false`, `sizeOut = 0` |
| **R4** | Notional / Cap Gate | Order size adjusted for cash, single-trade alloc (25%), & min ticket ($25) | `RISK_CAP` | Downscale `sizeOut` or set `0` |
| **R5** | Daily Loss Breaker | `(realizedDailyPnl + unrealizedDailyPnl) / initialPaperBalance <= -3.0%` | `RISK_DAILY_LOSS` | Circuit breaker: `allowOpen = false` |
| **R6** | Exposure Cap Gate | Per-symbol exposure <= 35%, gross exposure <= 60% | `RISK_EXPOSURE` | Downscale `sizeOut` or set `0` |
| **R7** | Microstructure Gate | Bid-Ask Spread <= 18 bps | `RISK_SPREAD` | `allowOpen = false`, `sizeOut = 0` |
| **R8** | Live Order Gate | `executionMode === "live"` && `!isAiLiveOrdersAllowed` | `RISK_LIVE_GATE` | Dispatch blocked |

---

## 3. Pseudocode Implementation (`applyOverlay`)

```typescript
import { OverlayContext, OverlayVerdict, GateResult } from "./00-types";

const CONFIG = {
  DAILY_LOSS_LIMIT_PCT: -0.03,    // R5: -3% daily PnL drawdown circuit breaker
  MAX_SINGLE_TRADE_ALLOC: 0.25,  // R4: Max 25% equity per single trade
  MIN_TICKET_USD: 25.0,          // R4: Minimum ticket size
  MAX_SYMBOL_EXPOSURE_PCT: 0.35, // R6: Max 35% equity exposure per symbol
  MAX_GROSS_EXPOSURE_PCT: 0.60,  // R6: Max 60% total gross portfolio exposure
  MAX_SPREAD_BPS: 18.0,          // R7: Max bid-ask spread 18 bps
};

/**
 * Applies R0-R8 Risk Overlay gates to a strategy proposal.
 * Strictly narrowing, fail-closed, symbol-agnostic.
 */
export function applyOverlay(ctx: OverlayContext): OverlayVerdict {
  const gates: GateResult[] = [];
  let allowOpen = true;
  let allowReduce = true;
  let sizeOut = Math.max(0, ctx.proposedSize);

  const isEntry = ctx.proposedSide === "buy" || ctx.proposedSide === "sell";

  // --- R0: Data Approval Gate ---
  const passR0 = ctx.dataApproval.approved;
  gates.push({
    id: "R0_DATA_APPROVAL",
    pass: passR0,
    note: passR0 ? "Data approved" : `Failed codes: ${ctx.dataApproval.codes.join(", ")}`,
  });
  if (!passR0 && isEntry) {
    allowOpen = false;
    sizeOut = 0;
  }

  // --- R1: Regime Compatibility Gate ---
  let passR1 = true;
  if (isEntry && ctx.moduleId) {
    const isMeanRevModule = ctx.moduleId.includes("mean_reversion") || ctx.moduleId.includes("rsi");
    const isTrendModule = ctx.moduleId.includes("momentum") || ctx.moduleId.includes("breakout");

    if (ctx.regime === "BROWNIAN_CHOP") {
      passR1 = false; // Chop blocks new direction entries
    } else if (ctx.regime === "MEAN_REVERTING" && isTrendModule) {
      passR1 = false; // Trend module blocked in mean-reverting regime
    } else if (ctx.regime === "MOMENTUM_TREND" && isMeanRevModule) {
      passR1 = false; // Mean-rev module blocked in strong trend regime
    }
  }
  gates.push({ id: "R1_REGIME", pass: passR1, note: `Regime: ${ctx.regime}, Module: ${ctx.moduleId}` });
  if (!passR1 && isEntry) {
    allowOpen = false;
    sizeOut = 0;
  }

  // --- R2: Regime Flip Gate (Position Management) ---
  let passR2 = true;
  if (ctx.portfolio.openPosition) {
    const posSide = ctx.portfolio.openPosition.side;
    if (posSide === "buy" && ctx.regime === "MOMENTUM_TREND" && ctx.proposedSide === "sell") {
      passR2 = true; // Regime flip confirms closing long
    } else if (ctx.regime === "BROWNIAN_CHOP") {
      // Regime flipped to chop -> disallow increasing position, allow reduce
      if (isEntry) passR2 = false;
    }
  }
  gates.push({ id: "R2_REGIME_FLIP", pass: passR2, note: "Regime-flip check" });
  if (!passR2 && isEntry) {
    allowOpen = false;
    sizeOut = 0;
  }

  // --- R3: Cooldown Gate ---
  const barsSinceLast = ctx.currentBarIndex - ctx.lastModuleExecutionBar;
  const passR3 = barsSinceLast >= ctx.cooldownBarsRequired;
  gates.push({
    id: "R3_COOLDOWN",
    pass: passR3,
    note: `Bars since last: ${barsSinceLast}, required: ${ctx.cooldownBarsRequired}`,
  });
  if (!passR3 && isEntry) {
    allowOpen = false;
    sizeOut = 0;
  }

  // --- R5: Daily Loss Breaker (Checked before sizing) ---
  const totalDailyPnl = ctx.portfolio.realizedDailyPnlUsd + ctx.portfolio.unrealizedDailyPnlUsd;
  const dailyPnlRatio = ctx.portfolio.initialPaperBalanceUsd > 0
    ? totalDailyPnl / ctx.portfolio.initialPaperBalanceUsd
    : 0;
  const passR5 = dailyPnlRatio > CONFIG.DAILY_LOSS_LIMIT_PCT;
  gates.push({
    id: "R5_DAILY_LOSS",
    pass: passR5,
    note: `Daily PnL: ${(dailyPnlRatio * 100).toFixed(2)}% (limit: ${(CONFIG.DAILY_LOSS_LIMIT_PCT * 100).toFixed(2)}%)`,
  });
  if (!passR5) {
    // Daily loss circuit breaker tripped: Block all entries, allow reductions
    allowOpen = false;
    if (isEntry) sizeOut = 0;
  }

  // --- R4 & R6: Caps & Sizing Constraints ---
  let passR4 = true;
  let passR6 = true;
  if (isEntry && allowOpen && sizeOut > 0) {
    const equity = ctx.portfolio.equityUsd;
    const currentPrice = ctx.orderBook ? (ctx.orderBook.bestBid + ctx.orderBook.bestAsk) / 2 : 0;
    
    if (currentPrice > 0 && equity > 0) {
      // Single trade alloc cap (25%)
      const maxAllocUsd = equity * CONFIG.MAX_SINGLE_TRADE_ALLOC;
      const maxCashUsd = Math.min(maxAllocUsd, ctx.portfolio.availableCashUsd * 0.98);
      let allowedQty = maxCashUsd / currentPrice;

      // Symbol Exposure Cap (35%)
      const remainingSymbolHeadroomUsd = Math.max(0, (equity * CONFIG.MAX_SYMBOL_EXPOSURE_PCT) - ctx.portfolio.symbolGrossExposureUsd);
      const allowedSymbolQty = remainingSymbolHeadroomUsd / currentPrice;
      if (allowedSymbolQty < allowedQty) {
        allowedQty = allowedSymbolQty;
        passR6 = false;
      }

      // Downscale sizeOut to strictest cap
      if (allowedQty < sizeOut) {
        sizeOut = Math.max(0, allowedQty);
        passR4 = false;
      }

      // Minimum Ticket Size Check
      if (sizeOut * currentPrice < CONFIG.MIN_TICKET_USD) {
        sizeOut = 0;
        allowOpen = false;
        passR4 = false;
      }
    }
  }
  gates.push({ id: "R4_NOTIONAL_CAPS", pass: passR4, note: `Final sizeOut: ${sizeOut}` });
  gates.push({ id: "R6_EXPOSURE_CAPS", pass: passR6, note: `Symbol Exposure: $${ctx.portfolio.symbolGrossExposureUsd}` });

  // --- R7: Spread Gate ---
  let passR7 = true;
  if (ctx.orderBook) {
    passR7 = ctx.orderBook.spreadBps <= CONFIG.MAX_SPREAD_BPS;
  } else {
    passR7 = false; // No book = fail closed
  }
  gates.push({
    id: "R7_SPREAD",
    pass: passR7,
    note: ctx.orderBook ? `Spread: ${ctx.orderBook.spreadBps.toFixed(1)} bps` : "No order book available",
  });
  if (!passR7 && isEntry) {
    allowOpen = false;
    sizeOut = 0;
  }

  // --- R8: Live Execution Gate ---
  let passR8 = true;
  if (ctx.executionMode === "live") {
    passR8 = ctx.isAiLiveOrdersAllowed === true;
  }
  gates.push({
    id: "R8_LIVE_GATE",
    pass: passR8,
    note: `Mode: ${ctx.executionMode}, AI_LIVE_ORDERS: ${ctx.isAiLiveOrdersAllowed}`,
  });
  if (!passR8) {
    allowOpen = false;
    sizeOut = 0;
  }

  // Invariant Assertion: sizeOut must never exceed proposedSize
  sizeOut = Math.min(ctx.proposedSize, sizeOut);

  return {
    symbol: ctx.symbol.toUpperCase(),
    moduleId: ctx.moduleId,
    side: ctx.proposedSide,
    sizeIn: ctx.proposedSize,
    sizeOut: allowOpen ? sizeOut : 0,
    allowOpen,
    allowReduce,
    gates,
    dataApproval: ctx.dataApproval,
  };
}
```

---

## 4. Single-Line Justifications for Gate Thresholds

- **R5 (-3.0%):** Aligned with standard M8 / Sigma daily paper balance loss breaker in `app/orchestrator/alpha_sigma_engine.py`.
- **R7 (18 bps):** Directly reuses `max_allowed_spread_bps` from `app/execution/m8_judge.py`.
- **R4 (25% / $25):** Reuses `max_single_trade_pct` and min ticket size from `app/execution/kelly_sizing.py`.
