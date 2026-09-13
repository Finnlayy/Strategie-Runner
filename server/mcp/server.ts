#!/usr/bin/env node
/**
 * Strategie-Runner MCP server (TypeScript SDK).
 *
 * This is a small, safe process boundary around the already-running Node/Express
 * application.  It deliberately does not import server.ts because importing that
 * module starts the web server and the trading timers.  The MCP server talks to
 * the REST API instead, which keeps one authoritative state store.
 *
 * Configure the backend with STRATEGIE_RUNNER_URL (default http://localhost:3000).
 * Live-trading tools are disabled unless MCP_ENABLE_LIVE_TRADING=true and the
 * caller also passes the per-call confirmation flag.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export const SERVER_NAME = "strategie-runner-ts";
export const SERVER_VERSION = "0.1.0";

const DEFAULT_BASE_URL = "http://localhost:3000";
const BASE_URL = (process.env.STRATEGIE_RUNNER_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.MCP_HTTP_TIMEOUT_MS || 20_000);
const LIVE_TRADING_ENABLED = process.env.MCP_ENABLE_LIVE_TRADING === "true";

type Json = Record<string, any>;

function textResult(payload: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

async function api<T = any>(method: "GET" | "POST", pathname: string, body?: Json): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
      signal: controller.signal,
    });

    const raw = await response.text();
    let parsed: any = raw;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { raw };
    }

    if (!response.ok) {
      const message = parsed?.error || parsed?.message || raw || response.statusText;
      const error = new Error(typeof message === "string" ? message : JSON.stringify(message));
      (error as any).status = response.status;
      (error as any).payload = parsed;
      throw error;
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

function get(pathname: string) {
  return api("GET", pathname);
}

function post(pathname: string, body: Json) {
  return api("POST", pathname, body);
}

function safeSymbol(symbol: string) {
  return encodeURIComponent(symbol.toUpperCase());
}

export function createStrategieRunnerMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
      instructions: [
        "Strategie-Runner trading-desk tools.",
        "Read market, strategy, backtest, risk, and orchestrator state before suggesting actions.",
        "Mutating tools only change the local manifest/paper runner by default; live activation is double-gated.",
        "Never infer that an order was placed from a signal: check the returned dispatch/order payload.",
      ].join(" "),
    },
  );

  // -------------------------------------------------------------------------
  // Read-only tools
  // -------------------------------------------------------------------------

  server.registerTool(
    "server_info",
    {
      title: "Server information",
      description: "Return MCP server configuration, backend URL, and live-trading gate state.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {},
    },
    async () =>
      textResult({
        name: SERVER_NAME,
        version: SERVER_VERSION,
        backendUrl: BASE_URL,
        timeoutMs: TIMEOUT_MS,
        liveTradingEnabled: LIVE_TRADING_ENABLED,
        transport: "stdio",
      }),
  );

  server.registerTool(
    "health_check",
    {
      title: "Health check",
      description: "Check whether the Strategie-Runner HTTP backend is reachable and healthy.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await get("/api/health"));
      } catch (error: any) {
        return textResult({ ok: false, backendUrl: BASE_URL, error: error?.message || String(error) }, true);
      }
    },
  );

  server.registerTool(
    "list_strategies",
    {
      title: "List strategies",
      description: "List all strategies in the persistent strategy manifest.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () => textResult(await get("/api/strategies")),
  );

  server.registerTool(
    "get_strategy_manifest",
    {
      title: "Get full manifest",
      description: "Return strategies and persisted strategy P&L records.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () => textResult(await get("/api/manifest")),
  );

  server.registerTool(
    "get_market_data",
    {
      title: "Get market data",
      description: "Get current Kraken tickers, optionally restricted to one symbol.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        symbol: z.string().optional().describe("Canonical pair, for example BTC/USD"),
      },
    },
    async ({ symbol }) => {
      const tickers: any[] = await get("/api/market-data");
      const filtered = symbol ? tickers.filter((t) => t.pair === symbol.toUpperCase()) : tickers;
      return textResult(filtered);
    },
  );

  server.registerTool(
    "get_desk_logs",
    {
      title: "Get desk logs",
      description: "Read recent execution logs, metrics, orders, P&L, and queue-matrix telemetry.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        limit: z.number().int().min(1).max(250).optional().describe("Reserved for client display; the API returns its bounded log buffer."),
      },
    },
    async () => textResult(await get("/api/logs")),
  );

  server.registerTool(
    "get_queue_matrix",
    {
      title: "Get queue matrix",
      description: "Get the Level 2 paper or Level 4 live queue performance matrix.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        queue: z.enum(["paper", "live"]).default("paper"),
      },
    },
    async ({ queue }) => textResult(await get(`/api/queue-matrix/${queue}`)),
  );

  server.registerTool(
    "get_kraken_status",
    {
      title: "Kraken integration status",
      description: "Inspect paper/live mode, credential presence, automation level, and balances metadata.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {},
    },
    async () => textResult(await get("/api/kraken/status")),
  );

  server.registerTool(
    "get_orchestrator_status",
    {
      title: "Orchestrator status",
      description: "Read Alpha/SIGMA chamber status, recent decisions, portfolio state, and open Grok-bot hooks.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        symbol: z.string().optional(),
      },
    },
    async ({ symbol }) =>
      textResult(await get(`/api/orchestrator/status${symbol ? `?symbol=${safeSymbol(symbol)}` : ""}`)),
  );

  server.registerTool(
    "list_orchestrator_hooks",
    {
      title: "List orchestrator hooks",
      description: "List machine-readable Grok-bot takeover hooks and their fallback/implementation state.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () => textResult(await get("/api/orchestrator/hooks")),
  );

  server.registerTool(
    "calculate_sigma_indicators",
    {
      title: "Calculate Sigma indicators",
      description: "Calculate runner-identical z-score, ATR, Hurst, EMAs, MOS scores, and signal flags from closed prices.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        symbol: z.string().default("BTC/USD"),
        prices: z.array(z.number()).min(30).max(1024).describe("Chronological closed prices; at least 30, ideally 100+."),
        params: z.record(z.string(), z.any()).optional(),
      },
    },
    async ({ symbol, prices, params }) =>
      textResult(await post("/api/orchestrator/indicators", { symbol: symbol.toUpperCase(), prices, params })),
  );

  server.registerTool(
    "evaluate_quant_paper",
    {
      title: "Evaluate paper-only Sigma quant request",
      description: "Run the fail-closed Sigma quant bridge. This never authorizes live orders.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        symbol: z.string().default("BTC/USD"),
        prices: z.array(z.number()).min(40).max(2048).describe("Chronological closed prices."),
        requested_qty: z.number().nonnegative().optional(),
        parameters: z.record(z.string(), z.any()).optional(),
      },
    },
    async ({ symbol, prices, requested_qty, parameters }) =>
      textResult(
        await post("/api/quant/evaluate", {
          symbol: symbol.toUpperCase(),
          prices,
          requested_qty,
          parameters,
          execution_mode: "paper",
        }),
      ),
  );

  server.registerTool(
    "run_backtest",
    {
      title: "Run backtest",
      description: "Run a sandboxed strategy backtest through the existing Kraken/OHLC backtesting engine.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        strategyId: z.string().optional(),
        strategyName: z.string().optional(),
        assetPair: z.string().default("BTC/USD"),
        interval: z.number().int().min(1).max(1440).default(15),
        candleCount: z.number().int().min(50).max(720).default(300),
        initialBalance: z.number().positive().default(10_000),
        feePercent: z.number().nonnegative().default(0.26),
        slippagePercent: z.number().nonnegative().default(0.05),
        hardStopEnabled: z.boolean().default(true),
        hardStopPercent: z.number().positive().default(5),
        parameters: z.record(z.string(), z.any()).optional(),
        code: z.string().optional(),
      },
    },
    async (args) =>
      textResult(
        await post("/api/backtest/run", {
          ...args,
          assetPair: args.assetPair.toUpperCase(),
        }),
      ),
  );

  server.registerTool(
    "run_orchestrator_cycle",
    {
      title: "Run advisory orchestrator cycle",
      description:
        "Run an Alpha/SIGMA advisory cycle. Dispatches no order unless dispatch=true, confirmation is supplied, and server env ORS_ALLOW_DISPATCH permits it.",
      annotations: { readOnlyHint: false, openWorldHint: true },
      inputSchema: {
        symbol: z.string().default("BTC/USD"),
        prices: z.array(z.number()).min(5).max(2048).optional().describe("Closed prices; if omitted the backend fetches Kraken OHLC."),
        useGrok: z.boolean().default(false).describe("Opt in to paid Grok/xAI agent analysis."),
        useXSearch: z.boolean().default(false),
        dispatch: z.boolean().default(false).describe("Must remain false for ordinary analysis."),
        confirm_dispatch: z.boolean().default(false),
        strategyId: z.string().optional(),
        deadlineMs: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      if (args.dispatch && !args.confirm_dispatch) {
        return textResult({ error: "dispatch=true requires confirm_dispatch=true." }, true);
      }
      return textResult(
        await post("/api/orchestrator/cycle", {
          ...args,
          symbol: args.symbol.toUpperCase(),
        }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // Mutating, explicitly confirmed tools
  // -------------------------------------------------------------------------

  server.registerTool(
    "create_strategy",
    {
      title: "Create strategy",
      description: "Create a new inactive strategy in the persistent manifest. It is not started automatically.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        name: z.string().min(1).max(120),
        description: z.string().max(1000).optional(),
        assetPair: z.string().default("BTC/USD"),
        interval: z.number().int().min(2).max(86_400).default(10),
        code: z.string().min(1).max(30_000),
        parameters: z.record(z.string(), z.any()).default({}),
        hardStopEnabled: z.boolean().default(true),
        hardStopPercent: z.number().positive().max(100).default(5),
      },
    },
    async (args) =>
      textResult(
        await post("/api/strategies", {
          ...args,
          assetPair: args.assetPair.toUpperCase(),
        }),
      ),
  );

  server.registerTool(
    "start_strategy",
    {
      title: "Start or stop strategy runner",
      description:
        "Start or stop a registered strategy. Live mode requires MCP_ENABLE_LIVE_TRADING=true and confirm_live=true; paper mode is the default.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        id: z.string().min(1),
        action: z.enum(["start", "stop"]).default("start"),
        mode: z.enum(["paper", "live"]).default("paper"),
        confirm_live: z.boolean().default(false),
      },
    },
    async ({ id, action, mode, confirm_live }) => {
      if (action === "start" && mode === "live" && (!LIVE_TRADING_ENABLED || !confirm_live)) {
        return textResult(
          {
            error:
              "Live start is blocked. Enable MCP_ENABLE_LIVE_TRADING=true for the MCP process and pass confirm_live=true.",
            backendGate: "The backend and Kraken credentials still apply independently.",
          },
          true,
        );
      }
      return textResult(await post("/api/run", { id, action, mode: action === "start" ? mode : undefined }));
    },
  );

  server.registerTool(
    "emergency_cancel_all",
    {
      title: "Emergency cancel all",
      description:
        "Halt active runners and, when Kraken credentials exist, request cancellation of open exchange orders. Explicit confirmation is required.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        confirm: z.literal(true),
        strategyId: z.string().optional().describe("Omit to halt every active strategy."),
        reason: z.string().max(500).optional(),
      },
    },
    async ({ confirm, strategyId, reason }) => {
      if (!confirm) return textResult({ error: "confirm=true is required." }, true);
      return textResult(await post("/api/emergency/cancel-all", { strategyId, reason }));
    },
  );

  // -------------------------------------------------------------------------
  // Resources and prompt templates
  // -------------------------------------------------------------------------

  server.registerResource(
    "health",
    "strategie-runner://health",
    { title: "Backend health", description: "Current Strategie-Runner backend health", mimeType: "application/json" },
    async () => ({
      contents: [{ uri: "strategie-runner://health", mimeType: "application/json", text: JSON.stringify(await get("/api/health"), null, 2) }],
    }),
  );

  server.registerResource(
    "strategies",
    "strategie-runner://strategies",
    { title: "Strategy manifest", description: "Registered strategies", mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "strategie-runner://strategies",
          mimeType: "application/json",
          text: JSON.stringify(await get("/api/strategies"), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "orchestrator-hooks",
    "strategie-runner://orchestrator/hooks",
    { title: "Grok-bot hooks", description: "Open and implemented orchestrator hooks", mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "strategie-runner://orchestrator/hooks",
          mimeType: "application/json",
          text: JSON.stringify(await get("/api/orchestrator/hooks"), null, 2),
        },
      ],
    }),
  );

  server.registerPrompt(
    "investigate_strategy",
    {
      title: "Investigate a strategy",
      description: "Prepare a cautious strategy review workflow.",
      argsSchema: {
        strategy_id: z.string().describe("Manifest strategy ID"),
        question: z.string().optional(),
      },
    },
    async ({ strategy_id, question }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Investigate Strategie-Runner strategy ${strategy_id}.`,
              question ? `Operator question: ${question}` : "",
              "First inspect the strategy, logs, queue matrix, and available backtest/orchestrator results.",
              "Do not start live trading or place orders without explicit operator approval; prefer paper evidence and cite the tool outputs.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}

async function main() {
  const server = createStrategieRunnerMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] MCP stdio server ready; backend=${BASE_URL}`);
}

const directRunPattern = /(server[\\/]mcp[\\/]server\.(ts|js|cjs|mjs)|dist[\\/]mcp-server\.(js|cjs|mjs))$/;
const isDirectRun = process.argv[1] ? directRunPattern.test(process.argv[1]) : false;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`[${SERVER_NAME}] fatal:`, error);
    process.exit(1);
  });
}
