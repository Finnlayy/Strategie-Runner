import { exec } from "child_process";
import path from "path";

/**
 * Executes python3 commands against the app.data_layer facade and returns typed JSON.
 */
function runPythonCommand(cmd: string): Promise<any> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: process.cwd(), maxBuffer: 15 * 1024 * 1024, timeout: 8000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[Python DataLayer Error] ${error.message}\nStderr: ${stderr}`);
        return reject(new Error(stderr || error.message));
      }
      try {
        // Find JSON block in stdout
        const trimmed = stdout.trim();
        const firstBrace = trimmed.indexOf("{");
        const firstBracket = trimmed.indexOf("[");
        let startIdx = 0;
        if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
          startIdx = firstBrace;
        } else if (firstBracket !== -1) {
          startIdx = firstBracket;
        }
        
        const jsonStr = trimmed.substring(startIdx);
        const parsed = JSON.parse(jsonStr);
        resolve(parsed);
      } catch (err: any) {
        console.warn(`[Python DataLayer] JSON parse notice, returning raw stdout: ${stdout.substring(0, 200)}`);
        resolve({ raw: stdout });
      }
    });
  });
}

const SERIALIZER_HELPER = `
from decimal import Decimal
from datetime import datetime

def _json_serial(obj):
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    return str(obj)
`;

export async function getLakeSummary(): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.data_layer.facade import market_data
print(json.dumps(market_data.get_lake_summary(), default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function seedLakeData(symbol: string = "BTC/USD", days: number = 7, intervalMin: number = 1): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.cli import generate_synthetic_ohlcv
from app.data_layer.facade import market_data

candles = generate_synthetic_ohlcv(symbol="${symbol}", days=${days}, interval_min=${intervalMin})
written = market_data.ingest_candles(candles, symbol="${symbol}", timeframe="${intervalMin}m")
print(json.dumps({
  "success": True,
  "symbol": "${symbol}",
  "candles_count": len(candles),
  "files_written": [str(p) for p in written]
}, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function queryLakeRange(symbol: string = "BTC/USD", limit: number = 100): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.data_layer.facade import market_data

df = market_data.get_candles(symbol="${symbol}")
rows = df.tail(${limit}).to_dicts()
for r in rows:
    if "timestamp" in r and hasattr(r["timestamp"], "isoformat"):
        r["timestamp"] = r["timestamp"].isoformat()
print(json.dumps({
  "symbol": "${symbol}",
  "total_records": len(df),
  "returned_records": len(rows),
  "records": rows
}, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function resampleLakeData(symbol: string = "BTC/USD", interval: string = "1 hour", limit: number = 100): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.data_layer.facade import market_data

df = market_data.resample(symbol="${symbol}", target_interval="${interval}")
rows = df.tail(${limit}).to_dicts()
for r in rows:
    if "timestamp" in r and hasattr(r["timestamp"], "isoformat"):
        r["timestamp"] = r["timestamp"].isoformat()
print(json.dumps({
  "symbol": "${symbol}",
  "interval": "${interval}",
  "total_bars": len(df),
  "records": rows
}, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function runLakeCompaction(symbol?: string): Promise<any> {
  const symArg = symbol ? `"${symbol}"` : "None";
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.data_layer.facade import market_data
res = market_data.compact(symbol=${symArg})
print(json.dumps(res, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function runDriveSync(symbol?: string): Promise<any> {
  const symArg = symbol ? `"${symbol}"` : "None";
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.data_layer.facade import market_data
res = market_data.sync_to_cloud(symbol=${symArg})
print(json.dumps(res, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}
