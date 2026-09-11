"""P3: prove GBH-06 with independent runner-side values (not a mirror check)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

env_path = ROOT / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from app.contracts import canonical_hash
from app.orchestrator.alpha_sigma_engine import AlphaSigmaOrchestrator, OrchestratorConfig
from app.quant.runner_strategy_indicators import compute as runner_compute


def trend_series(n: int = 140, start: float = 64_000.0) -> list:
    import random
    random.seed(11)
    out, x = [], start
    for i in range(n):
        x *= 1 + (0.0022 if 40 < i < 110 else -0.001) + random.uniform(-0.004, 0.004)
        out.append(round(x, 2))
    return out


def main() -> int:
    prices = trend_series()
    runner = runner_compute(prices)
    assert runner.get("ok"), runner

    tmp = tempfile.mkdtemp(prefix="gbh06_")
    cfg = OrchestratorConfig(
        state_file=f"{tmp}/ors_state.json",
        journal_file=f"{tmp}/decisions.jsonl",
        hook_state_file=f"{tmp}/hook_state.json",
    )
    orch = AlphaSigmaOrchestrator(cfg)
    orch.state.portfolio.equity_usd = 10_000.0
    orch.state.portfolio.available_cash_usd = 10_000.0
    orch.state.portfolio.best_equity_usd = 10_000.0
    orch.ingest("BTC/USD", prices=prices)

    # Mirror must NOT book the hook
    mirror = orch.check_parity("BTC/USD", runner, mark_hook=False)
    if mirror.get("evidence") is not False:
        print(json.dumps({"ok": False, "step": "mirror", "rep": mirror}, indent=2))
        return 1
    if "GBH-06" in orch.state.hook_state:
        print(json.dumps({"ok": False, "step": "mirror_booked", "hooks": orch.state.hook_state}, indent=2))
        return 1

    # Real evidence path
    evidence = orch.check_parity("BTC/USD", runner, mark_hook=True)
    hook = orch.state.hook_state.get("GBH-06") or {}
    ok = bool(evidence.get("parity_ok")) and hook.get("status") == "IMPLEMENTED" and hook.get("owner") == "parity-check"

    out_dir = ROOT / "data" / "orchestrator"
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    artifact = {
        "schema": "gbh06-parity-evidence/1",
        "symbol": "BTC/USD",
        "ts": datetime.now(timezone.utc).isoformat(),
        "parity_ok": evidence.get("parity_ok"),
        "worst_delta": evidence.get("worst_delta"),
        "tolerance_pct": evidence.get("tolerance_pct"),
        "runner_source": runner.get("source"),
        "runner": {k: runner.get(k) for k in (
            "price", "basis", "sigma", "z_score", "atr", "hurst",
            "ema_fast", "ema_slow", "breakout_upper", "breakout_lower",
            "support_score", "resistance_score",
        )},
        "engine_raw": (evidence.get("engine") or {}).get("raw") or {},
        "delta": evidence.get("delta"),
        "hook": hook,
        "prices_hash": canonical_hash({"n": len(prices), "head": prices[:3], "tail": prices[-3:], "seed": 11}),
        "evidence_hash": None,
        "note": "Runner values from app.quant.runner_strategy_indicators (independent of sigma_indicators import).",
        "paper_only": True,
    }
    body = dict(artifact)
    body.pop("evidence_hash", None)
    artifact["evidence_hash"] = canonical_hash(body)
    path = out_dir / f"parity_evidence_BTCUSD_{ts}.json"
    path.write_text(json.dumps(artifact, indent=2, sort_keys=True), encoding="utf-8")

    # Also refresh a stable latest pointer (gitignored via pattern)
    latest = out_dir / "parity_evidence_latest.json"
    latest.write_text(json.dumps(artifact, indent=2, sort_keys=True), encoding="utf-8")

    report = {
        "ok": ok,
        "parity_ok": evidence.get("parity_ok"),
        "worst_delta": evidence.get("worst_delta"),
        "hook_status": hook.get("status"),
        "hook_owner": hook.get("owner"),
        "artifact": str(path),
        "evidence_hash": artifact["evidence_hash"],
        "mirror_did_not_book": "GBH-06" not in ({} if ok else orch.state.hook_state) or True,
    }
    # recompute mirror_did_not_book clearly: before evidence hook was empty; after evidence it is set
    report["mirror_did_not_book"] = mirror.get("evidence") is False
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())