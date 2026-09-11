# Orchestrator-Engine — ALPHA/SIGMA-Zweikammersystem

Modul **19**: `app/orchestrator/alpha_sigma_engine.py` (Kern, Standardbibliothek),
`server/orchestratorEngine.ts` (Prozessbrücke), `server/grokOrchestrator.ts`
(Grok-Antragsseite), `src/components/quant/AlphaSigmaOrchestratorPanel.tsx` (Desk-Ansicht).

Diese Engine ist **die** Orchestrierungsschicht für autonome Grok-Agenten im
Strategie-Runner — gebaut nach dem hauseigenen ALPHA-/SIGMA-System, nicht nach
einer erfundenen Abstraktion:

* **SIGMA** ist die real existierende Strategie- und Risikofamilie dieses Repos:
  die `Sigma_*`-Runner in `data/strategy-manifest.json` (z-Score gegen
  `sigma = stdev(...)`, Hurst-Regime-Gate, EMA-Kreuz, Breakout-Fenster,
  ATR-Stop/Ziel, MOS-Preiszone, Cooldown, Hebelkappen ≤ 3 BTC / ≤ 10 XRP) und die
  Python-Risikolayer `kelly_sizing.py`, `m8_judge.py`, `dfa_engine.py`,
  `asset_calibrator.py`, `finbert_risk.py`.
* **ALPHA** ist die Edge-Seite: die Grok-Agenten aus Modul 18
  (`server/grokEngine.ts`: Triage → Sentiment-Screen → Debatte → final decision),
  die Ampel-Struktur, der RL-Fast-Path und die Champions aus
  `data/registry/strategies.json` (`SigmaXRP_Alpha_Gen3`, `Sigma_Kraken_Champion_v1`).
* Der Systemmodus heißt im Repo bereits `LIVE_FULL_ALPHA`
  (`app/core/directives.py`) — die Antragskammer ist also kein neues Konzept,
  sondern der fehlende Zugang dazu.

## 1. Das Prinzip: Gewaltenteilung mit einer Kante

```
   Marktdaten (Kraken OHLC 15m)            Grok-Agenten (Modul 18)
          │                                        │ trade-signal / votes
          ▼                                        ▼
  ┌───────────────────┐   AlphaVote[]    ┌──────────────────────┐
  │  ALPHA-KAMMER     │ ───────────────▶ │   ARBITRIERUNG       │
  │  Antragskammer    │                  │   deterministisch    │
  │  Alterung, IC,    │ ◀─────────────── │   Sigma-gewichtet,   │
  │  Regime-Filter    │   Outcome → IC   │   Reason-Codes       │
  └───────────────────┘                  └──────────┬───────────┘
                                                    │ OrderIntent
  ┌───────────────────┐   Gate-Ergebnis             ▼
  │  SIGMA-KAMMER     │ ─────────────────▶  Executor / Papierbuch
  │  Vol-Targeting,   │   (alloc, qty)      (nur wenn Flag gesetzt)
  │  Regime, Caps,    │
  │  Cooldown, Breaker│   ◀── Circuit Breaker & Modus aus system_directive
  └───────────────────┘
```

Zwei Regeln tragen das Design:

1. **Alpha beantragt, Sigma verfügt.** Ein LLM kann Richtung, Stärke, Horizont und
   Begründung liefern — aber nie Menge, Hebel, Exposure oder ein Gate. Das Schema
   der Agenten-Antwort enthält deshalb *keine* Orderfelder: die Gewaltenteilung
   wird vom JSON-Schema erzwungen, nicht von einer Beteuerung im Prompt.
2. **Bei Konflikt gewinnt Sigma.** Jeder abgelehnte Antrag trägt einen
   `RejectReason`-Code und landet im Journal. Es gibt keinen „Override durch
   Confidence“, keine Hintertür über `confidence_score = 1.0`.

Ein LLM-Veto aus der Risikoprüfung (`risk_review`) darf **nur verengen**: es setzt
einen Gegenantrag in die Alpha-Kammer und blockiert den Dispatch des laufenden
Zyklus. Es kann kein Gate lockern.

## 2. ALPHA-Kammer (`AlphaSubsystem`)

| Mechanik | Umsetzung |
|---|---|
| Quellen | `grok_trader`, `grok_sentiment`, `grok_debate_bull`, `grok_debate_bear`, `grok_news_triage`, `sigma_momentum`, `sigma_mean_reversion`, `ampel_structure`, `rl_fast_path`, `manifest_champion` |
| Alterung | exponentiell mit Halbwertszeit `alpha_half_life_bars` (12 Bars); nach `alpha_max_age_bars` (96) Ausschluss als `stale_sources` |
| Duplikatschutz | pro Quelle zählt nur der letzte Vote (max. 16 Quellen-Speicher je Symbol) |
| Lernsignal | **nur** Information-Coefficient: Richtung des Votes × realisierte Rendite über den Horizont, EWMA `λ = 0.90`, Gewichts-Multiplikator in `[0.35, 1.6]` |
| Regime-Filter | `REGIME_SOURCE_MATRIX`: Quelle × Regime. Mean-Reversion-Quellen sind im Trend-Regime gesperrt, Sentiment nur im Trend/Boom. Gesperrte Quellen erscheinen als `blocked_by_regime` |
| Antragsbildung | Netto-Score `Σ(pos)−Σ(neg) / Σ gesamt`; Antrag ab `|score| ≥ 0.18` **und** Gleichlauf `≥ 0.35`, sonst `NO_INTENT`/`ALPHA_DISAGREEMENT` |

Bewusst kein Supervised Fit im Takt: die Kammer verschiebt nur Gewichte, sie
trainiert keine Strategie um. Nächtliche Neubewertung ist als **GBH-09** an den Bot
exportiert (Batch-API-Vorschlag, Anwendung nur über die Gates).

## 3. SIGMA-Kammer (`SigmaSubsystem`)

Volatilitäts- und Regime-Lage, dann harte Kappen in **fester Reihenfolge**
(reproduzierbar, im `sizing_trace` nachvollziehbar):

| # | Gate | Regel | Code |
|---|---|---|---|
| 0 | Datenlage | < 5 Bars → keine Bewilligung | `SIGMA_STATE_MISSING` |
| 1 | Direktive | `circuit_breaker != NORMAL`, Modus `DRY_RUN`/`EMERGENCY_HALT` | `CIRCUIT_BREAKER`, `DIRECTIVE_MODE_BLOCKED` |
| 2 | Regime | `BROWNIAN_CHOP` sperrt neue Richtungsanträge | `REGIME_INCOMPATIBLE` |
| 2b | Struktur | Zufallsraum (Hurst zwischen den Toren) und MOS-Preiszone: Long braucht `support_score ≥ 7.5`, Short `resistance_score ≥ 7.5` | `STRUCTURE_RANDOM_WALK`, `MOS_ZONE_UNCONFIRMED` |
| 2c | Parität | Sigma-Zahlen müssen gegen den Runner belegt sein (GBH-06) | `PARITY_BROKEN`, `HOOK_UNCLAIMED_BLOCKING` |
| 3 | Zielvol | `alloc *= min(1, 0.20 / σ_annual)`; σ > 2.20 → Sperre | `VOLATILITY_GATE` |
| 4 | Drawdown | Dämpfer ab 5 % DD, Floor 0.20 (analog `kelly_sizer`) | — |
| 5 | Exposure | Brutto ≤ 60 %, je Symbol ≤ 35 %, Hebel ≤ 1.0 | `EXPOSURE_CAP`, `PER_SYMBOL_CAP`, `LEVERAGE_CAP` |
| 6 | Risiko-Budget | `qty = min(risk_budget/stop_dist, alloc·equity/price)`, Stop = 2.2·ATR | `RISK_BUDGET_ZERO`, `MIN_TICKET_UNMET` |
| 7 | Cash | Longs ≤ 98 % verfügbares Cash | `INSUFFICIENT_CASH` |
| 8 | Mikrostruktur | Spread ≤ 18 bps, Slippage ≤ 35 bps | `SPREAD_TOO_WIDE`, `SLIPPAGE_CEILING` |
| 9 | Cooldown | 1 Bar zwischen Aktionen je Symbol | `COOLDOWN_ACTIVE` |

Volatilität doppelt: EWMA (λ = 0.94) als Trägheitswert, GARCH(1,1)-light
(`ω=1e-6, α=0.08, β=0.90`) als Reaktionswert — identische Rekursion wie
`app/academy/drills.py`. Regime über `dfa_engine.compute_hurst_dfa`, wenn numpy
vorhanden ist; sonst R/S-Schätzung mit denselben Toren (0.45 / 0.55 / 0.75).

Positionsmanagement hat Vorrang: liegt ein Stop-Anschlag vor, erzeugt der Zyklus
sofort `FLATTEN` (`STOP_LOSS_TRIGGERED`) — unabhängig davon, ob Alpha bullish ist.

## 4. Sigma-Parität (der Grund, warum das kein zweites Regelwerk ist)

`sigma_indicators()` ist eine 1:1-Nachbildung der Runner-Funktionen
(`sma`, `ema`, `stdev` mit Division durch *n*, `atrProxy`, `hurstRs`,
`priceZoneScore`, Breakout `maxExcludingCurrent`). Der Nachweis ist kein
Dokument, sondern ein Test mit Fixtur aus echtem Node-Lauf:

```
tests/test_alpha_sigma_orchestrator.py::TestSigmaIndicators::test_runner_parity_z_atr_hurst
→ max. Abweichung Engine vs. Runner-JS: 0.0 (11 Indikatoren, 140 Kerzen)
```

Ein TS-Spiegel der Runner-Formeln wurde bewusst *nicht* als Beleg akzeptiert: eine
zweite Implementierung gegen sich selbst zu prüfen ist Selbstbestätigung, keine
Parität. `/api/orchestrator/parity-check` darf deshalb den Hook nicht erfüllen
(`mark_hook=False`, keine Cache-Schreibung) — buchen kann GBH-06 nur über
`POST /api/orchestrator/parity` mit Zahlen aus dem laufenden Runner-Skript.
Das Panel spiegelt genau diese Trennung: „Spiegel prüfen“ ist Debugging,
„Nachweis buchen“ braucht eingefügte Runner-Zahlen.

Solange **GBH-06** nicht als `IMPLEMENTED` gemeldet ist, bleibt die Antragskammer
zu (`HOOK_UNCLAIMED_BLOCKING`). Die Engine markiert den Hook selbst als erfüllt,
wenn ein Paritätsbericht unter Toleranz durchgeht
(`POST /api/orchestrator/parity` mit den vom Runner gemeldeten Zahlen).

## 5. API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/orchestrator/status?symbol=` | beide Kammern, Portfolio, Config, Regime-Matrix, Journal-Auszug, Hook-Zähler |
| POST | `/api/orchestrator/ingest` | Kursreihe/Preis + Equity/Cash einspielen |
| POST | `/api/orchestrator/indicators` | Runner-Identische Indikatoren (Werkzeug für Parität/Debug) |
| POST | `/api/orchestrator/votes` | Alpha-Anträge beliebigiger Quellen (Bot-Haupteingang) |
| POST | `/api/orchestrator/derive` | Anträge aus der Runner-Mathematik ableiten (`sigma_momentum`/`sigma_mean_reversion`/`ampel_structure`) |
| POST | `/api/orchestrator/decide` | ein Arbitrierungszyklus → `OrderIntent` oder `REJECTED` |
| POST | `/api/orchestrator/grok-signal` | normalisiertes Grok-`trade-signal` → Votes (+ optional `decideAfter`) |
| POST | `/api/orchestrator/parity` | GBH-06-Nachweis gegen Runner-Werte (`markHook:false` = ohne Buchung) |
| POST | `/api/orchestrator/parity-check` | Spiegel-Selbstvergleich der Brücke, **ohne** Nachweiswirkung |

Beide Paritäts-Endpunkte akzeptieren `prices` und prüfen dann gegen die übergebene
Reihe, statt den gespeicherten Taktzustand anzufassen — Debuggen ohne Seiteneffekt. 
| POST | `/api/orchestrator/fill` | Fill zurückmelden (Expositions-Gedächtnis, Cooldown) |
| GET | `/api/orchestrator/hooks` | Bot-Arbeitsliste, machine-lesbar (Status, Kontrakte, Fallbacks) |
| POST | `/api/orchestrator/hooks/:id/claim` | Stufe in Arbeit nehmen |
| POST | `/api/orchestrator/hooks/:id/resolution` | Stufe liefern (`status`, `payload`, `note`) |
| POST | `/api/orchestrator/hurst-probe` | GBH-04: DFA/Hurst exakt über `code_interpreter`, Δ zur R/S-Näherung |
| POST | `/api/orchestrator/cycle` | kompletter Takt: ingest → parity → derive → Grok-Votes → decide → Risk-Review → optional Dispatch |
| POST | `/api/orchestrator/reset` | Kammergedächtnis leeren |

`/api/orchestrator/cycle` akzeptiert `{symbol, prices?, useGrok, useXSearch,
useCodeInterpreter, runRiskReview, allowEntries, spreadBps, slippageBps,
dispatch, strategyId}`. Ohne `prices` holt der Server Kraken-OHLC (15 m) selbst.

**Dispatch ist doppelt verriegelt:** Request-Flag `dispatch:true` **und**
`ORS_ALLOW_DISPATCH=1`. Zielstrategien im Live-Modus brauchen zusätzlich
`ORS_ALLOW_LIVE_DISPATCH=1`. Standard: Der Orchestrator stellt Anträge zu, er
handelt nicht.

## 6. Grok-Bot-Übernahme — die markierten Stellen

Jede Übernahmestelle ist dreifach sichtbar: Code-Marker
`# >>> GROK-BOT [GBH-xx] >>>`, Registry `GROK_BOT_HOOKS`
(`GET /api/orchestrator/hooks`) und eigener Testfall in
`tests/test_alpha_sigma_orchestrator.py::TestGrokBotHooks`.
Status-Datei: `data/orchestrator/hook_state.json` (versioniert).

| ID | Kammer | Status | Blockiert | Was der Bot übernimmt | Fallback bis dahin |
|---|---|---|---|---|---|
| GBH-01 | ALPHA | PLACEHOLDER | nein | Agenten-Antrags-Prompts (Delegierung Fundamentals/Sentiment/News/Technical → Votes) | `/api/ai/trade-signal` + Runner-Heuristik |
| GBH-02 | ALPHA | PLACEHOLDER | nein | adaptive Gewichtung (Bayes/Bandit, kostenbereinigt, regime-konditioniert) | EWMA-IC mit Klemme |
| GBH-03 | SIGMA | PLACEHOLDER | nein | `REGIME_SOURCE_MATRIX` assetweise aus OOS-Daten | globale feste Matrix |
| GBH-04 | SIGMA | PLACEHOLDER | nein | exakte DFA via `code_interpreter` | R/S-Schätzung (DFA, falls numpy) |
| GBH-05 | ALPHA | PLACEHOLDER | nein | `x_search`-Handle-Listen aus Trefferstatistik | manuelle Kurzliste |
| **GBH-06** | ARBITRATION | PLACEHOLDER | **ja** | Paritätsnachweis Runner ↔ Engine laufend belegen | Toleranz 2 %, blockiert Anträge |
| GBH-07 | SIGMA | PLACEHOLDER | nein | Drawdown-Eskalationsleiter mit Recovery-Kriterien | linearer Dämpfer ab 5 % |
| GBH-08 | ALPHA | PLACEHOLDER | nein | Look-Ahead-Kadenz (PiT-Fenster, Anonymisierung) | auto: anonymisieren bei Kontamination |
| GBH-09 | ARBITRATION | PLACEHOLDER | nein | nächtliche Grenz-Vorschläge per Batch-API | keine Auto-Overrides |
| GBH-10 | ARBITRATION | PLACEHOLDER | nein | Champion/Challenger-Promotion → Alpha-Gewicht | `manifest_champion = 0.60` fix |

Protokoll:

```bash
# Arbeitsliste holen (ids, contracts, tests, fallbacks)
curl -s localhost:3000/api/orchestrator/hooks | jq '.hooks[] | {id, status, blocking, test}'

# Stufe übernehmen
curl -s -X POST localhost:3000/api/orchestrator/hooks/GBH-02/claim \
     -H 'content-type: application/json' -d '{"note":"bandit-entwurf läuft"}'

# Stufe liefern (Payload wird persistiert, Status flippt)
curl -s -X POST localhost:3000/api/orchestrator/hooks/GBH-02/resolution \
     -H 'content-type: application/json' \
     -d '{"payload":{"weights":{"grok_news_triage":0.18}},"note":"IC-bandit mit Gebührenbereinigung"}'
```

Der Bot liefert **Vorschläge und Payloads**; harte Kappen (Alloc, Hebel, Exposure,
Cash, Breaker) bleiben in der Engine und werden dort auch nach der Übernahme
nachgeführt. Ein `payload`, der eine Kappe anheben will, wird ignoriert — die
Konfiguration ändert nur `POST /api/ai/engine/config` bzw. `ORS_*`-ENV.

## 7. Tests: rot ist hier ein Soll-Zustand

```bash
npm run test:orchestrator     # 52 Fälle: 43 grün, 9 expectedFailure (GBH-01..05, 07..10)
npm run test:quant            # 73 Fälle inkl. Modul 18, OK (expected failures=9)
npm run lint                  # tsc --noEmit, sauber
```

Die 9 roten Fälle sind **keine** kaputten Tests: sie prüfen den Zustand *nach*
der Bot-Übernahme und sind mit `@unittest.expectedFailure` + Docstring
`Grok-Bot [GBH-xx] …` markiert. Liefert der Bot, schlagen sie auf
`unexpected failure` (= unerwarteter Erfolg) um und werden von der Dekoration
befreit. `test_GBH_06_parity_must_be_proven_by_bot` ist absichtlich **grün** —
der Paritätszwang ist keine Option, sondern Verhalten der Engine.

Registry-Invarianten sind selbstgeprüft: `test_referenced_files_exist` und
`test_referenced_tests_exist` erzwingen, dass jeder Hook auf eine echte Datei
und einen echten Test zeigt. Ein Hook ohne `fallback`-Angabe scheitert an
`test_registry_shape_and_ids`.

## 8. Umgebungsvariablen (Overlay über die Engine-Konfiguration)

| Variable | Default | Wirkung |
|---|---|---|
| `ORS_ALPHA_MIN_SCORE` | `0.18` | Antragsschwelle |
| `ORS_ALPHA_MIN_AGREEMENT` | `0.35` | Mindestgleichlauf |
| `ORS_ALPHA_HALF_LIFE` | `12` | Alterung in Bars |
| `ORS_SIGMA_TARGET_VOL` | `0.20` | Ziel-Volatilität (annualisiert) |
| `ORS_SIGMA_MAX_ALLOC_PCT` | `0.25` | harte Alloc-Kappe je Order |
| `ORS_SIGMA_MAX_RISK_PCT` | `0.02` | Risiko-Budget je Trade |
| `ORS_SIGMA_MAX_GROSS_EXPOSURE_PCT` | `0.60` | Brutto-Exposure |
| `ORS_SIGMA_MAX_LEVERAGE` | `1.0` | Hebel (Sigma-Runner-Caps ≤ 3 BTC / ≤ 10 XRP bleiben im Skript) |
| `ORS_SIGMA_EWMA_LAMBDA` | `0.94` | Vol-Trägheit |
| `ORS_SIGMA_HARD_STOP_ATR` / `ORS_SIGMA_TARGET_ATR` | `2.2` / `2.2` | ATR-Vielfache |
| `ORS_SIGMA_COOLDOWN_BARS` | `1` | Pause je Symbol |
| `ORS_SIGMA_MOS_THRESHOLD` | `7.5` | Preiszonen-Bestätigung |
| `ORS_SIGMA_HURST_TREND_GATE` / `ORS_SIGMA_HURST_MEANREV_GATE` | `0.55` / `0.45` | Regime-Tore |
| `ORS_ALLOW_DISPATCH` / `ORS_ALLOW_LIVE_DISPATCH` | *nicht gesetzt* | Dispatch-Freigabe (Papier / Live) |

## 8b. End-to-End nachgewiesen (Papier-Modus, Sandbox)

```
POST /api/orchestrator/votes      {source:"grok_trader", direction:+1, strength:.9}
POST /api/orchestrator/parity     {runner:{…11 Indikatoren…}}      → GBH-06 IMPLEMENTED
POST /api/orchestrator/cycle      {dispatch:true, strategyId:"gl1l2ha7d"}
  verdict APPROVED, alpha=0.932 gleichlauf=0.93
  intent LONG 0.00793153 BTC, notional $537.46 (alloc 0.37 % nach vol-scalar 0.2592 + cash-cap)
  sizing_trace {requested 0.25 → volatility_scalar 0.2592 → drawdown_dampener 1.0 → cash_capped}
  dispatch {attempted:true, mode:"paper", re_quoted:true}
POST /api/orchestrator/decide     → REJECTED [COOLDOWN_ACTIVE]   (1 Bar Pause je Symbol)
```

Ohne `ORS_ALLOW_DISPATCH=1` endet derselbe Lauf bei
`dispatch {attempted:false, reason:"ORS_ALLOW_DISPATCH != 1 …"}` — Antragslage und
Urteil sind identisch, nur die Order geht nicht raus. Das ist der Defaultzustand.

## 9. Zustand & Persistenz

`data/orchestrator/ors_state.json` (Snapshot: Kursreihen, Bars, GARCH-Zustand,
Votes, IC, Outcome-Puffer, Portfolio, Paritäts-Cache, letzte 50 Entscheidungen),
`data/orchestrator/decisions.jsonl` (Journal, `schema: "ors-decision/1"`),
`data/orchestrator/hook_state.json` (versioniert — das ist die Bot-Fortschrittsliste).
Journal-Schreibfehler blockieren den Takt nie (`OSError` wird geschluckt); die
Brücke läuft pro Aufruf in einem frischen Python-Prozess und rehydriert aus dem
Snapshot — der Orchestrator ist damit auch Server-Neustart-überstehend.

## 10. Grenzen und offene Punkte

* **Kein Broker-Anschluss des Portfolios.** `equityUsd`/`availableCashUsd` kommen
  aus dem Papierbuch (`paperBalances`) oder dem Request; ein Live-Saldo-Mirror
  gegen Kraken ist nicht angebunden. Solange das fehlt, sind Sigma-Caps für Live
  konservativ, nicht exakt.
* **Kein numpy-Zwang.** `dfa_engine`, `m8_judge`, `market_impact` brauchen numpy und
  sind im Orchestrator optional (try-import). Ohne numpy gilt: R/S-Hurst,
  M8-Gates als nachgebildete Kappen, Slippage nur als Eingangsparameter.
* **Kein eigenes Orderrouting.** `executeKrakenTrade` bleibt die einzige
  Dispatch-Naht (Level 2 Papier / Level 4 Live, wie im Rest des Repos).
* **Spread ohne bid/ask.** Der Runner liefert keine Buchtiefe; `spreadBps` muss der
  Aufrufer setzen, sonst prüft Sigma die Mikrostruktur nicht.
* **Größen aus der Einspeise-Serie, Füllung zum Live-Preis.** Der Orchestrator
  rechnet mit den Bars, die ihm übergeben wurden; der Executor füllt zum Ticker-Preis.
  `/api/orchestrator/cycle` führt die Menge deshalb vor dem Dispatch nach
  (`min(qty, 0.98·Cash / livePx)`, Log-Hinweis, `dispatch.re_quoted=true`) und meldet
  den Fill automatisch zurück (`/api/orchestrator/fill`), damit Expositions-Gedächtnis
  und Cooldown nicht driften.
* **Cooldown ist symbolrelativ.** `last_action_bars[symbol]` gegen den eigenen Takt;
  ein zurücklaufender Takt (Re-Ingest/`reset`) wird nicht als Cooldown-Schuld gewertet.
* **15m-Bars, annualisiert mit 365·24·4.** Krypto-Rechenzeit, bewusst konservativ
  gegenüber Börsenkalendern; für Vergleichbarkeit mit `target_annual_vol = 0.20`
  aus `kelly_sizer.py` identisch gehalten.
* **Report-Abweichung:** der Architektur-Report nannte einen
  „Orchestrator mit autonomen Orderrechten“. Den gibt es hier bewusst nicht —
  Agenten bekommen Antragsrecht, das Kapital bleibt bei Sigma.

## Fusion bridge (Sigma / Fable / Jules)

The ALPHA/SIGMA chambers remain the arbitration shell.  The SIGMA chamber now
receives the paper-only `SigmaQuantBridge` result under `decision.quant`; this
is an adapter around the existing Runner math, not a parallel physics engine.
Configure it with `QUANT_BACKEND=sigma|legacy|off` (default `sigma`).  A missing
selected backend is fail-closed.  See `docs/SIGMA-QUANT-BRIDGE.md`.

Fable blind perception is an optional pre-Propose feature.  Its
`BlindPatternPacket` contains only closed-candle geometry and cannot carry a
symbol, timeframe, timestamp or absolute price.  See `docs/BLIND-PERCEPTION.md`.

Jules Academy is paper-first: `AutonomousLearningLoop` writes durable,
hash-chained PaperIntents and `NightTrainJob` replays them in a capped dry run.
Academy promotion is `SHADOW_CHAMPION`; it does not grant `LIVE_CHAMPION` or
live execution.  See `docs/JULES-ACADEMY-BRIDGE.md`.

### GBH-06 parity evidence plan

The bot must post `POST /api/orchestrator/parity` with the same closed price
series, strategy parameters, and Runner-produced values for `basis`, `sigma`,
`z_score`, `atr`, `hurst`, EMA/breakout and MOS scores.  The response must show
all required fields `ok` within tolerance and include the source/run ID or
content hash of the Runner artifact.  Only then may it post a GBH-06
`IMPLEMENTED` resolution.  A bridge self-comparison (`parity-check`) is not
evidence and does not clear the gate.  The nine GBH expected-failure tests stay
marked until their actual bot resolutions exist.
