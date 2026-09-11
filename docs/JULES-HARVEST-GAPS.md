# Jules Academy Bridge — local harvest gap notes

Date: 2026-09-11. Operator SoT on Windows: `D:\GrokTrading\harvests\jules`.

## What Runner already has

- Paper-only Academy loop / Night-Train (`app/academy/*`)
- Durable paper ledger replay
- Shadow promotion only (`SHADOW_CHAMPION` — never live)

## Mapping (Runner ↔ Jules pack)

| Jules concept (pack) | Runner surface | Status |
| --- | --- | --- |
| Curriculum / drills | `app/academy/drills.py`, Academy events | Partial — Runner drills exist; full Jules curriculum JSON not imported |
| Autonomous self-learn loop | `app/academy/autonomous_loop.py` | Wired (paper) |
| Night / 24h train cycle | `app/academy/night_train.py`, `POST /api/academy/night-train` | Wired dry-run + budget caps |
| Careers / promotion gate | Academy state + registry | Shadow-only; no live champion |
| Broker matrix live routes | — | **Out of scope** (interfaces/stubs only; paper-first) |
| Jules frontend | — | **Not** duplicated |

## Explicit gaps (not fabricated)

1. Full curriculum catalog from the Jules prompt series (`01_`–`10_`) is not bulk-imported — map per drill when needed.
2. Jules `.venv` / app services are harvest copies, not the Runner runtime.
3. Paid-API night loops stay capped (`max_cost_usd=0` default in smoke).

## Operator

- Harvest: `JULES_HARVEST_ROOT` in local `.env`
- Smoke: `python scripts/smoke_sigma_bridge.py` (includes Night-Train dry-run)