# 04-learn-from-journal.md — Journal Attribution & Closed Learning Loop

This document specifies the **Attribution & Learning Job** (`scripts/learn_from_journal.py`), which reads execution logs (`data/paper/execution_logs.jsonl`) and updates the **Playbook Scorecard** (`data/memory/playbook_scorecard.json`).

---

## 1. Core Principles & Design Invariants

1. **Information Coefficient (IC) Driven:**
   - Strategy weights adapt strictly based on quantitative outcome feedback (EWMA Information Coefficient $\lambda = 0.90$).
   - Weights are clamped to $[0.35, 1.6]$.
   - No LLM prompt rewrites or black-box gradient updates.
2. **Symbol-Agnostic Keys:**
   - Scorecard rows are keyed strictly by `(moduleId, regime)`.
   - Symbol is an instance parameter. A second slice `(moduleId, regime, symbol)` may exist for telemetry, but never for hardcoded symbol weights.
3. **Idempotency:**
   - The learning job tracks processed event `id` values in an internal state ledger, guaranteeing identical scorecard output on repeated runs over the same log.
4. **Proxy Share Tracking:**
   - Historical logs lacking an explicit `module_id` field use `strategyId` as a fallback proxy. The scorecard tracks `proxyShare` ($\frac{\text{proxy trades}}{\text{total trades}}$), which declines automatically as new explicit `module_id` events are logged.
5. **Dry-Run by Default (`LEARN_APPLY`):**
   - Default execution is **Report Only** (`LEARN_APPLY=false` / `0`).
   - Atomic file writes to `data/memory/playbook_scorecard.json` occur **only** when `LEARN_APPLY=true` or `1`.
6. **No Secret Leaks:**
   - Reads strictly scrubbed `metadata` records via `eventLog.scrubMetadata`.

---

## 2. Mathematical Formulation

For each trade fill associated with module $m$ in regime $r$:

1. **Normalized Trade Return:**
   $$R_{\text{norm}} = \text{clamp}\left(\frac{\text{PnL}_{\text{trade}}}{\text{Notional}_{\text{entry}}} \times 40.0, -1.0, +1.0\right)$$
2. **EWMA IC Update ($\lambda = 0.90$):**
   $$\text{IC}_{\text{new}} = 0.90 \times \text{IC}_{\text{prev}} + 0.10 \times R_{\text{norm}}$$
3. **Weight Clamp:**
   $$W(m, r) = \text{clamp}(1.0 + \text{IC}_{\text{new}}, 0.35, 1.60)$$
4. **Veto Rate:**
   $$\text{VetoRate}(m, r) = \frac{N_{\text{vetoed}}}{N_{\text{proposed}} + N_{\text{vetoed}}}$$

---

## 3. Pseudocode Implementation (`learn_from_journal.py`)

```python
import json
import os
import sys
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

LOG_FILE = Path("data/paper/execution_logs.jsonl")
SCORECARD_FILE = Path("data/memory/playbook_scorecard.json")
STATE_LEDGER_FILE = Path("data/memory/.attribution_processed_ids.json")

LAMBDA_EWMA = 0.90
MIN_SAMPLES = 30
WEIGHT_MIN = 0.35
WEIGHT_MAX = 1.60


class JournalAttributionJob:
    """
    Parses execution_logs.jsonl, computes EWMA IC per (moduleId, regime),
    and atomically updates playbook_scorecard.json.
    """

    def __init__(self, apply_changes: bool = False):
        self.apply_changes = apply_changes
        self.processed_ids = self._load_processed_ids()
        self.scorecard_rows: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def _load_processed_ids(self) -> set:
        if STATE_LEDGER_FILE.exists():
            try:
                return set(json.loads(STATE_LEDGER_FILE.read_text(encoding="utf-8")))
            except Exception:
                return set()
        return set()

    def run() -> Dict[str, Any]:
        if not LOG_FILE.exists():
            print(f"[Learn] Log file {LOG_FILE} not found. Skipping.")
            return {"status": "no_logs", "processed": 0}

        events = []
        with LOG_FILE.open("r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

        trade_events = [e for e in events if e.get("kind") == "trade" or e.get("level") == "trade"]
        evaluate_events = [e for e in events if e.get("kind") == "evaluate"]

        new_trades_count = 0
        proxy_count = 0

        # Process each trade event
        for evt in trade_events:
            evt_id = evt.get("id")
            meta = evt.get("metadata", {}) or {}

            # Determine module_id (explicit or proxy)
            module_id = meta.get("module_id")
            is_proxy = False
            if not module_id:
                module_id = evt.get("strategyId") or "unknown_module"
                is_proxy = True

            regime = meta.get("regime_at_entry") or "range"
            pnl = float(meta.get("pnl") or 0.0)
            amount = float(meta.get("amount") or meta.get("qty") or 1.0)
            price = float(meta.get("price") or 1.0)
            notional = max(1.0, amount * price)

            key = (str(module_id).lower(), str(regime).lower())

            if key not in self.scorecard_rows:
                self.scorecard_rows[key] = {
                    "moduleId": key[0],
                    "regime": key[1],
                    "n": 0,
                    "icEwma": 0.0,
                    "weight": 1.0,
                    "vetoRate": 0.0,
                    "expectancyPaper": 0.0,
                    "proxyTrades": 0,
                    "totalPnl": 0.0,
                    "vetoedProposals": 0,
                    "totalProposals": 0,
                }

            row = self.scorecard_rows[key]
            row["n"] += 1
            if is_proxy:
                row["proxyTrades"] += 1
                proxy_count += 1

            # Compute Normalized Return and EWMA IC
            norm_return = max(-1.0, min(1.0, (pnl / notional) * 40.0))
            row["icEwma"] = LAMBDA_EWMA * row["icEwma"] + (1.0 - LAMBDA_EWMA) * norm_return
            row["weight"] = round(max(WEIGHT_MIN, min(WEIGHT_MAX, 1.0 + row["icEwma"])), 4)

            row["totalPnl"] += pnl
            row["expectancyPaper"] = round(row["totalPnl"] / row["n"], 2)

            if evt_id:
                self.processed_ids.add(evt_id)
            new_trades_count += 1

        # Process evaluate events for vetoRate computation
        for evt in evaluate_events:
            meta = evt.get("metadata", {}) or {}
            module_id = meta.get("module_id") or evt.get("strategyId") or "unknown_module"
            regime = meta.get("regime_at_entry") or "range"
            key = (str(module_id).lower(), str(regime).lower())

            if key in self.scorecard_rows:
                row = self.scorecard_rows[key]
                row["totalProposals"] += 1
                if meta.get("allowOpen") is False or meta.get("sizeOut") == 0:
                    row["vetoedProposals"] += 1

        # Finalize rows for output
        output_rows = []
        for row in self.scorecard_rows.values():
            n = row["n"]
            veto_rate = row["vetoedProposals"] / max(1, row["totalProposals"]) if row["totalProposals"] > 0 else 0.0
            proxy_share = row["proxyTrades"] / max(1, n)

            output_rows.append({
                "moduleId": row["moduleId"],
                "regime": row["regime"],
                "n": n,
                "icEwma": round(row["icEwma"], 4),
                "weight": row["weight"],
                "vetoRate": round(veto_rate, 4),
                "expectancyPaper": row["expectancyPaper"],
                "proxyShare": round(proxy_share, 4),
            })

        payload = {
            "asOf": "2026-09-12T00:00:00Z",
            "minSamples": MIN_SAMPLES,
            "rows": output_rows,
        }

        report = {
            "apply": self.apply_changes,
            "processedTrades": new_trades_count,
            "proxyShareOverall": round(proxy_count / max(1, new_trades_count), 4),
            "rowsCount": len(output_rows),
            "scorecard": payload,
        }

        if self.apply_changes:
            self._write_atomically(SCORECARD_FILE, payload)
            self._write_atomically(STATE_LEDGER_FILE, list(self.processed_ids))
            print(f"[Learn] Scorecard atomically updated at {SCORECARD_FILE}")
        else:
            print("[Learn] DRY-RUN MODE (LEARN_APPLY=0). Scorecard not written.")

        return report

    def _write_atomically(self, path: Path, data: Any):
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_file = path.with_suffix(".tmp")
        tmp_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp_file.replace(path)


if __name__ == "__main__":
    apply_flag = os.getenv("LEARN_APPLY", "0").lower() in ("1", "true", "yes")
    job = JournalAttributionJob(apply_changes=apply_flag)
    job.run()
```
