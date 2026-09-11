# Neo / Fable Blind — harvest gap notes

Date: 2026-09-11. Operator SoT: `D:\GrokTrading\harvests\neo_fabel`.

## What Runner already has

- Closed-candle geometry adapter + leakage guards (`app/perception/blind_patterns.py`)
- `rna_smart` alias → `detect_blind_patterns`
- Blind packet optional on `QuantRequest` / bridge features
- No execution capability in perception

## Gap vs Neo_Fabel harvest

| Neo/Fable surface | Runner | Note |
| --- | --- | --- |
| `rna_smart` / blind candle geometry | Implemented | Symbol-agnostic; closed bars only |
| Full Academy blind drill library in Neo backend | Not ported 1:1 | Use Runner drills + optional Blind packet |
| Signal routes / Kraken paper worker (Docker) | Separate Neo stack | Keep Neo for agency paper trail; Runner owns orchestrator hooks |
| Live-gated broker roles in doctrine | Respected as refuse-live | Runner: `AI_LIVE_ORDERS=false` |

## Non-goals

- Do not copy Neo frontend or Firebase agent-skills into Runner.
- Do not treat Neo `node_modules` as quant SoT.

## Operator

- Harvest: `NEO_HARVEST_ROOT` in local `.env`
- Leakage smoke covered in `scripts/smoke_sigma_bridge.py`