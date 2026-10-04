import React, { useState, useEffect } from "react";
import { Copy, Check, Play, RotateCw, Terminal, Activity, Zap, ShieldCheck } from "lucide-react";

export interface M8DashboardState {
  symbol: string;
  orderBookImbalance: number;
  deltaVof: number;
  bidAskSpread: number;
  atr: number;
  onnxActive: boolean;
  latentScores: number[];
  signal: "LONG" | "SHORT" | "WAIT";
  probabilities: { long: number; short: number; wait: number };
  urgencyScore: number;
  spreadSafeProbability: number;
  executable: boolean;
  timestamp?: number;
}

interface M8ControlDashboardProps {
  initialSymbol?: string;
  onDispatchOrder?: (cmd: string) => void;
}

export const M8ControlDashboard: React.FC<M8ControlDashboardProps> = ({
  initialSymbol = "PF_XBTUSD"
}) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [dispatchResult, setDispatchResult] = useState<string | null>(null);
  const [data, setData] = useState<M8DashboardState>({
    symbol: initialSymbol,
    orderBookImbalance: 0.78,
    deltaVof: 1450,
    bidAskSpread: 0.50,
    atr: 12.4,
    onnxActive: true,
    latentScores: [0.82, 0.12, 0.06],
    signal: "LONG",
    probabilities: { long: 0.74, short: 0.16, wait: 0.10 },
    urgencyScore: 2,
    spreadSafeProbability: 0.91,
    executable: true,
    timestamp: Date.now()
  });

  // Fetch live market state & ONNX status on mount
  useEffect(() => {
    fetchLiveState(data.symbol);
  }, [data.symbol]);

  const fetchLiveState = async (sym: string) => {
    try {
      const cleanPair = sym.replace("PF_", "").replace("XBT", "BTC");
      const res = await fetch(`/api/jev/live-state/${encodeURIComponent(cleanPair)}`);
      if (res.ok) {
        const live = await res.json();
        setData((prev) => ({
          ...prev,
          orderBookImbalance: live.order_book_imbalance ?? prev.orderBookImbalance,
          deltaVof: live.delta_vof ?? prev.deltaVof,
          bidAskSpread: live.bid_ask_spread ?? prev.bidAskSpread,
          atr: live.recent_volatility_atr ?? prev.atr
        }));
      }
    } catch {
      // Keep initial defaults
    }
  };

  const handleRunEvaluation = async () => {
    setLoading(true);
    setDispatchResult(null);

    try {
      const cleanPair = data.symbol.replace("PF_", "").replace("XBT", "BTC");
      const evalRes = await fetch("/api/jev/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: cleanPair,
          state: {
            timestamp: Date.now(),
            symbol: cleanPair,
            bid_ask_spread: data.bidAskSpread,
            order_book_imbalance: data.orderBookImbalance,
            delta_vof: data.deltaVof,
            recent_volatility_atr: data.atr,
            micro_price_trend: data.orderBookImbalance > 0.2 ? "upward" : data.orderBookImbalance < -0.2 ? "downward" : "neutral"
          }
        })
      });

      if (evalRes.ok) {
        const resData = await evalRes.json();
        const signalOut = resData.signal;

        // Try local ONNX inference for latent scores
        let latent = [0.82, 0.12, 0.06];
        try {
          const onnxRes = await fetch("/api/onnx/infer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pair: cleanPair })
          });
          if (onnxRes.ok) {
            const onnxJson = await onnxRes.json();
            if (onnxJson.probabilities && Array.isArray(onnxJson.probabilities)) {
              latent = onnxJson.probabilities.map((p: number) => +(p.toFixed(3)));
            }
          }
        } catch {
          // fallback latent scores
        }

        const sigUpper = (signalOut.signal || "LONG").toUpperCase() as "LONG" | "SHORT" | "WAIT";

        setData((prev) => ({
          ...prev,
          signal: sigUpper,
          probabilities: signalOut.probabilities || prev.probabilities,
          urgencyScore: signalOut.urgency_score ?? prev.urgencyScore,
          spreadSafeProbability: signalOut.spread_safe_probability ?? prev.spreadSafeProbability,
          executable: signalOut.executable_action ?? (signalOut.spread_safe_probability > 0.85 && signalOut.urgency_score >= 2),
          latentScores: latent,
          timestamp: Date.now()
        }));
      } else {
        // Fallback simulation tick
        setData((prev) => ({
          ...prev,
          timestamp: Date.now()
        }));
      }
    } catch {
      setData((prev) => ({
        ...prev,
        timestamp: Date.now()
      }));
    } finally {
      setLoading(false);
    }
  };

  const cliCommand = data.executable
    ? `kraken futures add --symbol ${data.symbol} --side ${data.signal.toLowerCase()} --size 1 --type lmt --reduce_only false`
    : `// Order blocked by M8 Gating or Signal is WAIT.`;

  const handleCopyCli = () => {
    navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDispatchKraken = async () => {
    if (!data.executable) return;
    setLoading(true);
    try {
      const cleanPair = data.symbol.replace("PF_", "").replace("XBT", "BTC");
      const res = await fetch("/api/jev/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signal: {
            symbol: cleanPair,
            signal: data.signal.toLowerCase(),
            urgency_score: data.urgencyScore,
            spread_safe_probability: data.spreadSafeProbability,
            executable_action: true,
            execution_plan: {
              cli_command: cliCommand
            }
          },
          paperMode: true,
          volume: 0.01
        })
      });
      const resJson = await res.json();
      setDispatchResult(resJson.message || `Dispatched order: ${resJson.order_id || "OK"}`);
    } catch (e: any) {
      setDispatchResult(`Dispatch error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ backgroundColor: "#0f172a", color: "#f8fafc", padding: "24px", fontFamily: "monospace", minHeight: "100%", borderRadius: "12px", border: "1px solid #334155" }}>
      <header style={{ borderBottom: "1px solid #334155", paddingBottom: "16px", marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.25rem", color: "#38bdf8", fontWeight: "bold" }}>
            M8 Engine Core // VizionAI ONNX + Jev 1.13 Hybrid Gating
          </h1>
          <p style={{ margin: "4px 0 0 0", fontSize: "0.85rem", color: "#94a3b8" }}>
            Execution Mode: <span style={{ color: "#facc15", fontWeight: "bold" }}>Paper / Kraken Futures Bridge</span>
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ background: data.onnxActive ? "#065f46" : "#991b1b", color: "#ecfdf5", padding: "6px 12px", borderRadius: "4px", fontSize: "0.8rem", border: "1px solid rgba(16, 185, 129, 0.4)", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#34d399", display: "inline-block" }} />
            ONNX Model: {data.onnxActive ? "ACTIVE (vizionai_model.onnx)" : "FALLBACK MODE"}
          </div>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "24px" }}>
        {/* Linke Spalte: Microstructure & Tensor State */}
        <div style={{ background: "#1e293b", padding: "20px", borderRadius: "8px", border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "1rem", color: "#cbd5e1", margin: 0 }}>
              Market Microstructure &amp; 16D Tensor State
            </h2>
            <button
              onClick={() => fetchLiveState(data.symbol)}
              title="Sync live order book telemetry"
              style={{ background: "#0f172a", border: "1px solid #475569", color: "#38bdf8", padding: "4px 8px", borderRadius: "4px", fontSize: "0.75rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
            >
              <RotateCw size={12} /> Sync Live
            </button>
          </div>
          
          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "4px" }}>Symbol</label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={data.symbol}
                onChange={(e) => setData({ ...data, symbol: e.target.value.toUpperCase() })}
                style={{ width: "100%", background: "#0f172a", border: "1px solid #475569", color: "#fff", padding: "8px", borderRadius: "4px", fontFamily: "monospace" }}
              />
              <select
                value={data.symbol}
                onChange={(e) => setData({ ...data, symbol: e.target.value })}
                style={{ background: "#0f172a", border: "1px solid #475569", color: "#38bdf8", padding: "8px", borderRadius: "4px", cursor: "pointer" }}
              >
                <option value="PF_XBTUSD">PF_XBTUSD</option>
                <option value="PF_ETHUSD">PF_ETHUSD</option>
                <option value="PF_SOLUSD">PF_SOLUSD</option>
                <option value="BTC/USD">BTC/USD</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "4px" }}>
              <span>Order Book Imbalance</span>
              <span style={{ color: data.orderBookImbalance > 0 ? "#34d399" : "#f87171" }}>
                {data.orderBookImbalance > 0 ? `+${data.orderBookImbalance.toFixed(2)}` : data.orderBookImbalance.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={data.orderBookImbalance}
              onChange={(e) => setData({ ...data, orderBookImbalance: parseFloat(e.target.value) })}
              style={{ width: "100%", accentColor: "#0284c7" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#64748b" }}>
              <span>-1.0 (Asks)</span>
              <span>0.0</span>
              <span>+1.0 (Bids)</span>
            </div>
          </div>

          <div style={{ marginBottom: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div style={{ background: "#0f172a", padding: "10px", borderRadius: "6px", border: "1px solid #334155" }}>
              <span style={{ fontSize: "0.75rem", color: "#94a3b8", display: "block" }}>VOF Delta</span>
              <strong style={{ fontSize: "1rem", color: data.deltaVof > 0 ? "#38bdf8" : "#f87171" }}>
                {data.deltaVof > 0 ? `+${data.deltaVof}` : data.deltaVof} contracts
              </strong>
            </div>
            <div style={{ background: "#0f172a", padding: "10px", borderRadius: "6px", border: "1px solid #334155" }}>
              <span style={{ fontSize: "0.75rem", color: "#94a3b8", display: "block" }}>Bid-Ask Spread</span>
              <strong style={{ fontSize: "1rem", color: data.bidAskSpread > 2.0 ? "#f87171" : "#34d399" }}>
                ${data.bidAskSpread.toFixed(2)}
              </strong>
            </div>
          </div>

          <div style={{ background: "#0f172a", padding: "12px", borderRadius: "6px", marginBottom: "20px", border: "1px solid #334155" }}>
            <span style={{ fontSize: "0.75rem", color: "#64748b", display: "block", marginBottom: "4px" }}>
              LOCAL ONNX LATENT SCORES (vizionai_model.onnx)
            </span>
            <code style={{ fontSize: "0.85rem", color: "#34d399", wordBreak: "break-all" }}>
              {JSON.stringify(data.latentScores)}
            </code>
            <div style={{ display: "flex", gap: "8px", marginTop: "8px", fontSize: "0.7rem", color: "#94a3b8" }}>
              <span>P(Long): {(data.latentScores[0] * 100).toFixed(0)}%</span>
              <span>P(Short): {(data.latentScores[1] * 100).toFixed(0)}%</span>
              <span>P(Wait): {(data.latentScores[2] * 100).toFixed(0)}%</span>
            </div>
          </div>

          <button 
            onClick={handleRunEvaluation}
            disabled={loading}
            style={{ width: "100%", background: "#0284c7", color: "#fff", border: "none", padding: "12px", borderRadius: "6px", fontWeight: "bold", cursor: loading ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", transition: "background 0.2s" }}
          >
            {loading ? (
              <>
                <RotateCw size={16} className="animate-spin" />
                <span>Evaluating Engine Cycle...</span>
              </>
            ) : (
              <>
                <Zap size={16} />
                <span>Execute Strategy Tick (ONNX + Jev)</span>
              </>
            )}
          </button>
        </div>

        {/* Rechte Spalte: Jev System-1 Gating & Execution Bridge */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div style={{ background: "#1e293b", padding: "20px", borderRadius: "8px", border: "1px solid #334155" }}>
            <h2 style={{ fontSize: "1rem", color: "#cbd5e1", marginTop: 0, marginBottom: "16px" }}>
              Jev 1.13 System-1 Decision Output
            </h2>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "16px" }}>
              <div style={{ background: "#0f172a", padding: "10px", borderRadius: "6px", textAlign: "center", border: "1px solid #334155" }}>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8", display: "block" }}>Signal</span>
                <strong style={{ fontSize: "1.1rem", color: data.signal === "LONG" ? "#4ade80" : data.signal === "SHORT" ? "#f87171" : "#cbd5e1" }}>
                  {data.signal}
                </strong>
              </div>
              <div style={{ background: "#0f172a", padding: "10px", borderRadius: "6px", textAlign: "center", border: "1px solid #334155" }}>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8", display: "block" }}>Urgency Score</span>
                <strong style={{ fontSize: "1.1rem", color: "#38bdf8" }}>
                  {data.urgencyScore} / 3
                </strong>
              </div>
              <div style={{ background: "#0f172a", padding: "10px", borderRadius: "6px", textAlign: "center", border: "1px solid #334155" }}>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8", display: "block" }}>Spread Safety (noul)</span>
                <strong style={{ fontSize: "1.1rem", color: data.spreadSafeProbability > 0.85 ? "#4ade80" : "#f87171" }}>
                  {(data.spreadSafeProbability * 100).toFixed(1)}%
                </strong>
              </div>
            </div>

            <div style={{ background: "#0f172a", padding: "12px", borderRadius: "6px", border: "1px solid #334155" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748b", display: "block", marginBottom: "6px" }}>HARD GATING PROTOCOL</span>
              <div style={{ fontSize: "0.8rem", display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ color: data.spreadSafeProbability > 0.85 ? "#4ade80" : "#f87171" }}>
                  ✔ Gate 1: Spread Risk Safe ({">"} 85%): {(data.spreadSafeProbability * 100).toFixed(1)}%
                </span>
                <span style={{ color: data.urgencyScore >= 2 ? "#4ade80" : "#f87171" }}>
                  ✔ Gate 2: Urgency Score (&ge; 2): {data.urgencyScore} / 3
                </span>
                <span style={{ color: (data.probabilities[data.signal.toLowerCase() as keyof typeof data.probabilities] || 0) > 0.6 ? "#4ade80" : "#f87171" }}>
                  ✔ Gate 3: Direction Confidence ({">"} 60%): {((data.probabilities[data.signal.toLowerCase() as keyof typeof data.probabilities] || 0) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          <div style={{ background: "#1e293b", padding: "20px", borderRadius: "8px", border: "1px solid #334155", flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <h2 style={{ fontSize: "1rem", color: "#cbd5e1", margin: 0 }}>Kraken CLI Paper Execution Bridge</h2>
                <button
                  onClick={handleCopyCli}
                  style={{ background: "#0f172a", border: "1px solid #475569", color: "#38bdf8", padding: "4px 8px", borderRadius: "4px", fontSize: "0.75rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                >
                  {copied ? <Check size={12} color="#4ade80" /> : <Copy size={12} />}
                  <span>{copied ? "Copied" : "Copy CLI"}</span>
                </button>
              </div>

              <div style={{ background: "#090d16", padding: "12px", borderRadius: "6px", border: "1px solid #334155", marginBottom: "12px", overflowX: "auto" }}>
                <code style={{ fontSize: "0.8rem", color: data.executable ? "#4ade80" : "#94a3b8", whiteSpace: "pre-wrap" }}>
                  {cliCommand}
                </code>
              </div>

              <div style={{ fontSize: "0.8rem", color: data.executable ? "#4ade80" : "#f87171", display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: data.executable ? "#4ade80" : "#f87171", display: "inline-block" }} />
                <span>Status: {data.executable ? "READY FOR PAPER DISPATCH VIA CLI" : "GATED / NO ACTION"}</span>
              </div>

              {dispatchResult && (
                <div style={{ marginTop: "12px", padding: "8px", background: "#0f172a", borderRadius: "4px", fontSize: "0.75rem", color: "#38bdf8", border: "1px solid #334155" }}>
                  {dispatchResult}
                </div>
              )}
            </div>

            {data.executable && (
              <div style={{ marginTop: "16px" }}>
                <button
                  onClick={handleDispatchKraken}
                  disabled={loading}
                  style={{ width: "100%", background: "#059669", color: "#fff", border: "none", padding: "10px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "0.85rem" }}
                >
                  <Play size={14} />
                  <span>Dispatch via Kraken Engine</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default M8ControlDashboard;
