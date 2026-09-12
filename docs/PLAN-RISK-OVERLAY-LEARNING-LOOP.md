# Plan: Risk-Overlay + Data-Approved-Flag + geschlossene Lernschleife

Stand: 2026-09-12  
Repo: `Finnlayy/Strategie-Runner` (`main`)  
Owner: Finn / Peter  
Status: **Plan + Auftrag an den GitHub-Agenten.**  
Peter verdrahtet spaeter nur noch gegen echte lokale Daten.

---

## Auftrag an den GitHub-Agenten (kein Lokalzugriff)

Du liest GitHub, nicht Finns Platte. Kein `data/paper`, kein Lake, kein `.env`.
Peter verdrahtet danach nur Adapter. Dein Job ist der Grossteil der Denkarbeit:
Pseudocode, Typen, Fixtures, Wiring-Map — so klar, dass Peter nicht nochmal
das Design erfinden muss.

### Arbeitsweise: Schwarm, parallel

Nutze deine Schwarmagenten. Zerlege die Lieferung und fahr sie **gleichzeitig**:
Types, Data-Approved, Overlay, Screener, Journal-Learn, Fixtures. Ein Agent
haelt die Trennlinien (Sigma verfuegt / Alpha beantragt / NIO-Limb). Kein
serielles Abarbeiten der sechs Dateien, wenn sie sich nicht blockieren.
Ein kurzes Swarm-Digest oben in `05-wiring-map.md`: wer was geliefert hat.

### Freiheit vs. hart

**Hart (nicht verhandelbar):** die Invarianten in §0, fail-closed, nur verengen,
AI niemals Live-Order, Module symbol-agnostisch, Snapshot-Inputs statt
`data/`-Reads, keine Secrets, kein Force auf `main`.

**Frei:** Schwellen, zusaetzliche Gates, Dateischnitt, Funktionsnamen soweit
nicht schon im Repo, Fixture-Zuschnitt, bessere Typen wenn du sie begruendest,
Reihenfolge der Hilfsfunktionen. Wenn du von einem Startwert in §3–5 abweichst:
eine Zeile *warum*, angelehnt an NIO / Sigma / Alpha, nicht an Bauchgefuehl.

Erfinde keine zweiten Journal-Formate und keine parallele SoT neben Parquet+DuckDB
bzw. `execution_logs.jsonl`. Erweitere additiv.

### Woran du dich orientierst

Nicht eine leere 8-Agenten-Folie. Drei bestehende Stapel, in dieser Prioritaet:

1. **Sigma** (Quant / Risiko / SoT-Physik)  
   Im Runner: `docs/ORCHESTRATOR-ALPHA-SIGMA.md`, `docs/SIGMA-QUANT-BRIDGE.md`,
   `app/execution/m8_judge.py`, `app/execution/kelly_sizing.py`,
   `app/orchestrator/alpha_sigma_engine.py`.  
   Sigma verfuegt: Vol-Target, Regime, Caps, Cooldown, Breaker. Overlay ist
   diese Kammer ueber alle Schichten, nicht ein neues Risikomaerchen.

2. **Alpha** (Antrag / Kammer / IC-Lernen)  
   Dieselben Docs: Alpha beantragt, altert, filtert nach Regime, lernt nur
   ueber Information-Coefficient / EWMA-Gewicht in einem Clamp — nicht per
   LLM-Rewrite der Strategie. Screener+Scorecard sollen sich an dieser
   Kammer anlehnen (Modul statt Grok-Quelle), nicht an einem Prompt-Agenten.

3. **NIO** (Judge / Limb / Lernen als Kernel, nicht als duennes Math-Stub)  
   Oeffentliche Finnlayy-Repos und was der Runner davon schon geerntet hat.
   Nimm Judge-Barrieren, Limb-Trennung (Signal vs. Size vs. Route) und
   Learning-Hooks als **Muster**. Kopiere keine symbol-verdrahteten Module
   (der Architect-Fehler: generisches Limb als BTC-only). NIO ist gross;
   du brauchst nicht den ganzen Kernel — du brauchst die Trennlinien.

TradingView ist optional/abnehmbar. Pine ist nicht Pflicht. MT5/ONNX ist
nicht SoT. Glint/Polymarket ist Phase 4, nicht dein Erstlieferumfang.

Wenn Sigma und NIO sich in einem Detail beissen: **Sigma gewinnt fuer Size
und Gate, Alpha/NIO fuer Antrag und Lernsignal.** Kurz begruenden.

### Was du lieferst

Unter `docs/pseudocode/` (Markdown, lesbarer Pseudocode, kein Broker-Call):

| Datei | Inhalt | Du entscheidest |
|---|---|---|
| `00-types.md` | `DataApproval`, Overlay-Verdict, Event-Zusatzfelder, Scorecard-Row | Namen-Aliase, optionale Felder |
| `01-data-approved.md` | `approveSymbol(snapshot) -> approval` fuer die D-Checks | Extra-Checks, Schwellen |
| `02-risk-overlay.md` | `applyOverlay(ctx) -> verdict`, R-Gates, nur verengen | Extra-Gates, Mapping auf M8 |
| `03-screener.md` | `propose(...)` ein Sieger oder Hold | Score-Formel, Hysterese |
| `04-learn-from-journal.md` | parse + upsert, idempotent, `LEARN_APPLY` default false | EWMA-Details analog Alpha-IC |
| `05-wiring-map.md` | 8–15 konkrete Einhängepunkte in *vorhandenem* `main`-Code | welche Datei zuerst |

Plus `tests/fixtures/risk-overlay/` — klein (<30 Events), keine echten Logs:
mindestens stale-tick, synthetic-lake, daily-loss, live-gate, zwei Module
in einem Regime, **dasselbe Modul auf zwei Symbolen**.

Optionale Stubs `server/dataApproval.ts`, `server/riskOverlay.ts`,
`server/playbookScreener.ts`: Signatur + `throw new Error("not wired")`.
Kein `addOrder`, kein Private-REST.

Tests gegen Fixtures, Windows-tauglich (`python` / `tsx`, kein
`python3 -c` mit bash-Quotes).

PR oder Feature-Branch ist gut. `main` nicht forcen. `.env` / `data/` / Keys
nicht anfassen. Peters uncommittete lokale Lake/WS/Logs-UI nicht nachbauen.

### Leseliste zuerst (auf GitHub `main`)

1. Dieser Plan, §0 und §3–5 (Zielbild, nicht als Korsett).  
2. `docs/ORCHESTRATOR-ALPHA-SIGMA.md` — Gewaltenteilung, IC, Sigma-Reihenfolge.  
3. `docs/SIGMA-QUANT-BRIDGE.md` — was schon geerntet ist.  
4. `app/execution/m8_judge.py`, `kelly_sizing.py` — echte Gates.  
5. `app/orchestrator/alpha_sigma_engine.py` — Antrag vs. Verfuegung.  
6. `server/eventLog.ts` — `ExecutionEvent`, `scrubMetadata`; Felder nur additiv.  
7. NIO / Alpha-Repos unter Finnlayy, soweit sichtbar: Judge-Barrieren und
   StrategyInterpreter/archetypes als Inspiration, nicht 1:1-Port.

`GET /api/logs*` und `addLog` in `server.ts` laesst du in Ruhe. Peter haengt.

### Definition of done

Peter oeffnet `05-wiring-map.md` + die vier Pseudocode-Dateien + Fixtures
und ersetzt nur noch Snapshot-Quellen: Tick, Lake-Query, JSONL-Tail.
Wenn er Design-Entscheidungen nachholen muss, war die Lieferung zu duenn.
Wenn er deinen Code nur abtippt ohne zu verstehen, war sie zu starr —
also: begruendete Wahl, nicht 200 hart codierte Magiezahlen.

---

## 0. Invarianten (nicht verhandelbar)

1. **AI ↛ Live-Order.** LLM, Grok Bot, Swarm, Academy: nur propose / veto /
   journal / size-hint. Dispatch nur durch deterministische Engines.
2. **Judge first.** Kein Confidence-, Academy- oder Orchestrator-Bypass.
   Siehe Skill `judge-ai-no-live-orders`.
3. **Paper-first.** Default `KRAKEN_PAPER_TRADING=true`,
   `AI_LIVE_ORDERS=false`, `ORS_ALLOW_LIVE_DISPATCH=0`. Live nur mit
   explizitem Env-Gate plus menschlicher Promote-Checkliste.
4. **Module symbol-agnostisch.** Symbol ist Instanzparameter, nie im
   Playbook verdrahtet. DCA / Reverse-DCA sind Beispiele, nicht die Bibliothek.
   Siehe Skills `generic-module-vs-symbol-instance`, `dca-reverse-dca-mode-switch`.
5. **Eine Schicht darf nur verengen.** Data, Regime, Setup, Size, Execution:
   jede darf Size auf 0 setzen oder den Zyklus killen. Keine lockert ein
   Gate der Schicht darunter.
6. **Fail-closed.** Fehlende, stale oder unvollständige Inputs = kein Approve,
   kein neuer Entry. Bestehende Paper-Positionen dürfen nur verkleinert oder
   geschlossen werden, nie vergrößert.
7. **Secrets bleiben lokal.** Keine Keys, Tokens, Cookies ins Journal,
   ins Memory oder in Prompts.

Diese Regeln sind die Sigma-Kammer aus `docs/ORCHESTRATOR-ALPHA-SIGMA.md`
als Overlay über *alle* Spuren, nicht nur vor `AddOrder`.

---

## 1. Ist-Zustand (2026-09-12, lokal gemessen)

| Spur | Was existiert | Lücke |
|---|---|---|
| Market Data | Kraken WS-Ticker (`server/krakenCliStream.ts`), REST-Fallback >20s, Lake 1m additiv (`app/data_layer/ohlc_backfill.py`) | Public OHLC 1m ≈ letzte 720 Bars (~12h). Kein Data-Approved. ETH-Lake noch Synthetik. Alte kaputte Parquets in `data/lake/_quarantine_bad_parquet`. |
| Regime | Sigma-Hooks (Hurst/DFA, Quant-Bridge), Glint/Polymarket als **Doktrin** | Layer-0 nicht im Runner-Pfad verdrahtet. |
| Entry / Playbook | Manifest-Strategien, MACD/RSI/Grid, offene Modul-Absicht | Keine Specialist-Routing-Matrix, kein `module_id` im Signal. |
| Risk | Paper-Gates, Hard-Stop-%, Alpha/Sigma-Zweikammer, M8-Skizze | Judge sitzt vor dem Order, nicht als Overlay auf Data/Regime/Setup. |
| Execution | Paper-Queue L2, Live L4 hinter Env, Event-Log | Paper-Pfad muss dauerhaftes Journal bleiben (nicht nur UI-Sim). |
| Memory | `data/paper/execution_logs.jsonl` (~51k Zeilen), UI-Tab System Logs, CSV-Export | Kein Playbook-Scorecard, kein Feedback in den Screener. |
| Lernen | Jules/Night-Train Harvest, Academy-Drills | Kein geschlossener Kreis Journal → Gewicht → nächster Vorschlag. |

Ereignisschema (schon da, `server/eventLog.ts`):

```
id, timestamp, level, kind, message, strategyId?, symbol?, executionMode?, metadata?
kind ∈ { log, trade, evaluate, night_train, system, orchestrator, error }
```

Trade-Fills tragen in `metadata` u. a. `side`, `amount`, `price`, `pnl`,
`pair`, `status`. Das ist der Rohstoff der Schleife — nicht neu erfinden.

---

## 2. Zielbild

```
  ticks / lake / stream
           │
           ▼
   ┌───────────────────┐
   │  DATA APPROVED?   │  fail-closed  ──► kein neuer Entry, nur Reduce
   └─────────┬─────────┘
             ▼
   ┌───────────────────┐
   │  REGIME / LAYER-0 │  (Glint später, Telemetrie bis Policy)
   └─────────┬─────────┘
             ▼
   ┌───────────────────┐     Memory (Scorecard)
   │  SCREENER         │◄──── playbook weights per (regime, module)
   │  schlägt module_id│
   └─────────┬─────────┘
             ▼
   ┌───────────────────┐
   │  RISK OVERLAY     │  Size nur verkleinern / 0
   │  + Judge M-Gates  │
   └─────────┬─────────┘
             ▼
   ┌───────────────────┐
   │  PAPER ENGINE     │  durable fill + journal
   └─────────┬─────────┘
             ▼
        execution_logs.jsonl
             │
             ▼
   nightly / on-close attribution
             │
             ▼
        Memory upsert  ──► nächster Screener-Zyklus
```

LLM darf in diesem Bild **nur** den Screener-Kommentar und das Journal-Digest
schreiben. `module_id`, Size, Verdict kommen aus Code.

---

## 3. Teil A — Data-Approved-Flag

### 3.1 Bedeutung

`data_approved: boolean` ist das erste Gate jedes Zyklus. Ohne `true`
darf der Screener keinen neuen Entry vorschlagen. Reduce/Close bei
offener Paper-Position bleibt erlaubt.

Das Flag ist **pro Symbol + Zeitstempel**, nicht global. BTC kann approved
sein, während SOL stale ist.

### 3.2 Checks (alle müssen passen, sonst `false`)

| ID | Check | Schwelle (Startwerte, kalibrierbar) | Fail-Code |
|---|---|---|---|
| D1 | Stream-Tick vorhanden | letztes Bid/Ask oder Last ≤ 20s (gleicher Wert wie REST-Fallback) | `DATA_STALE_TICK` |
| D2 | Tick monoton / kein Drift-Fake | kein synthetisches Micro-Drift; letzter Preis stammt aus WS oder REST | `DATA_SYNTHETIC_TICK` |
| D3 | Lake-Basis 1m lesbar | DuckDB `query_range` liefert ≥ 1 Row, Schema ok | `DATA_LAKE_UNREADABLE` |
| D4 | Lake-Frische | `max(open_time)` ≤ 3 Minuten hinter Now (1m-Basis) | `DATA_LAKE_STALE` |
| D5 | Lake-Dichte im Fenster | im letzten verfügbaren Fenster (max 12h Public-OHLC bzw. cached span) ≥ 95 % der 1m-Slots | `DATA_LAKE_SPARSE` |
| D6 | Kein Synthetik-als-Real | Partition ohne `broker=kraken` oder GBM-Seed → `approved=false` für Live/Paper-Entry | `DATA_SYNTHETIC_LAKE` |
| D7 | Symbol handelbar | Paar in Kraken-AssetPairs, Status online | `DATA_SYMBOL_HALTED` |
| D8 | Uhr | Server-UTC vs Exchange-Zeit Δ < 2s; alle Vergleiche nach UTC-Normierung | `DATA_CLOCK_SKEW` |

Public-Kraken-OHLC 1m endet nach ~720 Kerzen. D5 bewertet **das, was wir
haben**, nicht ein erfundenes 90-Tage-Fenster. 90 Tage bleibt Ziel-Intent
des Lakes (additiv, pollend), nicht Zulassungsvoraussetzung für einen Tick.

### 3.3 Payload

Neues Typed Object, z. B. `server/dataApproval.ts`:

```ts
type DataApproval = {
  symbol: string;
  approved: boolean;
  asOf: string;          // ISO UTC
  codes: string[];       // leer wenn approved
  tickAgeMs: number | null;
  lake: {
    first: string | null;
    last: string | null;
    effectiveRows: number;
    density: number;     // 0..1 im bewerteten Fenster
    broker: "kraken" | "synthetic" | "unknown";
  };
};
```

- `GET /api/data-approval?symbol=BTC/USD` für UI (Lake-Panel + System Logs).
- Jeder Orchestrator-/Runner-Zyklus ruft `approveSymbol(symbol)` **bevor**
  Setup oder Size laufen.
- Event: `addLog('info'|'warn', …, { kind: 'system', metadata: { dataApproval } })`.

### 3.4 UI

- Data-Lake-Panel: Badge `APPROVED` / `BLOCKED` plus Codes neben Cached-Span.
- System-Logs: Filter `kind=system` + Code-Chips.
- Overview: ein Punkt pro aktivem Symbol (grün/rot), kein Extra-Agent.

### 3.5 Akzeptanz A

1. Unit: stale Tick → `approved=false`, Code `DATA_STALE_TICK`.
2. Unit: ETH-Synthetik-Partition → `DATA_SYNTHETIC_LAKE`.
3. Integration: `approved=false` ⇒ Paper-Engine nimmt keine neue BUY/SELL-Open,
   Reduce bleibt möglich.
4. Query bleibt nach DuckDB 1.5 auf `fetch_arrow_table()`, TimeZone UTC.
5. Kein `python3 -c` auf Windows in neuem Code (`runPythonScript`).

---

## 4. Teil B — Risk-Overlay (alle Schichten)

### 4.1 Idee

Judge bleibt die letzte Tür. Das Overlay hängt **dieselbe Logik** an jede
Schicht davor, damit ein toter Tick oder ein Regime-Flip nie erst in der
Order-Queue stirbt.

Schichten, fest, nur verengend:

| Schicht | Input | Overlay darf | Darf nicht |
|---|---|---|---|
| 0 Data | `DataApproval` | Zyklus killen | Daten „schönrechnen“ |
| 1 Regime | Sigma-Regime + (später) Glint-Bias | Entry-Seite sperren, Flatten vorschlagen | Size erhöhen |
| 2 Setup | Screener-`module_id` + Thesis | Modul verwerfen / Hold | Anderes Modul erzwingen ohne Scorecard |
| 3 Size | Kelly/Vol-Target/Caps | Size * ≤1, Floor 0 | Size > Antrag |
| 4 Exec | Paper/Live-Flags | Dispatch verweigern | Flags umlegen |
| 5 Learn | Journal | Gewichte in `[floor, ceil]` | Gates lockern |

Konfliktregel bleibt: **Sigma gewinnt**. Confidence 1.0 ändert nichts.

### 4.2 Gate-Satz (Start, an M8 / Sigma-Kammer andocken)

Bestehende Bausteine wiederverwenden, nicht parallel erfinden:
`app/.../m8_judge.py`, `kelly_sizing.py`, Hard-Stop im Manifest,
`docs/ORCHESTRATOR-ALPHA-SIGMA.md` Reihenfolge.

| Gate | Schicht | Regel (Start) | Code |
|---|---|---|---|
| R0 | 0 | `data_approved === true` sonst kein Open | `RISK_DATA` |
| R1 | 1 | Regime erlaubt das vorgeschlagene Modul (Matrix wie `REGIME_SOURCE_MATRIX`) | `RISK_REGIME` |
| R2 | 1 | Regime-Flip gegen offene Seite → nur Flatten/Hold | `RISK_REGIME_FLIP` |
| R3 | 2 | Ein Vorschlag pro Zyklus, Cooldown/Hysterese aus Manifest | `RISK_COOLDOWN` |
| R4 | 3 | Notional ≤ Caps (bestehende Hebelkappen, Cash, Min-Lot Kraken) | `RISK_CAP` |
| R5 | 3 | Daily realized + unrealized Paper-PnL ≤ −X% Baseline → Breaker, nur Close | `RISK_DAILY_LOSS` |
| R6 | 3 | Per-Symbol Exposure + Korrelations-Cluster (BTC-Beta grob) | `RISK_EXPOSURE` |
| R7 | 4 | Spread/Tick-Qualität; wenn kein Book, fail-closed auf Last+Flag | `RISK_SPREAD` |
| R8 | 4 | `executionMode=live` nur mit Env+Human; AI nie | `RISK_LIVE_GATE` |

X für R5: Start **−3%** der Paper-Baseline (`initialPaperBalanceUSD`),
kalibrierbar in `.env` `RISK_DAILY_LOSS_PCT=3`, nie im Prompt.

### 4.3 Verdict-Objekt

```ts
type OverlayVerdict = {
  symbol: string;
  moduleId: string | null;
  side: "buy" | "sell" | "flat";
  sizeIn: number;
  sizeOut: number;          // ≤ sizeIn
  allowOpen: boolean;
  allowReduce: boolean;
  gates: { id: string; pass: boolean; note?: string }[];
  dataApproval: DataApproval;
};
```

`sizeOut === 0` oder `allowOpen === false` ist ein gültiges, häufiges Ergebnis.
Journal immer, auch bei Veto (`kind: 'evaluate'`).

### 4.4 Glint / Polymarket (Reihenfolge)

**Nicht** in Phase 1 verdrahten. Phase 1 Overlay muss ohne Layer-0 korrekt
fail-closed sein. Phase 3: Glint nur als Regime-Bias / Telemetrie,
Gate 0.60, kein Order, Skill `glint-polymarket-preemptive`.

### 4.5 Akzeptanz B

1. Fixture: `data_approved=false` → `allowOpen=false`, `sizeOut=0`.
2. Fixture: Daily-Loss unter Schwelle → Breaker, bestehende Position closable.
3. Fixture: Live-Flag an, aber `AI_LIVE_ORDERS=false` → `RISK_LIVE_GATE`.
4. Kein Test, in dem Confidence ein Gate lockert.
5. Dieselben Fixtures für ≥2 Symbole (Modul bleibt generisch).

---

## 5. Teil C — Geschlossene Lernschleife

### 5.1 Zielsatz

Aus dem bestehenden Journal wird ein **Playbook-Scorecard**. Der Screener
liest sie und schlägt *ein* `module_id` (oder Hold) vor. Prompt und Graph
sind optionaler Kommentar, nie die Quelle der Gewichte.

```
execution_logs.jsonl
        │  parse fills + evaluate + veto
        ▼
attribution job  (nightly + on-bar-close)
        │  (regime_at_entry, module_id, symbol, horizon, pnl, veto-rate)
        ▼
data/memory/playbook_scorecard.json
        │  weights in [0.35, 1.6] analog Alpha-IC
        ▼
screener.propose(symbol, regime) → module_id
        │
        ▼
Risk-Overlay + Judge → Paper → neues Journal
```

Das ist dieselbe Idee wie der Information-Coefficient in der Alpha-Kammer
(`docs/ORCHESTRATOR-ALPHA-SIGMA.md` §2), aber auf **Modul** statt auf
Grok-Quelle.

### 5.2 Was aus 51k Logs schon geht — und was noch fehlt

Heute parsen:

- `kind=trade` + `metadata.pnl` → Outcome.
- `symbol` / `pair`, `executionMode`, `strategyId`.
- Zeitstempel → Bar/Regime nachziehen (Lake 1m, soweit approved).

Heute **nicht** im Event (muss additiv ins Schema, alte Zeilen bleiben gültig):

| Feld | Wozu | Default für Altbestand |
|---|---|---|
| `module_id` | welches Playbook | `strategyId` als grober Proxy, Flag `proxy=true` |
| `regime_at_entry` | Schicht 1 | retro aus Hurst/DFA am Timestamp, sonst `unknown` |
| `data_approved` | Schicht 0 | `null` |
| `overlay_codes` | welche Gates griffen | `[]` |
| `horizon_bars` | IC-Fenster | Manifest-Interval |
| `proposal_source` | `screener` / `human` / `genetic` / `hold` | `unknown` |

Keine Secrets in `metadata` (`eventLog.scrubMetadata` bleibt Pflicht).

### 5.3 Memory — bewusst kein Graph

Datei (gitignored, wie andere Runtime-Artefakte):

`data/memory/playbook_scorecard.json`

```json
{
  "asOf": "2026-09-12T00:00:00Z",
  "minSamples": 30,
  "rows": [
    {
      "moduleId": "mean_reversion_rsi",
      "regime": "range",
      "n": 48,
      "icEwma": 0.11,
      "weight": 1.18,
      "vetoRate": 0.22,
      "expectancyPaper": 4.2,
      "proxyShare": 0.4
    }
  ]
}
```

Schlüssel ist `(moduleId, regime)` — **nicht** `(moduleId, symbol)`.
Symbol bleibt Instanz. Ein zweiter Slice `(moduleId, regime, symbol)` darf
nur als Telemetrie existieren, nie als hart verdrahtetes BTC-Modul.

Gewicht: EWMA analog Alpha-Kammer, λ = 0.90, Clamp `[0.35, 1.6]`.
Unter `minSamples` oder `regime=unknown`: neutrales Gewicht 1.0, Screener
darf das Modul vorschlagen, Overlay bleibt hart.

### 5.4 Screener-Regel

Pro Symbol, pro Zyklus:

1. `DataApproval.approved` sonst Hold.
2. Regime bestimmen (Sigma jetzt, Glint später nur Bias).
3. Kandidaten = offene Modulbibliothek (Scout, Pyramid, Cluster-Exit,
   Momentum, MR, Microstructure, Vol-Arb, Grid, DCA, Reverse-DCA, Futures, …)
   — Inventar aus Sigma/Neo/Swarm-Code, keine Zwei-Item-Liste.
4. Score = Physik-Score × Scorecard-`weight` × (1 − vetoRate-Strafe).
5. Ein Sieger + Hysterese/Cooldown. Alternativen ins Journal
   (`kind: 'evaluate'`, `proposal_source: 'screener'`).
6. Overlay + Judge. LLM schreibt höchstens die Thesis-Zeile.

### 5.5 Attribution-Job

`scripts/learn_from_journal.py` (Windows: `python`, kein `python3 -c`):

1. Tail/Full-Scan JSONL, idempotent über Event-`id`.
2. Join Fill → Entry-Proposal (gleiche `strategyId` + Zeitfenster).
3. Horizon-Return aus Lake 1m wenn `data_approved` damals/jetzt, sonst Skip
   (nicht mit Synthetik füllen).
4. Upsert Scorecard atomar (temp + rename).
5. Log `kind: 'night_train'`, `dry_run` Default true bis ein Flag gekippt wird.

Läuft zuerst **dry-run** (Report only), dann `LEARN_APPLY=1` schreibt Memory.
Night-Train-Harvest bleibt der Cron-Haken, nicht der Lehrer.

### 5.6 Prompt-Agent / Graph — Rolle

| Vehikel | Darf | Darf nicht |
|---|---|---|
| Prompt / Grok | Thesis, Digest, „warum Hold“ | `module_id` oder Size setzen |
| Academy / Jules | Drills auf Paper, A/B der *Kommentar*-Prompts | Gates umgehen |
| Knowledge-Graph | später: Lesson-Kanten an Scorecard-Rows | SoT für Gewichte |

Wenn jemand „wir brauchen einen Prompt-Agenten“ sagt: der Agent *liest*
die Scorecard und erklärt sie. Er *schreibt* sie nicht.

### 5.7 Akzeptanz C

1. Parser: ≥1 k echte `trade`-Events aus der aktuellen JSONL → Rows ohne Crash,
   Secrets bleiben gescubbt.
2. Scorecard-Update ist idempotent (zweiter Lauf, gleiche IDs, gleiche Weights).
3. Screener-Fixture: zwei Module, ein Regime, Gewicht 1.6 vs 0.35 → Sieger
   ist das schwere, außer Overlay vetoed.
4. Proxy-Anteil (`strategyId` statt `module_id`) ist im Report sichtbar;
   sobald `module_id` geschrieben wird, sinkt `proxyShare`.
5. `LEARN_APPLY` aus → keine Datei geschrieben, nur Report.
6. Tests auf mindestens zwei Symbolen, ein Modul.

---

## 6. Bau-Reihenfolge

Nicht parallel die Schleife *und* Glint *und* 90d-Lake. Eine Kante nach der anderen.

### Phase 0 — Vertrag (kurz)

- Types: `DataApproval`, `OverlayVerdict`, optionale Event-Felder.
- `docs/openapi.yaml` nachziehen (`npm run openapi`), sobald Routen stehen.
- Gitignore: `data/memory/` analog Paper/Lake.

### Phase 1 — Data-Approved + Overlay-R0/R5/R8  ← **zuerst bauen**

Warum zuerst: ohne das lügt die Schleife (lernt an stale/synthetischen Bars)
und das Overlay hat keine Zähne.

Deliverables:

- `server/dataApproval.ts` + `GET /api/data-approval`
- Overlay-Stub in `server.ts` / Orchestrator-Zyklus vor jedem Open
- Lake-Badge, Log-Events
- Tests A1–A4, B1, B3, B5

### Phase 2 — Journal-Felder + Scorecard dry-run

- `module_id` / `regime_at_entry` / `overlay_codes` schreibend
- `scripts/learn_from_journal.py` dry-run gegen die 51k Zeilen
- Report: n, proxyShare, grobe IC-Schätzung, Datenlücken
- Noch **kein** Screener-Switch

### Phase 3 — Screener liest Memory

- `propose(symbol)` wie §5.4
- Overlay R1–R4, R6–R7
- Hysterese, ein Vorschlag, Journal der Alternativen
- `LEARN_APPLY=1` nur hinter Paper und nach Review des Phase-2-Reports

### Phase 4 — Layer-0 Telemetrie (separater Go)

- Glint/Polymarket fail-closed, Gate 0.60, kein Order
- Regime-Bias in Scorecard-Key nur als zusätzliches Feature, nicht als Pflicht

### Phase 5 — Lake-Tiefe (separater Go)

- 1m-Historie wächst durch Poll (12h-Decke) oder Import echter Harvests
- Synthetik-ETH markieren oder ersetzen
- D5-Fenster darf wachsen, Schwelle 95 % bleibt

---

## 7. Datei-Landkarte (vorgeschlagen)

| Pfad | Rolle |
|---|---|
| `server/dataApproval.ts` | D1–D8 |
| `server/riskOverlay.ts` | R0–R8, nur verengen |
| `server/playbookScreener.ts` | `propose()` |
| `scripts/learn_from_journal.py` | Attribution |
| `data/memory/playbook_scorecard.json` | Runtime, gitignore |
| `src/components/DataLakePanel.tsx` | Approved-Badge |
| `src/components/SystemLogsPanel.tsx` | Codes / kind-Filter |
| `docs/openapi.yaml` | Regen nach Phase 1 |
| dieser File | Vertrag |

Keine neuen Top-Level-Agenten im Header. Kein zweites Journal.

---

## 8. Explizit out of scope

- Live-Dispatch durch LLM oder „nur diesmal“.
- Modul-Forks `BtcDcaEngine` / `SolDcaEngine`.
- 90-Tage-1m aus Public-OHLC erzwingen (API kann das nicht).
- Redis/Qdrant/Postgres als SoT (Lake bleibt Parquet+DuckDB).
- Company-Knowledge-Graph, ONNX-Runtime, MT5 als primärer SoT.
- Prompt-Optimierer, der Gates oder Weights schreibt.

---

## 9. Done wenn

Paper-Pfad, ein Symbol approved, eines blocked:

- das blocked Symbol erzeugt **null** neue Opens,
- das approved Symbol geht durch Overlay mit sichtbarem `gates[]`,
- ein Close/Fill landet im JSONL mit `module_id`,
- der dry-run-Job erzeugt eine Scorecard,
- der nächste Screener-Zyklus (Phase 3) ändert den Vorschlag nachweisbar
  gegenüber Gewicht 1.0 — und der Judge kann ihn immer noch töten.

Dann erst über Phase 4 (Glint) reden.
