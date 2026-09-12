#!/usr/bin/env python3
"""
Journal Attribution & Scorecard Update Script (Modul 20: Risk-Overlay & Closed Learning Loop).
Reads data/paper/execution_logs.jsonl, computes EWMA Information Coefficient per (moduleId, regime),
and atomically updates data/memory/playbook_scorecard.json.

Default: DRY-RUN mode (LEARN_APPLY=0). Writes scorecard strictly when LEARN_APPLY=1 or true.
Windows compatible: Runs with standard python or python3.
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

LOG_FILE = Path("data/paper/execution_logs.jsonl")
SCORECARD_FILE = Path("data/memory/playbook_scorecard.json")
STATE_LEDGER_FILE = Path("data/memory/.attribution_processed_ids.json")

LAMBDA_EWMA = 0.90
MIN_SAMPLES = 30
WEIGHT_MIN = 0.35
WEIGHT_MAX = 1.60


class JournalAttributionJob:
    """
    Parses execution_logs.jsonl idempotently and computes EWMA IC weights.
    """

    def __init__(self, apply_changes: bool = False):
        self.apply_changes = apply_changes
        self.processed_ids: Set[str] = self._load_processed_ids()
        self.scorecard_rows: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def _load_processed_ids(self) -> Set[str]:
        if STATE_LEDGER_FILE.exists():
            try:
                return set(json.loads(STATE_LEDGER_FILE.read_text(encoding="utf-8")))
            except Exception:
                return set()
        return set()

    def run(self) -> Dict[str, Any]:
        if not LOG_FILE.exists():
            print(f"[Learn] Log file {LOG_FILE} not found. Skipping.")
            return {"status": "no_logs", "processed": 0}

        events: List[Dict[str, Any]] = []
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

        for evt in trade_events:
            evt_id = evt.get("id")
            meta = evt.get("metadata", {}) or {}

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

            norm_return = max(-1.0, min(1.0, (pnl / notional) * 40.0))
            row["icEwma"] = LAMBDA_EWMA * row["icEwma"] + (1.0 - LAMBDA_EWMA) * norm_return
            row["weight"] = round(max(WEIGHT_MIN, min(WEIGHT_MAX, 1.0 + row["icEwma"])), 4)

            row["totalPnl"] += pnl
            row["expectancyPaper"] = round(row["totalPnl"] / row["n"], 2)

            if evt_id:
                self.processed_ids.add(str(evt_id))
            new_trades_count += 1

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
            "proxyShareOverall": round(proxy_count / max(1, new_trades_count), 4) if new_trades_count > 0 else 0.0,
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

    def _write_atomically(self, path: Path, data: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_file = path.with_suffix(".tmp")
        tmp_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp_file.replace(path)


if __name__ == "__main__":
    apply_flag = os.getenv("LEARN_APPLY", "0").lower() in ("1", "true", "yes")
    job = JournalAttributionJob(apply_changes=apply_flag)
    res = job.run()
    print(json.dumps(res, indent=2))
