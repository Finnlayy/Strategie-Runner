"""
=========================================================
Datei:      app/mcp/KrakenMCPBridge.py
Zweck:      Echte Verdrahtung aller Kraken-CLI MCP Tools
            Mode: -s all --allow-dangerous (L5 surface)
            Account-Transfers scheitern an Key-Scope (kein Withdraw)
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
from typing import Any, Dict, List, Optional

logger = logging.getLogger("app.mcp.kraken_bridge")

# Services exposed by: kraken mcp -s all --allow-dangerous
ALL_SERVICES = (
    "market",
    "account",
    "trade",
    "funding",
    "earn",
    "subaccount",
    "futures",
    "paper",
    "workspace",
    "auth",
    "feedback",
)

# Mutating / dangerous families (still callable; API key may reject transfers)
MUTATING_PREFIXES = (
    "kraken_order",
    "kraken_paper_buy",
    "kraken_paper_sell",
    "kraken_paper_cancel",
    "kraken_paper_cancel_all",
    "kraken_withdraw",
    "kraken_wallet_transfer",
    "kraken_deposit",
    "kraken_futures",
    "kraken_earn",
    "kraken_subaccount",
)


def _kraken_bin() -> str:
    path = shutil.which("kraken")
    if not path:
        raise RuntimeError("kraken CLI not found on PATH")
    return path


class KrakenMCPBridge:
    """
    Bridges Alpha to the real kraken-cli surface.

    Autonomy posture:
      - MCP / CLI args: -s all --allow-dangerous  (full tool surface, L5-capable)
      - API key: NO withdraw/transfer permission  (hard stop at exchange for funding moves)
    """

    def __init__(self, config=None, passkey_engine=None, ingestor=None, store=None):
        self.config = config
        self.passkey_engine = passkey_engine
        self.ingestor = ingestor
        self.store = store
        self.tools = self._discover_tools()
        self.invocation_log: List[Dict[str, Any]] = []
        self.mode = "all+allow-dangerous"
        self.autonomy_target = "L5-surface / L4-effective (key blocks transfers)"

    def _discover_tools(self) -> List[Dict[str, Any]]:
        """Prefer kraken help catalog; fall back to known MCP tool names."""
        tools: List[Dict[str, Any]] = []
        try:
            # Machine catalog ships with the plugin (~151 commands)
            catalog_paths = [
                "/home/finn-powers/.cursor/plugins/cache/cursor-public/kraken-cli/"
                "aa32814cea70913a70c9909693a7abd762963e83/agents/tool-catalog.json",
            ]
            for path in catalog_paths:
                try:
                    with open(path, encoding="utf-8") as fh:
                        catalog = json.load(fh)
                    for cmd in catalog.get("commands", []):
                        name = str(cmd.get("name") or "").replace("-", "_")
                        tool_name = f"kraken_{name}" if not name.startswith("kraken_") else name
                        tools.append({
                            "name": tool_name,
                            "cli": cmd.get("command"),
                            "group": cmd.get("group"),
                            "description": cmd.get("description"),
                            "auth_required": bool(cmd.get("auth_required")),
                            "dangerous": bool(cmd.get("dangerous")),
                            "mutating": bool(cmd.get("dangerous")) or str(cmd.get("group")) in {
                                "trade", "funding", "earn", "subaccount", "futures",
                            },
                        })
                    if tools:
                        break
                except FileNotFoundError:
                    continue
        except Exception as exc:
            logger.warning("tool catalog load failed: %s", exc)

        if not tools:
            # Minimal fallback — market + paper + common private
            for name in (
                "status", "server_time", "assets", "pairs", "ticker", "ohlc",
                "orderbook", "trades", "spreads", "balance", "open_orders",
                "positions", "paper_init", "paper_buy", "paper_sell", "paper_status",
            ):
                tools.append({
                    "name": f"kraken_{name}",
                    "group": "fallback",
                    "description": f"kraken {name}",
                    "mutating": name.startswith("paper_buy") or name.startswith("paper_sell"),
                    "dangerous": False,
                })
        return tools

    def list_tools(self) -> Dict[str, Any]:
        return {
            "total": len(self.tools),
            "services": list(ALL_SERVICES),
            "mode": self.mode,
            "autonomy": self.autonomy_target,
            "mutating": sum(1 for t in self.tools if t.get("mutating")),
            "dangerous": sum(1 for t in self.tools if t.get("dangerous")),
            "passkeyIntercept": "armed" if self.passkey_engine else "off",
            "note": "Transfers/withdrawals require key permission — current key has none.",
            "tools": self.tools,
        }

    def has_tool(self, name: str) -> bool:
        return any(t["name"] == name for t in self.tools)

    def execute(
        self,
        tool_name: str,
        args: Optional[Dict[str, Any]] = None,
        settings_token: Optional[str] = None,
        cli_args: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        args = args or {}
        tool = next((t for t in self.tools if t["name"] == tool_name), None)
        if tool is None and not tool_name.startswith("kraken_"):
            tool_name = f"kraken_{tool_name}"
            tool = next((t for t in self.tools if t["name"] == tool_name), None)

        mutating = bool(tool and tool.get("mutating")) or any(
            tool_name.startswith(p) for p in MUTATING_PREFIXES
        )
        if mutating and self.passkey_engine is not None:
            ok = self.passkey_engine.validate_settings_token(settings_token) is not None
            if not ok:
                return {
                    "ok": False,
                    "intercepted": True,
                    "error": "PASSKEY INTERCEPT: mutatives Tool erfordert gültiges settingsToken.",
                    "challenge_required": "/api/v1/auth/passkey/challenge",
                }

        # Prefer explicit CLI argv; else derive from tool catalog command
        if cli_args:
            argv = cli_args
        elif tool and tool.get("cli"):
            # e.g. "kraken ticker" → ["ticker", ...]
            parts = str(tool["cli"]).split()
            argv = parts[1:] if parts and parts[0] == "kraken" else parts
            for k, v in args.items():
                flag = f"--{k.replace('_', '-')}"
                if isinstance(v, bool):
                    if v:
                        argv.append(flag)
                elif v is not None:
                    argv.extend([flag, str(v)])
        else:
            # tool_name kraken_paper_buy → paper buy
            bare = tool_name.removeprefix("kraken_").replace("_", "-")
            argv = bare.split("-", 1) if "-" in bare else [bare]
            # Better: paper_buy → ["paper", "buy"]
            if "_" in tool_name.removeprefix("kraken_"):
                argv = tool_name.removeprefix("kraken_").split("_")

        result = self._run_kraken(argv)
        self.invocation_log.append({
            "tool": tool_name,
            "argv": argv,
            "ok": result.get("ok", False),
        })
        if len(self.invocation_log) > 200:
            self.invocation_log = self.invocation_log[-200:]
        return {"tool": tool_name, "mode": self.mode, **result}

    def _run_kraken(self, argv: List[str]) -> Dict[str, Any]:
        """Execute real kraken CLI with JSON output."""
        try:
            bin_path = _kraken_bin()
        except RuntimeError as exc:
            return {"ok": False, "error": str(exc)}

        cmd = [bin_path, *argv, "-o", "json"]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "kraken CLI timeout (60s)", "cmd": cmd}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "cmd": cmd}

        stdout = (proc.stdout or "").strip()
        stderr = (proc.stderr or "").strip()
        payload: Any
        try:
            payload = json.loads(stdout) if stdout else None
        except json.JSONDecodeError:
            payload = stdout

        # Exchange-level denial (e.g. withdraw without key permission) surfaces here
        if proc.returncode != 0:
            return {
                "ok": False,
                "exit_code": proc.returncode,
                "data": payload,
                "stderr": stderr[:2000],
                "cmd": cmd,
                "note": "CLI failed — often key-scope denial for funding/transfer tools.",
            }
        return {"ok": True, "exit_code": 0, "data": payload, "cmd": cmd}
