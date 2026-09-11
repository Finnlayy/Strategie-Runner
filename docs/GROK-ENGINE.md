# Grok-Engine — LLM-Orchestrierung für den Strategie-Runner

Modul **18 / 18b**: `server/grokEngine.ts` (TypeScript-Laufzeitpfad) und
`app/llm/grok_contracts.py` (Python-Vertragsschicht). Beide Schichten bilden die
xAI-Grok-Integration der Engine; Gemini bleibt als Fallback erhalten.

```
Frontend (AIReviewer, BacktestingPanel)
        │
server.ts  ── quantCopilot(task, prompt, schema)        ← ein Dispatcher, ein Schema
        │        │
        │        ├─ grokEngine.ts   → POST https://api.x.ai/v1/responses
        │        └─ executeGeminiWithRetry (Fallback)
        │
app/llm/grok_contracts.py ← zweite, unabhängige Vertragsprüfung (Base64-Bridge)
```

## 1. Was optimiert wurde

| Hebel aus der Architektur | Umsetzung in der Engine |
|---|---|
| **Modell-Routing-Layer** | `TASK_ROUTING`: Taskklasse → Modellkette + Economy-Kette. Triage/Sentiment laufen auf `grok-4.20-0309-non-reasoning`, die finale Entscheidung auf `grok-4.6`, Debatten auf `grok-4.20-multi-agent-0309`, RAG/lange Dokumente auf `grok-4.3`. |
| **Prompt Caching + Sticky Routing** | `assemblePrompt()` erzwingt byte-stabilen Präfix (System + Manifest-Korpus zuerst, Dynamik zuletzt). Requests tragen `prompt_cache_key` (Responses API) **und** Header `x-grok-conv-id`; `store:false`, keine serverseitige Konversation. Repair-Turns werden nur **angehängt**, der Präfix bleibt identisch → Cache bleibt im Korrekturlauf warm. |
| **Rate-Limits / 429-Schutz** | `GrokRateGovernor`: Token-Bucket je Modell und Tier, Kappe = `min(RPS, TPM/60/Ø-Token)` (xAI leitet RPS aus dem Minutenbudget ab). 429/5xx → exponentielles Backoff mit vollem Jitter, `Retry-After` wird respektiert, plus adaptive Drossel (AIMD: Penalty 0.5→0.25, Erholung +10 %/s). Aufsteigendes Tier aus kumuliertem Spend (`$0/$50/$250/$1k/$5k`), Tier-Upgrades werden nie zurückgenommen. |
| **Long-Context-Preissprung** | `checkLongContextBudget()`: ab 200k Prompt-Token verdoppelt xAI den Preis für **alle** Token des Requests → Korpus wird beschnitten statt teuer durchgereicht. |
| **Strukturierte Ausgabe + Guardrails** | `grokStructured()`: JSON-Schema (`text.format.json_schema`, `strict:true`), eigene Validierung (Enum/Bounds/`maxLength`/`minItems`), **Repair-Loop** mit exakter Fehlermeldung als neuer Turn (Default 2 Versuche, `GROK_MAX_REPAIR_ATTEMPTS`). |
| **Output-Guardrails (Handelslogik)** | `enforceTradeGuardrails()`: `allocation_percentage > 1.0` → harte Ablehnung; Clamp auf `GROK_MAX_ALLOCATION_PCT`; Risiko-Check gegen Equity (`GROK_MAX_RISK_PER_TRADE_PCT`); Ticker-Konzentrations-Cap; Confidence-Schwelle; `rationale` ≤ 500 Zeichen; Stop-Loss-Pflicht bei großen Positionen; Action-Synonyme (auch deutsch) werden normalisiert, Unbekanntes → HOLD. |
| **Pre-LLM-Guardrails** | `scrubUntrustedText()` / `asUntrustedBlock()`: Prompt-Injection-Muster aus X-Posts/News → `[REDACTED_INSTRUCTION]`, PII → `[REDACTED_PII]`, Längen-Deckel, Delimiter-Smuggling entfernt. |
| **Server-Tools** | `buildXSearchTool()`: `allowed_x_handles`/`excluded_x_handles` (max 20, **mutually exclusive** — Whitelist gewinnt), `from_date`/`to_date` als ISO-Tag, `enable_image_understanding`, `enable_video_understanding`. `buildCodeInterpreterTool()` für deterministische Indikator-/Bepreisungsrechnung. `max_tool_calls` = `GROK_MAX_TOOL_TURNS` (Analogon zu `xai_max_turns`). |
| **Kostenbuchführung (TCO)** | `CostLedger` schreibt `data/registry/llm_cost_ledger.jsonl` (rotiert bei 4 MB): Token, `cached_tokens`, Modell, Tool-Fees, `cache_hit`, `long_context_priced`, Latenz, Repair-Versuche. Monatsprojektion + **Spend-Breaker** (`GROK_MONTHLY_SPEND_CAP_USD`): Requests werden abgewiesen, **bevor** sie die API erreichen; der Breaker loggt in das Desk-Terminal. |
| **Batch vs. Streaming** | `submitBatch()` für kalte Pfade (nächtliche Neubewertung, Post-Mortems) — wählt automatisch ein **batch-fähiges** Modell; `grokComplete({onDelta})` + `GET /api/ai/stream` (SSE) für latenzkritische Antworten. |
| **Look-Ahead-Bias** | `assessLookAheadBias()` prüft das Backtestfenster gegen den Knowledge-Cutoff des Modells (`grok-4.6` = 2026-02-01) und meldet `contaminatedPct`/`riskLevel`. `/api/backtest/ai-analyze` **anonymisiert Entitäten automatisch** (Distraction Effect) und erzwingt `lookAheadVerdict`. Python-Seite: `LookAheadBiasGuard.gate()` blockiert Promotion bei kritischer Kontamination, `alpha_decay()` misst In-Sample→OOS-Verfall (Verdikt `collapse` ab 4 pp Sharpe). |

## 2. Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/ai/engine` | Provider-Status, Routing-Tabelle, Modellkatalog (Preise, Cutoffs, Batch-Fähigkeit), Tier, Throttle-Snapshot, Ledger |
| POST | `/api/ai/engine/config` | Laufzeit-Overrides: `providerMode`, `monthlySpendCapUsd`, `maxAllocationPct`, `maxRiskPerTradePct`, `maxToolTurns`, `promptTokenBudget`, `anonymizeBacktestPrompts`, `tierOverride`, `resetBreaker` |
| GET | `/api/ai/engine/cost` | Ledger: Monatskosten, Projektion, Cache-Trefferquote, Tool-Fees, Breaker |
| POST | `/api/ai/engine/cost-probe` | Kostenvorhersage je Prompt (inkl. Python-Zweig) |
| POST | `/api/ai/x-sentiment` | x_search-Screening mehrerer Symbole, TTL-Cache, Querprüfung gegen FinBERT-Lexikon (`divergence` = Manipulationshinweis) |
| POST | `/api/ai/triage` | Billiger Vorfilter: lohnt die Meldung den teuren Workflow? |
| POST | `/api/ai/trade-signal` | Agenten-Pipeline Triage → Sentiment → (Bull/Bear-Debatte) → Risiko-Veto → Trader, mit Repair-Loop, zweiter Python-Vertragsprüfung und optionalem Dispatch über die bestehende Paper-/Live-Queue |
| POST | `/api/ai/bias-audit` | Look-Ahead-Bias-Audit (TS + Python), Anonymisierung, Alpha-Decay |
| POST | `/api/ai/batch` · GET `/api/ai/batch/:id` | Batch-Einreichung / Status kalter Jobs |
| GET | `/api/ai/stream` | SSE-Streaming eines Copilot-Textes |

Bisherige Endpunkte (`/api/ai/suggest`, `/api/ai/debug`, `/api/ai/tweak`,
`/api/ai/manifest-learn`, `/api/backtest/ai-analyze`) laufen unverändert weiter
und nutzen automatisch den Grok-Pfad samt Response-Feldern `engine`,
`costUsd`, `cacheHit`, `repairAttempts`, `citations`.

## 3. Aktivierung

```bash
echo 'XAI_API_KEY="sk-..."' >> .env
npm run dev
curl -s localhost:3000/api/ai/engine | jq '.grok_active, .ledger.budget_used_pct'
```
Ohne `XAI_API_KEY` bleibt alles bei Gemini bzw. dem lokalen Fallback — kein
funktionaler Verlust, nur ohne x_search/Tool-Pfad.

WichtigeENV-Variablen stehen kommentiert in `.env.example`.

## 4. Verifikation

```bash
npm run test:grok     # 58 Prüfungen gegen gemockte xAI-API (kein Netzwerk, kein Key)
npm run test:quant    # 21 Python-Unit-Tests (Guardrails, Bias-Guard, AgentGraph)
npm run lint          # tsc --noEmit (TypeScript + Frontend-Typen)
```

## 5. Korrekturen gegenüber dem Recherchebericht

Diese Punkte wurden bewusst **nicht** 1:1 übernommen, weil sie von der
xAI-Doku (Stand der Integration) abweichen — alle Werte sind deshalb
konfigurierbar statt hartkodiert:

1. **Modell-IDs**: `grok-4.1-fast` und `grok-3-mini` stehen nicht mehr im
   Modellkatalog; ein Routing darauf würde 404 liefern. Verwendet werden
   `grok-4.6`, `grok-4.5`, `grok-4.3`, `grok-4.20-0309-{reasoning,non-reasoning}`,
   `grok-4.20-multi-agent-0309`, `grok-build-0.1`.
2. **Cached-Input-Preise**: stärker rabattiert als im Bericht angegeben
   (`grok-4.6` $0.50/1M, `grok-4.5` $0.30/1M, `grok-4.3` $0.20/1M).
3. **Long-Context-Pricing** fehlt im Bericht komplett: ab 200k Prompt-Token wird
   der **gesamte** Request zum doppelten Preis abgerechnet — in der Praxis der
   größte Kostenhebel und als Clamp implementiert.
4. **Batch API** wird von `grok-4.6` nicht unterstützt; `prepareBatch()` weicht
   deshalb automatisch auf ein batch-fähiges Modell aus.
5. **Sticky Routing**: der Header `x-grok-conv-id` gilt für die
   Chat-Completions-API; für die Responses API ist `prompt_cache_key` im Body
   das korrekte Feld. Beides wird gesendet.
6. **x_search-Filter**: `allowed_x_handles`/`excluded_x_handles` sind
   **gegenseitig ausschließend**, maximal 20 Handles, Datumsfenster als
   `YYYY-MM-DD`. `include_output` ist kein API-Parameter — Zitate kommen über
   `citations`/`url_citation`-Annotations, genau so werden sie protokolliert.
7. **Caching ≠ TPM-frei**: gecachte Prompt-Token zählen weiterhin gegen das
   TPM-Limit (nur billing-reduziert) — der Governor berücksichtigt das.
8. **Latenz**: LLM-Agenten bleiben im Sekundenbereich. Die Engine routet
   deshalb keine Orderausführung durch das Modell — das Signal endet vor dem
   Executor und wird dort gegen Ledger-/Hard-Stop-Regeln geprüft.
