# Plan: Risk-Overlay + Data-Approved-Flag + geschlossene Lernschleife

Stand: 2026-09-12  
Repo: `Finnlayy/Strategie-Runner` (`main`)  
Owner: Finn / Peter  
Status: **Plan + Auftrag an den GitHub-Agenten.**  
Peter verdrahtet spaeter nur noch gegen echte lokale Daten.

---

## Auftrag an den GitHub-Agenten (kein Lokalzugriff)

Du liest nur dieses Repo auf GitHub. Du hast **kein** `data/paper`, kein Lake,
kein `.env`, keine Keys. Das ist Absicht.

**Deine Lieferung ist Pseudocode plus Typen plus Fixtures**, damit Peter
(lokaler Ops-Agent) nur noch drei echte Quellen einhaengen muss:
Kraken-WS-Tick, Lake-`query_range`, `execution_logs.jsonl`.

### Sollst du tun

1. Lege unter `docs/pseudocode/` ab (Markdown, kein ausfuehrbarer Broker-Code):
   - `00-types.md` — `DataApproval`, `OverlayVerdict`, Event-Zusatzfelder,
     Scorecard-Row. Exakte Feldnamen aus diesem Plan.
   - `01-data-approved.md` — Funktion `approveSymbol(input) -> DataApproval`.
     D1–D8 als pure Funktionen. Inputs sind **injizierte Snapshots**, nicht
     `fs.read` auf `data/lake`.
   - `02-risk-overlay.md` — `applyOverlay(ctx) -> OverlayVerdict`. R0–R8,
     nur verengen, Reihenfolge fest. Kein Live-Dispatch.
   - `03-screener.md` — `propose(symbol, regime, catalog, scorecard) -> module_id | hold`.
     Ein Sieger, Hysterese-Kommentar, Alternativen-Liste.
   - `04-learn-from-journal.md` — `parseEvents(lines) -> rows`, `upsertScorecard`.
     Idempotent ueber Event-`id`. `LEARN_APPLY` Default false.
   - `05-wiring-map.md` — Tabelle: welche 8–12 Zeilen Peter in `server.ts` /
     Lake-Panel / SystemLogs haengt (Funktionsname, Datei, davor/danach).
2. Lege unter `tests/fixtures/risk-overlay/` **kleine** JSON-Fixtures ab
   (keine echten Logs): je ein stale-tick, synthetic-lake, daily-loss,
   live-gate-block, zwei-Module-Scorecard, zwei Symbole gleiches Modul.
3. Optional: leere Stubs `server/dataApproval.ts`, `server/riskOverlay.ts`,
   `server/playbookScreener.ts` die die Signaturen exportieren und
   `throw new Error("not wired")` — kein `addOrder`, kein Kraken-Private.
4. Tests gegen die Fixtures, Windows-tauglich (`python` / `tsx`, kein
   `python3 -c` mit bash-Quotes).
5. PR oder Commit auf einem Feature-Branch ist ok; **kein** Force auf `main`,
   **kein** Anfassen von `.env`, `data/`, Keys, Live-Flags.

### Sollst du nicht tun

- `data/paper/execution_logs.jsonl` oder Lake-Parquet voraussetzen oder erfinden.
- 51k Zeilen simulieren. Fixtures bleiben < 30 Events.
- Live-Order, CancelAll, Private-REST, MCP `--allow-dangerous`.
- Modul-Forks `BtcDcaEngine`. DCA/Reverse-DCA nur als Beispiele im Catalog.
- Prompt-Agent, der Weights oder Size schreibt.
- Secrets, Tokens, Account-IDs in Fixtures.
- Die lokalen uncommitteten Lake/UI-Aenderungen von Peter nachbauen
  (WS-Stream, System-Logs-Tab, Backfill) — die verdrahtet Peter.

### Definition of done fuer dich

Peter kann ohne dich oeffnen:

- `docs/pseudocode/05-wiring-map.md`
- die vier Pseudocode-Dateien
- die Fixtures

und in einem kurzen lokalen Pass ersetzen: Snapshot-Input → echte
`approveSymbol()`-Adapter. Wenn er mehr als Adapter schreiben muss,
war der Pseudocode zu duenn.

### Hinweise zum Ist-Code auf GitHub `main`

- Journal-Schema: `server/eventLog.ts` (`appendEvent`, `loadRecentEvents`,
  `kind`, `scrubMetadata`). Zusatzfelder nur additiv.
- Alpha/Sigma-Gewaltenteilung: `docs/ORCHESTRATOR-ALPHA-SIGMA.md`.
- Event-API: `GET /api/logs`, `/api/logs/stats`, `/api/logs/export`.
- Paper-Gates und `addLog` leben in `server.ts` — du verdrahtest sie nicht.
- `execution_logs.jsonl` ist gitignored. Deine Parser-Tests nutzen nur Fixtures.

---


Dieser Plan beschreibt die zwei Bausteine, die zwischen dem laufenden Runner
und der 8-Spur-Fabrik aus dem Cockpit-Diagramm wirklich fehlen:

1. **Risk-Overlay auf allen Schichten** plus hartes **Data-Approved-Flag**.
2. **Geschlossene Lernschleife** Journal → Memory → Playbook-Vorschlag.
   Prompt-Agent und Knowledge-Graph sind Vehikel, nicht das Ziel.

Nicht in diesem Plan: acht neue Agenten-Namen, Company-Knowledge-Graph,
ONNX/Transformer, TradingView, Live-Autonomie.

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
