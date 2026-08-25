import { exec } from "child_process";

/**
 * Executes python3 commands with serialized JSON output.
 */
function runPythonCommand(cmd: string): Promise<any> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: process.cwd(), maxBuffer: 20 * 1024 * 1024, timeout: 8000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[Python Registry/Academy Error] ${error.message}\nStderr: ${stderr}`);
        return reject(new Error(stderr || error.message));
      }
      try {
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
        console.warn(`[Python Registry/Academy] JSON parse notice: ${stdout.substring(0, 200)}`);
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
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    return str(obj)
`;

export async function getRegistryOverview(): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.academy.facade import academy_facade
print(json.dumps(academy_facade.get_overview_summary(), default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function listStrategies(status?: string): Promise<any> {
  const statusFilter = status ? `LifecycleStatus('${status}')` : `None`;
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.registry import strategy_registry, LifecycleStatus
strats = strategy_registry.list_strategies(status=${statusFilter})
print(json.dumps([s.model_dump() for s in strats], default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function getCareerBook(strategyId: string): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.registry import strategy_registry
print(json.dumps(strategy_registry.get_career_book("${strategyId}"), default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function registerStrategy(payload: {
  name: string;
  parameters: any;
  genome?: any;
  generation?: number;
  parent_ids?: string[];
  asset_pair?: string;
  timeframe?: string;
  code_snippet?: string;
  initial_status?: string;
}): Promise<any> {
  const payloadStr = JSON.stringify(payload);
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.registry import strategy_registry, LifecycleStatus

data = json.loads('${payloadStr.replace(/'/g, "\\'")}')
status_val = LifecycleStatus(data.get('initial_status', 'ACADEMY')) if data.get('initial_status') else LifecycleStatus.ACADEMY

strat = strategy_registry.register_strategy(
    name=data.get('name', 'Strategy'),
    parameters=data.get('parameters', {}),
    genome=data.get('genome'),
    generation=int(data.get('generation', 1)),
    parent_ids=data.get('parent_ids', []),
    asset_pair=data.get('asset_pair', 'BTC/USD'),
    timeframe=data.get('timeframe', '15m'),
    code_snippet=data.get('code_snippet'),
    initial_status=status_val
)
print(json.dumps(strat.model_dump(), default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function runStrategyDrills(strategyId: string, symbol: string = "BTC/USD"): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.academy.facade import academy_facade
print(json.dumps(academy_facade.run_strategy_drills("${strategyId}", symbol="${symbol}"), default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function startShadowRace(championId: string, challengerId: string, symbol: string = "BTC/USD"): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.academy.facade import academy_facade
print(json.dumps(academy_facade.start_shadow_race("${championId}", "${challengerId}", symbol="${symbol}"), default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function evaluateShadowRace(raceId: string): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.academy.facade import academy_facade
print(json.dumps(academy_facade.evaluate_shadow_race("${raceId}"), default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}
