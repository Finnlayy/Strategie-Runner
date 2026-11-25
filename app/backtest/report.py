"""Run artifacts and the self-contained HTML research dashboard.

Each run produces an auditable packet on disk::

    <run_dir>/
      result.json          full API payload
      summary.json         compact run envelope
      metrics.csv          one row per metric
      equity_curve.csv     timestamp, nav, benchmark, drawdown, exposure
      trades.csv           reconstructed round-trip ledger
      weights.csv          realised weights per bar
      folds.csv            walk-forward folds (when applicable)
      trials.csv           optimisation trials (when applicable)
      dashboard.html       standalone report with inline SVG charts
      manifest.json        artifact inventory + provenance

No plotting library is required: charts are rendered as inline SVG so the
packet is portable and cheap to produce inside API/CLI processes.
"""

from __future__ import annotations

import csv
import html
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

ARTIFACT_NAMES = (
    "result.json",
    "payload.json",
    "summary.json",
    "metrics.csv",
    "equity_curve.csv",
    "trades.csv",
    "weights.csv",
    "folds.csv",
    "trials.csv",
    "stress.csv",
    "dashboard.html",
    "manifest.json",
)

CSV_ARTIFACTS = {"metrics.csv", "equity_curve.csv", "trades.csv", "weights.csv", "folds.csv", "trials.csv", "stress.csv"}


def sanitize(value: Any) -> Any:
    """Recursively convert numpy/pandas values into JSON-safe primitives."""

    if value is None:
        return None
    if isinstance(value, (str, bool)):
        return value
    if isinstance(value, (int,)):
        return int(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, Mapping):
        return {str(key): sanitize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [sanitize(item) for item in value]
    if hasattr(value, "item"):
        try:
            return sanitize(value.item())
        except Exception:
            pass
    if hasattr(value, "isoformat"):
        try:
            timestamp = value.isoformat()
            return timestamp
        except Exception:
            pass
    if hasattr(value, "to_dict"):
        try:
            return sanitize(value.to_dict())
        except Exception:
            pass
    return str(value)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(sanitize(payload), indent=2, sort_keys=False), encoding="utf-8")


def write_csv(path: Path, rows: Sequence[Mapping[str, Any]], columns: Sequence[str] | None = None) -> None:
    if columns is None:
        ordered: list[str] = []
        for row in rows[:200]:
            for key in row:
                if key not in ordered:
                    ordered.append(str(key))
        columns = ordered
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(columns), extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: sanitize(row.get(key)) for key in columns})


def build_metrics_rows(metrics: Mapping[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for key, value in metrics.items():
        if isinstance(value, Mapping):
            continue
        rows.append({"metric": key, "value": sanitize(value)})
    return rows


def build_equity_rows(result: Mapping[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for point in result.get("equityCurve", []):
        rows.append(
            {
                "timestamp": point.get("timestamp"),
                "equity": point.get("equity"),
                "benchmark_equity": point.get("benchmarkEquity"),
                "drawdown_percent": point.get("drawdown"),
                "cash": point.get("cash"),
                "asset_holdings": point.get("assetHoldings"),
                "price": point.get("price"),
            }
        )
    return rows


def build_weight_rows(weights: Any) -> list[dict[str, Any]]:
    if weights is None:
        return []
    rows: list[dict[str, Any]] = []
    try:
        index = list(weights.index)
        columns = list(weights.columns)
    except Exception:
        return []
    for position, timestamp in enumerate(index):
        row = {"timestamp": str(timestamp)}
        for column in columns:
            row[str(column)] = sanitize(round(float(weights.iloc[position][column]), 8))
        rows.append(row)
    return rows


def write_artifacts(
    run_dir: Path,
    *,
    result: Mapping[str, Any],
    summary: Mapping[str, Any],
    weights: Any = None,
    folds: Sequence[Mapping[str, Any]] | None = None,
    trials: Sequence[Mapping[str, Any]] | None = None,
    stress: Sequence[Mapping[str, Any]] | None = None,
    payload: Mapping[str, Any] | None = None,
    provenance: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Write every artifact and return the manifest."""

    run_dir.mkdir(parents=True, exist_ok=True)
    write_json(run_dir / "result.json", result)
    if payload is not None:
        write_json(run_dir / "payload.json", payload)
    write_json(run_dir / "summary.json", summary)
    write_csv(run_dir / "metrics.csv", build_metrics_rows(result.get("analytics", {}).get("metrics", {})), ["metric", "value"])
    write_csv(run_dir / "equity_curve.csv", build_equity_rows(result))
    write_csv(
        run_dir / "trades.csv",
        result.get("trades", []),
        [
            "id",
            "symbol",
            "type",
            "side",
            "entryTime",
            "exitTime",
            "entryPrice",
            "exitPrice",
            "amount",
            "totalValue",
            "fee",
            "pnl",
            "pnlPercent",
            "holdingBars",
            "status",
            "reason",
        ],
    )
    weight_rows = build_weight_rows(weights)
    if weight_rows:
        write_csv(run_dir / "weights.csv", weight_rows)
    else:
        write_csv(run_dir / "weights.csv", [])
    if folds:
        write_csv(run_dir / "folds.csv", folds)
    if trials:
        write_csv(run_dir / "trials.csv", trials)
    if stress:
        write_csv(run_dir / "stress.csv", stress)
    (run_dir / "dashboard.html").write_text(render_dashboard(result, summary, folds=folds, trials=trials, stress=stress), encoding="utf-8")

    manifest = {
        "runId": summary.get("runId"),
        "kind": summary.get("kind", "backtest"),
        "createdAt": summary.get("createdAt") or datetime.now(timezone.utc).isoformat(),
        "engine": result.get("engine"),
        "provenance": sanitize(provenance or {}),
        "artifacts": {},
    }
    for name in ARTIFACT_NAMES:
        candidate = run_dir / name
        if candidate.exists():
            manifest["artifacts"][name] = {
                "bytes": candidate.stat().st_size,
                "mediaType": "text/html" if name.endswith(".html") else ("application/json" if name.endswith(".json") else "text/csv"),
            }
    write_json(run_dir / "manifest.json", manifest)
    manifest["artifacts"]["manifest.json"] = {
        "bytes": (run_dir / "manifest.json").stat().st_size,
        "mediaType": "application/json",
    }
    return manifest


# ---------------------------------------------------------------------------
# HTML dashboard
# ---------------------------------------------------------------------------


def _esc(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def _fmt(value: Any, suffix: str = "", digits: int = 2) -> str:
    if value is None:
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return _esc(value)
    if not math.isfinite(number):
        return "—"
    return f"{number:,.{digits}f}{suffix}"


def _svg_chart(
    series: Sequence[tuple[str, Sequence[float], str]],
    *,
    width: int = 1120,
    height: int = 260,
    fill: bool = False,
    zero_line: bool = False,
) -> str:
    values = [value for _, points, _ in series for value in points if value is not None and math.isfinite(value)]
    if not values or not any(len(points) for _, points, _ in series):
        return "<p class='muted'>No data</p>"
    low = min(values)
    high = max(values)
    if high == low:
        high = low + 1.0
    pad = (high - low) * 0.08
    low -= pad
    high += pad
    if zero_line:
        high = max(high, 0.0)
        low = min(low, 0.0)
    span = high - low
    left, right, top, bottom = 56, 16, 16, 30
    inner_w = width - left - right
    inner_h = height - top - bottom

    def project(position: int, count: int, value: float) -> tuple[float, float]:
        x = left + (inner_w * position / max(1, count - 1))
        y = top + inner_h - (inner_h * (value - low) / span)
        return x, y

    parts = [f"<svg viewBox='0 0 {width} {height}' class='chart' role='img' aria-label='chart'>"]
    parts.append(
        f"<rect x='0' y='0' width='{width}' height='{height}' fill='#0b0f14'/>"
    )
    for fraction in (0.0, 0.25, 0.5, 0.75, 1.0):
        y = top + inner_h * (1 - fraction)
        value = low + span * fraction
        parts.append(f"<line x1='{left}' y1='{y:.1f}' x2='{width - right}' y2='{y:.1f}' stroke='#202733' stroke-width='1'/>")
        parts.append(
            f"<text x='{left - 8}' y='{y + 4:.1f}' fill='#7b8794' font-size='10' text-anchor='end' font-family='ui-monospace,monospace'>{value:,.2f}</text>"
        )
    if low < 0 < high:
        zero_y = top + inner_h - (inner_h * (0 - low) / span)
        parts.append(f"<line x1='{left}' y1='{zero_y:.1f}' x2='{width - right}' y2='{zero_y:.1f}' stroke='#475569' stroke-dasharray='3 3'/>")
    for label, points, color in series:
        clean = [point for point in points if point is not None and math.isfinite(point)]
        if not clean:
            continue
        coords = [project(position, len(points), point) for position, point in enumerate(points) if point is not None and math.isfinite(point)]
        path = " ".join(f"{'M' if index == 0 else 'L'}{x:.1f},{y:.1f}" for index, (x, y) in enumerate(coords))
        if fill:
            area = f"{path} L{coords[-1][0]:.1f},{top + inner_h:.1f} L{coords[0][0]:.1f},{top + inner_h:.1f} Z"
            parts.append(f"<path d='{area}' fill='{color}' opacity='0.14'/>")
        parts.append(f"<path d='{path}' fill='none' stroke='{color}' stroke-width='1.8' stroke-linejoin='round'/>")
    legend_x = left
    for label, points, color in series:
        if not any(point is not None for point in points):
            continue
        parts.append(f"<rect x='{legend_x}' y='{height - 18}' width='10' height='3' fill='{color}'/>")
        parts.append(
            f"<text x='{legend_x + 15}' y='{height - 13}' fill='#cbd5e1' font-size='10' font-family='ui-monospace,monospace'>{_esc(label)}</text>"
        )
        legend_x += 24 + 7 * len(label)
    parts.append("</svg>")
    return "".join(parts)


def _metric_card(label: str, value: str, tone: str = "neutral") -> str:
    tone_class = {"good": "good", "bad": "bad"}.get(tone, "")
    return (
        f"<div class='metric {tone_class}'>"
        f"<span class='metric-label'>{_esc(label)}</span>"
        f"<span class='metric-value'>{_esc(value)}</span>"
        f"</div>"
    )


def render_dashboard(
    result: Mapping[str, Any],
    summary: Mapping[str, Any],
    *,
    folds: Sequence[Mapping[str, Any]] | None = None,
    trials: Sequence[Mapping[str, Any]] | None = None,
    stress: Sequence[Mapping[str, Any]] | None = None,
) -> str:
    analytics = result.get("analytics", {})
    metrics = analytics.get("metrics", {})
    equity = result.get("equityCurve", [])
    nav_values = [point.get("equity") for point in equity]
    benchmark_values = [point.get("benchmarkEquity") for point in equity]
    drawdown_values = [point.get("drawdown") for point in equity]
    trades = result.get("trades", [])
    contribution = metrics.get("contribution") or {}

    cards = [
        _metric_card("Net Return", _fmt(metrics.get("totalReturnPercent"), "%"), "good" if (metrics.get("totalReturnPercent") or 0) >= 0 else "bad"),
        _metric_card("CAGR", _fmt(metrics.get("cagrPercent"), "%")),
        _metric_card("Sharpe", _fmt(metrics.get("sharpeRatio"), digits=2)),
        _metric_card("Sortino", _fmt(metrics.get("sortinoRatio"), digits=2)),
        _metric_card("Max Drawdown", _fmt(metrics.get("maxDrawdownPercent"), "%"), "bad"),
        _metric_card("Volatility", _fmt(metrics.get("annualizedVolatilityPercent"), "%")),
        _metric_card("Win Rate", _fmt(metrics.get("winRate"), "%"), "good" if (metrics.get("winRate") or 0) >= 50 else "bad"),
        _metric_card("Profit Factor", _fmt(metrics.get("profitFactor"), digits=2)),
        _metric_card("Trades", _fmt(metrics.get("totalTrades"), digits=0)),
        _metric_card("Exposure", _fmt(metrics.get("exposurePercent"), "%")),
        _metric_card("Fees", _fmt(metrics.get("totalFeesUSD"), " USD")),
        _metric_card("Alpha", _fmt(metrics.get("alphaPercent"), "%"), "good" if (metrics.get("alphaPercent") or 0) >= 0 else "bad"),
    ]

    fold_html = ""
    if folds:
        header = "".join(
            f"<th>{_esc(key)}</th>" for key in ("fold", "train", "test", "bestParams", "isSharpe", "oosSharpe", "oosReturn", "oosDrawdown")
        )
        rows = []
        for fold in folds:
            best = fold.get("bestParams") or {}
            rows.append(
                "<tr>"
                f"<td>{_esc(fold.get('fold'))}</td>"
                f"<td>{_esc(str(fold.get('trainStart', ''))[:10])} → {_esc(str(fold.get('trainEnd', ''))[:10])}</td>"
                f"<td>{_esc(str(fold.get('testStart', ''))[:10])} → {_esc(str(fold.get('testEnd', ''))[:10])}</td>"
                f"<td class='mono'>{_esc(json.dumps(best)) if best else '—'}</td>"
                f"<td>{_fmt((fold.get('inSample') or {}).get('sharpeRatio'))}</td>"
                f"<td>{_fmt((fold.get('outOfSample') or {}).get('sharpeRatio'))}</td>"
                f"<td>{_fmt((fold.get('outOfSample') or {}).get('totalReturnPercent'), '%')}</td>"
                f"<td>{_fmt((fold.get('outOfSample') or {}).get('maxDrawdownPercent'), '%')}</td>"
                "</tr>"
            )
        fold_html = f"<section><h2>Walk-Forward Folds</h2><table><thead><tr>{header}</tr></thead><tbody>{''.join(rows)}</tbody></table></section>"

    trial_html = ""
    if trials:
        header = "".join(f"<th>{_esc(key)}</th>" for key in ("rank", "params", "sharpe", "return", "drawdown", "trades"))
        rows = []
        for trial in trials[:25]:
            rows.append(
                "<tr>"
                f"<td>{_esc(trial.get('rank'))}</td>"
                f"<td class='mono'>{_esc(json.dumps(trial.get('params') or {}))}</td>"
                f"<td>{_fmt(trial.get('sharpeRatio'))}</td>"
                f"<td>{_fmt(trial.get('totalReturnPercent'), '%')}</td>"
                f"<td>{_fmt(trial.get('maxDrawdownPercent'), '%')}</td>"
                f"<td>{_fmt(trial.get('totalTrades'), digits=0)}</td>"
                "</tr>"
            )
        trial_html = f"<section><h2>Optimisation Trials</h2><table><thead><tr>{header}</tr></thead><tbody>{''.join(rows)}</tbody></table></section>"

    stress_html = ""
    if stress:
        rows = "".join(
            "<tr>"
            f"<td>{_fmt(item.get('feeBps'), digits=1)} bps</td>"
            f"<td>{_fmt(item.get('slippageBps'), digits=1)} bps</td>"
            f"<td>{_fmt(item.get('totalReturnPercent'), '%')}</td>"
            f"<td>{_fmt(item.get('sharpeRatio'))}</td>"
            f"<td>{_fmt(item.get('maxDrawdownPercent'), '%')}</td>"
            "</tr>"
            for item in stress
        )
        stress_html = (
            "<section><h2>Cost Stress</h2><table><thead><tr><th>Fee</th><th>Slippage</th>"
            f"<th>Return</th><th>Sharpe</th><th>Max DD</th></tr></thead><tbody>{rows}</tbody></table></section>"
        )

    contribution_rows = "".join(
        f"<tr><td>{_esc(symbol)}</td><td>{_fmt(item.get('contributionPercent'), '%')}</td>"
        f"<td>{_fmt(item.get('averageWeightPercent'), '%')}</td>"
        f"<td>{_fmt(item.get('sharePercent'), '%')}</td></tr>"
        for symbol, item in contribution.items()
    )
    contribution_html = (
        "<section><h2>Symbol Contribution</h2><table><thead><tr><th>Symbol</th><th>Contribution</th>"
        f"<th>Avg Weight</th><th>Share</th></tr></thead><tbody>{contribution_rows}</tbody></table></section>"
        if contribution_rows
        else ""
    )

    trade_rows = "".join(
        "<tr>"
        f"<td>{_esc(trade.get('id'))}</td>"
        f"<td>{_esc(trade.get('symbol'))}</td>"
        f"<td>{_esc(trade.get('type'))}</td>"
        f"<td>{_esc(str(trade.get('entryTime'))[:19])}</td>"
        f"<td>{_esc(str(trade.get('exitTime') or '')[:19])}</td>"
        f"<td>{_fmt(trade.get('entryPrice'), digits=4)}</td>"
        f"<td>{_fmt(trade.get('exitPrice'), digits=4)}</td>"
        f"<td>{_fmt(trade.get('amount'), digits=6)}</td>"
        f"<td class='{('good' if (trade.get('pnl') or 0) >= 0 else 'bad')}'>{_fmt(trade.get('pnl'), ' USD')}</td>"
        f"<td>{_fmt(trade.get('pnlPercent'), '%')}</td>"
        f"<td>{_esc(trade.get('status'))}</td>"
        "</tr>"
        for trade in trades[:300]
    )

    warning_html = "".join(f"<li>{_esc(item)}</li>" for item in (result.get("warnings") or []))
    engine = analytics.get("engine", {})
    data = analytics.get("data", {})
    strategy = analytics.get("strategy", {})
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{_esc(result.get('strategyName'))} — QuantJourney Research Packet</title>
<style>
:root {{ color-scheme: dark; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: #06090d; color: #e2e8f0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }}
main {{ max-width: 1240px; margin: 0 auto; padding: 28px 22px 60px; }}
header {{ border-bottom: 1px solid #1c2430; padding-bottom: 18px; margin-bottom: 22px; }}
h1 {{ font-size: 22px; margin: 0 0 6px; letter-spacing: -0.2px; }}
h2 {{ font-size: 14px; text-transform: uppercase; letter-spacing: 0.09em; color: #94a3b8; margin: 30px 0 12px; }}
.badges {{ display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }}
.badge {{ font: 11px ui-monospace, monospace; background: #0f1720; color: #7dd3fc; border: 1px solid #1e3a4a; padding: 3px 8px; border-radius: 5px; }}
.badge.qj {{ color: #86efac; border-color: #14532d; background: #07160d; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }}
.metric {{ background: #0b1117; border: 1px solid #1c2430; border-radius: 8px; padding: 10px 12px; }}
.metric-label {{ display: block; font: 10px ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }}
.metric-value {{ display: block; margin-top: 4px; font: 600 18px ui-monospace, monospace; color: #e2e8f0; }}
.metric.good .metric-value {{ color: #34d399; }}
.metric.bad .metric-value {{ color: #fb7185; }}
.chart {{ width: 100%; height: auto; border: 1px solid #1c2430; border-radius: 8px; background: #0b0f14; }}
section {{ margin-bottom: 8px; }}
table {{ width: 100%; border-collapse: collapse; font: 11px ui-monospace, monospace; background: #0b1117; border: 1px solid #1c2430; border-radius: 8px; overflow: hidden; }}
th, td {{ text-align: left; padding: 7px 9px; border-bottom: 1px solid #151d27; white-space: nowrap; }}
th {{ color: #94a3b8; font-weight: 600; background: #0e1620; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; }}
tr:last-child td {{ border-bottom: none; }}
.good {{ color: #34d399; }}
.bad {{ color: #fb7185; }}
.muted {{ color: #64748b; font-size: 12px; }}
.mono {{ font-family: ui-monospace, monospace; }}
.meta {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; font: 11px ui-monospace, monospace; color: #94a3b8; }}
.meta div {{ background: #0b1117; border: 1px solid #1c2430; border-radius: 6px; padding: 7px 9px; }}
.meta b {{ color: #cbd5e1; font-weight: 600; }}
.warnings {{ background: #1a0f10; border: 1px solid #4c1d24; border-radius: 8px; padding: 10px 14px; color: #fca5a5; font-size: 12px; }}
.warnings ul {{ margin: 6px 0 0 18px; padding: 0; }}
footer {{ margin-top: 36px; padding-top: 14px; border-top: 1px solid #1c2430; color: #475569; font-size: 11px; font-family: ui-monospace, monospace; }}
</style>
</head>
<body>
<main>
<header>
<h1>{_esc(result.get('strategyName'))}</h1>
<div class="muted">{_esc(result.get('assetPair'))} · {_esc(result.get('periodLabel'))} · generated {generated}</div>
<div class="badges">
<span class="badge qj">{_esc(engine.get('engine', 'unknown'))} {_esc(engine.get('version') or '')}</span>
<span class="badge">mode: {_esc(engine.get('mode', 'weights'))}</span>
<span class="badge">costs: {_fmt(engine.get('feeBps') if engine.get('feeBps') is not None else analytics.get('assumptions', {}).get('feeBps'), digits=1)} + {_fmt(analytics.get('assumptions', {}).get('slippageBps'), digits=1)} bps</span>
<span class="badge">policy: {_esc(engine.get('policy'))}</span>
<span class="badge">run: {_esc(summary.get('runId'))}</span>
</div>
</header>

<section>
<h2>Performance</h2>
<div class="grid">{''.join(cards)}</div>
</section>

<section>
<h2>Equity vs Benchmark</h2>
{_svg_chart([('Strategy NAV', nav_values, '#34d399'), ('Benchmark', benchmark_values, '#60a5fa')], fill=True)}
</section>

<section>
<h2>Drawdown (%)</h2>
{_svg_chart([('Drawdown', drawdown_values, '#fb7185')], height=180, fill=True, zero_line=True)}
</section>

<section>
<h2>Configuration</h2>
<div class="meta">
<div><b>Strategy</b> {_esc(strategy.get('model'))} · {_esc(json.dumps(strategy.get('params') or {}))}</div>
<div><b>Universe</b> {_esc(', '.join(data.get('symbols') or []))}</div>
<div><b>Bars</b> {_fmt(data.get('bars'), digits=0)} · {_esc(data.get('start'))} → {_esc(data.get('end'))}</div>
<div><b>Benchmark</b> {_esc(data.get('benchmark'))}</div>
<div><b>Rebalances</b> {_fmt(analytics.get('rebalance', {}).get('count'), digits=0)}</div>
<div><b>Turnover</b> {_fmt(metrics.get('turnoverRatio'))}x</div>
<div><b>Exposure</b> {_fmt(metrics.get('exposurePercent'), '%')}</div>
<div><b>Periods / year</b> {_fmt(metrics.get('periodsPerYear'), digits=0)}</div>
</div>
</section>

{contribution_html}
{fold_html}
{trial_html}
{stress_html}

<section>
<h2>Trade Ledger</h2>
<table>
<thead><tr><th>ID</th><th>Symbol</th><th>Side</th><th>Entry</th><th>Exit</th><th>Entry Px</th><th>Exit Px</th><th>Qty</th><th>PnL</th><th>PnL %</th><th>Status</th></tr></thead>
<tbody>{trade_rows or '<tr><td colspan="11" class="muted">No trades reconstructed</td></tr>'}</tbody>
</table>
</section>

{('<section><h2>Warnings</h2><div class="warnings"><ul>' + warning_html + '</ul></div></section>') if warning_html else ''}

<footer>
QuantJourney Backtester research packet · engine {_esc(engine.get('engine'))} {_esc(engine.get('version') or '')} ·
cost model {_esc(engine.get('costModel'))} · generated by Strategie-Runner
</footer>
</main>
</body>
</html>
"""
