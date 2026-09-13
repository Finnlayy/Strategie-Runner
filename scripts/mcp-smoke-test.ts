/**
 * Smoke test for the local MCP servers.
 *
 * It uses the TypeScript MCP client to perform a real stdio initialization,
 * tool-list negotiation, and a safe tool call against both local servers.
 *
 * Python server checks are skipped automatically when the `mcp` package is not
 * installed. Set PYTHON to select an interpreter, e.g. `PYTHON=.venv/bin/python npm run test:mcp`.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);
const root = process.cwd();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function toolNames(tools: Awaited<ReturnType<Client["listTools"]>>): string[] {
  return tools.tools.map((tool) => tool.name).sort();
}

async function hasPythonMcp(python: string): Promise<boolean> {
  try {
    await execFileAsync(python, ["-c", "import mcp; print('mcp available')"], { cwd: root, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function smokeTypeScriptServer() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "server/mcp/server.ts")],
    cwd: root,
    stderr: "pipe",
    env: {
      ...process.env,
      STRATEGIE_RUNNER_URL: "http://127.0.0.1:9",
    },
  });
  const client = new Client({ name: "strategie-runner-mcp-smoke", version: "0.0.0" }, { capabilities: {} });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = toolNames(tools);
    for (const required of ["server_info", "list_strategies", "run_backtest", "start_strategy", "emergency_cancel_all"]) {
      assert(names.includes(required), `TypeScript MCP server is missing tool ${required}`);
    }

    const resources = await client.listResources();
    assert(resources.resources.some((r) => r.uri === "strategie-runner://strategies"), "Missing strategies resource");

    const result: any = await client.callTool({ name: "server_info", arguments: {} });
    const text = result.content?.find((item: any) => item.type === "text");
    assert(text && text.type === "text" && text.text.includes("strategie-runner-ts"), "server_info returned an unexpected payload");
  } finally {
    await client.close();
    transport.close();
  }
}

async function smokePythonServer(python: string) {
  const transport = new StdioClientTransport({
    command: python,
    args: ["-m", "app.mcp_server"],
    cwd: root,
    stderr: "pipe",
    env: {
      ...process.env,
      AI_LIVE_ORDERS: "false",
      QUANT_BACKEND: "sigma",
    },
  });
  const client = new Client({ name: "strategie-runner-python-mcp-smoke", version: "0.0.0" }, { capabilities: {} });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = toolNames(tools);
    for (const required of ["system_status", "sigma_indicators", "orchestrator_decide", "registry_overview"]) {
      assert(names.includes(required), `Python MCP server is missing tool ${required}`);
    }

    const resources = await client.listResources();
    assert(
      resources.resources.some((r) => r.uri === "strategie-runner-python://quant-backend"),
      "Missing quant-backend resource",
    );

    const result: any = await client.callTool({
      name: "sigma_indicators",
      arguments: {
        // Deterministic mild trend; enough history for every indicator.
        prices: Array.from({ length: 120 }, (_unused, index) => 100 + index * 0.08 + Math.sin(index / 7) * 0.2),
      },
    });
    const text = result.content?.find((item: any) => item.type === "text");
    assert(text && text.type === "text" && text.text.includes('"ok"'), "sigma_indicators returned an unexpected payload");
  } finally {
    await client.close();
    transport.close();
  }
}

async function main() {
  console.log("Checking TypeScript MCP server over stdio...");
  await smokeTypeScriptServer();
  console.log("  ✓ initialized, advertised tools/resources, and server_info responded");

  const venvPython = path.join(root, ".venv", "bin", "python");
  const python = process.env.PYTHON || (fs.existsSync(venvPython) ? venvPython : "python3");
  if (await hasPythonMcp(python)) {
    console.log(`Checking Python MCP server (${python}) over stdio...`);
    await smokePythonServer(python);
    console.log("  ✓ initialized, advertised tools/resources, and sigma_indicators responded");
  } else {
    console.warn(`! Skipping Python MCP smoke test: ${python} does not have the mcp package installed.`);
    console.warn("  Install requirements.txt or run with PYTHON=.venv/bin/python after creating a virtualenv.");
  }

  console.log("MCP smoke test passed.");
}

main().catch((error) => {
  console.error("MCP smoke test failed:", error);
  process.exit(1);
});
