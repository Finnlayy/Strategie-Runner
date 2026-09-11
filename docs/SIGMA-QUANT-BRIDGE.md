# Sigma Quant Bridge

Status: **implemented as a paper-only adapter** (2026-09-11).

## Responsibility and source of truth

The bridge does not reimplement physics.  `SigmaQuantBridge` delegates to the
Runner's existing `app.orchestrator.alpha_sigma_engine.sigma_indicators` math
(the same implementation used by the ALPHA/SIGMA engine) or, when explicitly
configured, to an installed Sigma module exposing `evaluate(payload)`.  An
external module is selected with `SIGMA_QUANT_MODULE`; the Runner remains
usable without it.

The selection flag is:

```text
QUANT_BACKEND=sigma   # default; missing Sigma => UNAVAILABLE + fail_closed
QUANT_BACKEND=legacy  # explicit legacy Runner adapter
QUANT_BACKEND=off     # intentionally disabled => UNAVAILABLE + fail_closed
```

`sigma` does not mean an LLM call.  The bridge only consumes closed prices and
returns `RegimePacket`, `QuantVerdict` and a `PaperIntent`.  A PaperIntent is a
ledger record, not a broker order.  There is no live-order authority in this
module.

## Contracts

The JSON-serialisable contracts live in `app/contracts/harvests.py` and are
also described in `docs/contracts/fusion-contracts.json`:

| Contract | Meaning | Guard |
| --- | --- | --- |
| `QuantRequest` | symbol instance + closed price series + parameters | rejects live mode and non-finite prices |
| `RegimePacket` | Sigma regime and confidence | closed-candle only |
| `QuantVerdict` | backend result, features, reasons, optional paper intent | unavailable is always fail-closed |
| `PaperIntent` | durable proposed paper action | `execution_mode == paper` only |
| `BlindPatternPacket` | Fable geometry vote | no symbol, timeframe, timestamp or absolute price |
| `AcademyEvent` | Jules lifecycle/replay event | `paper_only == true` |
| `NightTrainReport` | dry-run/replay result | no data means `SKIPPED` + fail-closed |

Every contract supports `to_dict()`, `from_dict()` and deterministic JSON
round-tripping.  Paper ledger records are hash chained in
`data/paper/paper_intents.jsonl` (path configurable with `PAPER_LEDGER_FILE`).

## SIGMA chamber wiring

The existing Python orchestrator instantiates the bridge lazily.  During
`decide()`, the SIGMA chamber receives a `quant` block containing the regime,
features and verdict.  If a selected backend is unavailable, new intents are
rejected with `QUANT_BACKEND_UNAVAILABLE` (and `SIGMA_STATE_MISSING` when the
series is too short).  Existing exit-first handling remains intact.

HTTP helpers:

* `GET /api/quant/backend` — selected backend and availability.
* `POST /api/quant/evaluate` — evaluate a `QuantRequest`; paper mode is forced.
* `POST /api/orchestrator/cycle` — existing ALPHA/SIGMA/Grok cycle, now carries
  the bridge result in the decision.

## Gap list (hypotheses, not fake canonical physics)

The checkout contains the Runner's Sigma-compatible indicator path, but no
separate Sigma harvest tree was supplied.  Therefore the following are **open**:

1. External Sigma module/API name and release pin (`SIGMA_QUANT_MODULE` is only
   an interface point).
2. Canonical MP-04/physics implementation and its fixture corpus.
3. Canonical Kraken paper-fill semantics (fees, partial fills and event IDs).
4. Glint×OB / Polymarket Layer-0 provenance and schemas.
5. M8/Judge parity fixture exchange across all symbols.

The bridge marks these as data/adapter gaps; it does not invent a canonical
implementation.  `GBH-06` remains the authoritative proof gate for Runner
indicator parity.

## Fail-closed examples

* no closed bars: `SIGMA_INSUFFICIENT_DATA`, no PaperIntent;
* missing selected Sigma implementation: `SIGMA_MODULE_UNAVAILABLE`,
  `QuantVerdict.status == UNAVAILABLE`, `fail_closed == true`;
* `QUANT_BACKEND=off`: same fail-closed result by policy;
* `execution_mode=live`: rejected at contract boundary.
