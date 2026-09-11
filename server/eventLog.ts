/**
 * Durable execution event log (append-only JSONL) + CSV export.
 * Runtime artefact — path is gitignored. Never write secrets here.
 */
import fs from "fs";
import path from "path";

export type EventLevel = "info" | "warn" | "error" | "trade";
export type EventKind =
  | "log"
  | "trade"
  | "evaluate"
  | "night_train"
  | "system"
  | "orchestrator"
  | "error";

export interface ExecutionEvent {
  id: string;
  timestamp: string;
  level: EventLevel;
  kind: EventKind;
  message: string;
  strategyId?: string;
  symbol?: string;
  executionMode?: "paper" | "live";
  metadata?: Record<string, unknown>;
}

const SECRET_KEY = /key|secret|token|password|authorization|cookie|credential/i;

export const EVENT_LOG_DIR = path.join(process.cwd(), "data", "paper");
export const EVENT_LOG_FILE = path.join(EVENT_LOG_DIR, "execution_logs.jsonl");
export const EVENT_EXPORT_DIR = path.join(EVENT_LOG_DIR, "exports");

function ensureDirs(): void {
  fs.mkdirSync(EVENT_LOG_DIR, { recursive: true });
  fs.mkdirSync(EVENT_EXPORT_DIR, { recursive: true });
}

export function scrubMetadata(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) continue;
    if (typeof v === "string" && v.length > 4000) out[k] = v.slice(0, 4000) + "\u2026";
    else out[k] = v;
  }
  return out;
}

export function appendEvent(partial: Omit<ExecutionEvent, "id" | "timestamp"> & Partial<Pick<ExecutionEvent, "id" | "timestamp">>): ExecutionEvent {
  ensureDirs();
  const evt: ExecutionEvent = {
    id: partial.id || `evt-${Date.now()}-${crypto.randomUUID()}`,
    timestamp: partial.timestamp || new Date().toISOString(),
    level: partial.level,
    kind: partial.kind || (partial.level === "trade" ? "trade" : partial.level === "error" ? "error" : "log"),
    message: String(partial.message || "").slice(0, 8000),
    strategyId: partial.strategyId,
    symbol: partial.symbol,
    executionMode: partial.executionMode,
    metadata: scrubMetadata(partial.metadata),
  };
  fs.appendFileSync(EVENT_LOG_FILE, JSON.stringify(evt) + "\n", "utf8");
  return evt;
}

export function loadRecentEvents(limit = 250): ExecutionEvent[] {
  if (!fs.existsSync(EVENT_LOG_FILE)) return [];
  const raw = fs.readFileSync(EVENT_LOG_FILE, "utf8");
  const rows: ExecutionEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as ExecutionEvent);
    } catch {
      /* skip corrupt line */
    }
  }
  return rows.slice(-Math.max(0, limit));
}

export function loadAllEvents(max = 100_000): ExecutionEvent[] {
  return loadRecentEvents(max);
}

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function eventsToCsv(events: ExecutionEvent[]): string {
  const headers = [
    "id",
    "timestamp",
    "level",
    "kind",
    "message",
    "strategyId",
    "symbol",
    "executionMode",
    "metadata",
  ];
  const lines = [headers.join(",")];
  for (const e of events) {
    lines.push(
      [
        csvEscape(e.id),
        csvEscape(e.timestamp),
        csvEscape(e.level),
        csvEscape(e.kind),
        csvEscape(e.message),
        csvEscape(e.strategyId),
        csvEscape(e.symbol),
        csvEscape(e.executionMode),
        csvEscape(e.metadata ? JSON.stringify(e.metadata) : ""),
      ].join(","),
    );
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function exportEventsCsv(limit = 100_000): { csv: string; file: string; count: number } {
  ensureDirs();
  const events = loadAllEvents(limit);
  const csv = eventsToCsv(events);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(EVENT_EXPORT_DIR, `execution_logs_${stamp}.csv`);
  fs.writeFileSync(file, csv, "utf8");
  return { csv, file, count: events.length };
}

export function eventLogStats(): { file: string; exists: boolean; bytes: number; approxLines: number } {
  const exists = fs.existsSync(EVENT_LOG_FILE);
  if (!exists) return { file: EVENT_LOG_FILE, exists: false, bytes: 0, approxLines: 0 };
  const st = fs.statSync(EVENT_LOG_FILE);
  const raw = fs.readFileSync(EVENT_LOG_FILE, "utf8");
  const approxLines = raw ? raw.split(/\r?\n/).filter((l) => l.trim()).length : 0;
  return { file: EVENT_LOG_FILE, exists: true, bytes: st.size, approxLines };
}
