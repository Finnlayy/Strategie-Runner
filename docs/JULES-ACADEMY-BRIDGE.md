# Jules Academy Bridge

Status: **paper-only Academy contract, autonomous loop and Night-Train dry-run**.

## Academy state and loop

`app/academy/autonomous_loop.py` implements a deterministic shell around the
harvest contracts:

```text
Scout: closed bars -> Sigma RegimePacket + optional Fable BlindPatternPacket
Propose: structured playbook -> PaperIntent
Judge: contract, parity and existing Sigma gates
Paper: append-only hash-chained Paper Ledger
Postmortem: emit POSTMORTEM_PENDING AcademyEvent
Registry: event payload is available for the existing career/strategy registry
```

It does not call Grok, Gemini, xAI, a broker, or a paid API.  The Fable packet
is optional and is never a direct-execution signal.

`app/academy/state.py` provides the minimal explicit Academy state contract
(curriculum, drills, career events and a parity-backed `SHADOW_CHAMPION`
promotion gate).  It cannot return live authorization.

`app/academy/night_train.py` provides `NightTrainJob` and `run_night_train`.
It replays paper intents, emits policy evaluations with
`live_authorized: false`, and accepts caps (`max_records`, `max_cost_usd`).
A missing/empty ledger returns `NightTrainReport(status="SKIPPED",
fail_closed=true)`; it does not manufacture training data.  HTTP entrypoint:

```text
POST /api/academy/night-train
```

The endpoint defaults to `dry_run=true`, clamps the record budget and sets API
cost to zero.  Promotion is shadow policy only and never implies live status.

## Existing Academy inventory and gap

Present in the Runner before this bridge:

* `app/academy/drills.py`: DR-01ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦DR-05 stress drill battery;
* `app/academy/ab_racing.py`: Champion/Challenger shadow queue;
* `app/registry/*`: identity, immutable career events and badges;
* `app/analysis/postmortem_rag.py`: cold-path postmortem proposals.

Added by this bridge:

* stable AcademyEvent/NightTrainReport contracts;
* autonomous Scout ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Paper ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Postmortem event shell;
* durable paper replay and explicit budget caps;
* promotion wording/state changed to `SHADOW_CHAMPION` (no automatic
  `LIVE_CHAMPION` or `LIVE_PROMOTED` badge).

Still open because the source Jules prompt pack is not in this checkout:

* exact curriculum/drill/career taxonomy and promotion thresholds;
* Windows `E:\Downloads_Sortiert_2026-05-20\...` source import;
* 24-hour scheduler/cron deployment policy;
* external paper-fill semantics and replay corpus.

These are documented gaps, not silently fabricated Academy content.

See also [local harvest gaps](JULES-HARVEST-GAPS.md).
