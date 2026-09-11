# Fusion inventory and implementation plan

Date: 2026-09-11.  This is the contract-first inventory for the checkout; an
unavailable harvest is recorded as a gap rather than simulated as canonical.

## Existing Runner inventory

| Layer | Existing source | Role retained |
| --- | --- | --- |
| Shell | `server/grokOrchestrator.ts`, `server/orchestratorEngine.ts` | Grok orchestration and ALPHA/SIGMA adapter |
| SIGMA math | `app/orchestrator/alpha_sigma_engine.py` and `server/quantitativeEngine.ts` | regime, z/ATR/Hurst, caps, M8-compatible gates, parity |
| Data | `app/ingestion`, `app/data_layer`, Kraken helpers | bars/ingest; TradingView is not SoT |
| Academy | `app/academy/drills.py`, `ab_racing.py`, `app/registry/*` | drills, shadow race, career/registry |
| Postmortem | `app/analysis/postmortem_rag.py` | cold-path analysis/proposals |
| Hooks | `GROK_BOT_HOOKS`, `GBH-01…10` | Grok hand-off; GBH-06 remains blocking |

No Sigma external tree, Jules Windows prompt pack or Neo source tree is present
in this checkout.  The adapters therefore expose explicit interfaces and gap
reports instead of copying an unverified engine.

## Deliverables by phase

1. **A — contracts/inventory:** `app/contracts/harvests.py`, JSON schema,
   this inventory and hook mapping.
2. **B — Sigma adapter:** `app/quant/sigma_bridge.py`, backend flag, fail-closed
   result, SIGMA chamber `decision.quant` wiring.
3. **C — Academy:** `AutonomousLearningLoop`, durable paper ledger and capped
   `NightTrainJob`; status promotion is shadow-only.
4. **D — Blind perception:** geometry boundary, closed-bar and leakage guards,
   optional packet on QuantRequest.
5. **E — parity:** hash-chained PaperIntent records and an evidence plan for
   GBH-06; no self-comparison is accepted as proof.
6. **F — verification/docs:** fusion tests, bridge docs, API endpoints and
   existing tests unchanged including nine expected failures.

## GBH event mapping

| Hook | Fusion event/input | Adapter or proof |
| --- | --- | --- |
| GBH-01 | `ACADEMY_SCOUT` / AlphaVotes | `server/grokOrchestrator.ts` → ALPHA only |
| GBH-02 | `POSTMORTEM_PENDING` / IC outcome | existing Alpha EWMA fallback; no risk-cap mutation |
| GBH-03 | `REGIME_PACKET_READY` | `RegimePacket`, asset calibration remains open |
| GBH-04 | `REGIME_PACKET_READY` / DFA evidence | existing code-interpreter probe; not silently canonical |
| GBH-05 | `ACADEMY_SCOUT` / source handles | Grok x_search allow/exclude policy |
| GBH-06 | `PAPER_PARITY_CHECK` | Runner values via `/api/orchestrator/parity`, hash/run ID required |
| GBH-07 | `JUDGE_GATE` / drawdown | Sigma caps and existing circuit breaker |
| GBH-08 | `POSTMORTEM_PENDING` / bias audit | existing look-ahead guard and anonymization |
| GBH-09 | `NIGHT_TRAIN_REPORT` | Night-Train dry-run; proposals only, no auto override |
| GBH-10 | `PROMOTION_GATE` | `SHADOW_CHAMPION`; never automatic `LIVE_CHAMPION` |

## Non-negotiable safety invariants

* symbol is a parameter everywhere; BlindPatternPacket is symbol-agnostic;
* perception precedes propose and has no execution capability;
* only closed bars enter quant/perception; no look-ahead fields;
* Sigma wins ALPHA/SIGMA conflicts;
* AI can analyze, triage, resolve hooks and produce digests, but not place a
  live order;
* empty/missing backend/data returns a structured fail-closed result;
* promotion is not live authorization;
* no unattended paid-API loop is used by the autonomous or night paths.
