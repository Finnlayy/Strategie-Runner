"""P1/P2 local smoke: Sigma bridge, Blind leakage, Paper ledger, Night-Train."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Load local .env lightly (no dependency on python-dotenv required)
env_path = ROOT / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        os.environ.setdefault(k, v)

os.environ.setdefault("SIGMA_HARVEST_ROOT", r"D:\GrokTrading\harvests\sigma")
os.environ.setdefault("SIGMA_QUANT_MODULE", "app.quant.sigma_harvest_adapter")
os.environ.setdefault("QUANT_BACKEND", "sigma")
os.environ.setdefault("AI_LIVE_ORDERS", "false")

from app.academy.night_train import NightTrainJob
from app.contracts import PaperIntent, QuantRequest
from app.paper.ledger import DurablePaperLedger
from app.perception import BlindLeakageError, blind_geometry_from_candles, detect_blind_patterns
from app.quant.sigma_bridge import SigmaQuantBridge
from app.quant.sigma_harvest_adapter import harvest_status


def _series(n: int = 120, start: float = 64000.0):
    out = [start]
    x = start
    for i in range(1, n):
        x *= 1.0 + (0.0015 if i % 5 else -0.0007)
        out.append(x)
    return out


def main() -> int:
    report = {"ok": True, "steps": []}

    def step(name: str, ok: bool, detail: dict):
        report["steps"].append({"name": name, "ok": ok, **detail})
        if not ok:
            report["ok"] = False

    hs = harvest_status()
    step("harvest_root", hs["exists"] and hs["marker_hits"] >= 2, {"harvest": hs})

    prices = _series()
    req = QuantRequest("BTC/USD", prices, execution_mode="paper")

    # P1a: backend off
    off = SigmaQuantBridge(backend="off").evaluate(req)
    step("backend_off_fail_closed", off.verdict.status == "UNAVAILABLE" and off.verdict.fail_closed,
         {"status": off.verdict.status, "reasons": off.verdict.reasons})

    # P1b: sigma missing harvest + no local → unavailable
    os.environ["SIGMA_HARVEST_ROOT"] = r"D:\GrokTrading\harvests\sigma__missing__"
    # Force external path: bridge with local_sigma_available False and module set
    missing = SigmaQuantBridge(backend="sigma", local_sigma_available=False).evaluate(req)
    step("sigma_missing_fail_closed", missing.verdict.status == "UNAVAILABLE" and missing.verdict.fail_closed,
         {"status": missing.verdict.status, "reasons": missing.verdict.reasons})
    os.environ["SIGMA_HARVEST_ROOT"] = str(hs["root"])

    # P1c: happy path via harvest adapter module
    from app.quant import sigma_harvest_adapter as sha
    happy = SigmaQuantBridge(backend="sigma", local_sigma_available=False, sigma_callable=sha.evaluate).evaluate(req)
    step("sigma_happy_path", happy.verdict.status in {"APPROVED", "NO_SIGNAL"} and not happy.verdict.fail_closed,
         {"status": happy.verdict.status, "regime": happy.regime.regime, "backend": happy.verdict.backend,
          "features_keys": sorted(list(happy.verdict.features.keys()))[:12]})

    # P2a: blind leakage + closed candle
    candles = []
    px = prices[-8:]
    for i, c in enumerate(px):
        o = px[i - 1] if i else c
        candles.append({"open": o, "high": max(o, c) * 1.001, "low": min(o, c) * 0.999, "close": c, "closed": True})
    geom = blind_geometry_from_candles(candles)
    packet = detect_blind_patterns(geom, as_of_bar=len(prices) - 1)
    leak_ok = True
    try:
        blind_geometry_from_candles([{**candles[0], "closed": False}])
        leak_ok = False
    except BlindLeakageError:
        pass
    try:
        from app.perception import build_blind_pattern_packet
        build_blind_pattern_packet({"symbol": "BTC/USD", "body_ratio": 0.2})
        leak_ok = False
    except BlindLeakageError:
        pass
    step("blind_leakage_and_pattern", leak_ok and packet.closed_bar_only and packet.symbol_agnostic,
         {"pattern_id": packet.pattern_id, "confidence": packet.confidence})

    # P2b: paper intent + night train
    with tempfile.TemporaryDirectory() as tmp:
        ledger_path = str(Path(tmp) / "paper_intents.jsonl")
        ledger = DurablePaperLedger(ledger_path)
        empty = NightTrainJob(ledger=ledger).run(dry_run=True)
        step("night_train_empty_fail_closed", empty.status == "SKIPPED" and empty.fail_closed,
             {"status": empty.status, "errors": empty.errors})
        intent = happy.verdict.paper_intent or PaperIntent(
            "BTC/USD", "HOLD", 0.0, prices[-1], source="smoke", reason_codes=["SMOKE"])
        ledger.append(intent)
        verify = ledger.verify()
        trained = NightTrainJob(ledger=ledger).run(dry_run=True)
        step("paper_intent_and_night_train", verify["ok"] and trained.status == "DRY_RUN" and not trained.fail_closed,
             {"verify": verify, "night_status": trained.status, "processed": trained.budget.get("processed_records")})

    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())