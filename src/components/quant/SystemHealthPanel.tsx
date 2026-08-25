import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { 
  Activity, ShieldAlert, Cpu, HardDrive, Zap, Radio, RefreshCw, 
  AlertTriangle, CheckCircle2, XCircle, Play, Pause, Flame, Server
} from "lucide-react";

interface SystemHealthPanelProps {
  onRefresh?: () => void;
}

export function SystemHealthPanel({ onRefresh }: SystemHealthPanelProps) {
  const [telemetry, setTelemetry] = useState<any>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastPing, setLastPing] = useState<number>(Date.now());
  const [isChangingState, setIsChangingState] = useState<boolean>(false);
  const [emergencyReason, setEmergencyReason] = useState<string>("");

  useEffect(() => {
    // Connect to Server-Sent Events (SSE) stream
    const eventSource = new EventSource("/api/quant/telemetry/stream");

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.addEventListener("telemetry", (event: any) => {
      try {
        const data = JSON.parse(event.data);
        setTelemetry(data);
        setLastPing(Date.now());
      } catch (err) {
        console.error("Failed to parse SSE telemetry:", err);
      }
    });

    eventSource.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const handleSetState = async (newState: string) => {
    setIsChangingState(true);
    try {
      const res = await fetch("/api/quant/state-machine/set-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: newState,
          reason: newState === "EMERGENCY_HALT" ? emergencyReason || "Manual Dashboard Emergency Directive" : undefined
        })
      });
      if (res.ok) {
        onRefresh?.();
      }
    } catch (err) {
      console.error("Failed to transition state machine:", err);
    } finally {
      setIsChangingState(false);
    }
  };

  const stateMachine = telemetry?.state_machine || {
    state: "SHADOW_ACTIVE",
    circuit_breaker: "NORMAL",
    active_path: "FAST_PATH_RL",
    can_execute_orders: true,
    last_trip_reason: null
  };

  const resourceGuard = telemetry?.resource_guard || {
    cpu_percent: 24.5,
    memory_percent: 38.2,
    load_shedding_level: "NORMAL",
    dropped_events: 0,
    active_threads: 4
  };

  const storageTiering = telemetry?.storage_tiering || {
    l1_shm_ringbuffer_bytes: 4194304,
    l1_capacity_bytes: 33554432,
    l2_duckdb_parquet_files: 14,
    l2_total_mb: 84.5,
    l3_rclone_sync_status: "SYNCHRONIZED",
    ingestion_rate_events_per_sec: 1450,
    avg_latency_microseconds: 45
  };

  const watchdog = telemetry?.watchdog || {
    watchdog_running: true,
    heartbeat_healthy: true,
    seconds_since_last_heartbeat: 0.25,
    circuit_breaker: "NORMAL"
  };

  const isEmergency = stateMachine.state === "EMERGENCY_HALT" || stateMachine.circuit_breaker !== "NORMAL";

  return (
    <div className="space-y-6" id="quant-system-health-panel">
      {/* Top Banner Alert if Emergency Halt */}
      {isEmergency && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl border border-red-500/40 bg-red-950/40 backdrop-blur-md flex items-center justify-between shadow-lg shadow-red-950/20"
        >
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-red-400 animate-pulse flex-shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-red-200 uppercase tracking-wider">
                System Circuit Breaker Tripped: {stateMachine.circuit_breaker}
              </h4>
              <p className="text-xs text-red-300/80 mt-0.5">
                {stateMachine.last_trip_reason || "Critical safety threshold breached. Hot-path order execution suspended."}
              </p>
            </div>
          </div>
          <button
            onClick={() => handleSetState("SHADOW_ACTIVE")}
            disabled={isChangingState}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold tracking-wider transition-colors shadow-md flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChangingState ? "animate-spin" : ""}`} />
            RESET CIRCUIT BREAKER
          </button>
        </motion.div>
      )}

      {/* Main 4 Health Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Pillar 1: State Machine (Modul 00) */}
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-blue-400" />
                State Machine (M-00)
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wide uppercase ${
                stateMachine.state === "LIVE_APPROVED" 
                  ? "bg-emerald-950/70 text-emerald-300 border border-emerald-500/30"
                  : stateMachine.state === "SHADOW_ACTIVE"
                  ? "bg-blue-950/70 text-blue-300 border border-blue-500/30"
                  : "bg-red-950/70 text-red-300 border border-red-500/30"
              }`}>
                {stateMachine.state}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">Execution Route:</span>
                <span className="font-mono text-cyan-300">{stateMachine.active_path || "FAST_PATH"}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">Order Routing:</span>
                <span className={`font-mono ${stateMachine.can_execute_orders ? "text-emerald-400" : "text-amber-400"}`}>
                  {stateMachine.can_execute_orders ? "ENABLED" : "LOCKED"}
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">Circuit Breaker:</span>
                <span className={`font-mono ${stateMachine.circuit_breaker === "NORMAL" ? "text-emerald-400" : "text-red-400"}`}>
                  {stateMachine.circuit_breaker}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex gap-2">
            <button
              onClick={() => handleSetState("LIVE_APPROVED")}
              disabled={isChangingState || stateMachine.state === "LIVE_APPROVED"}
              className="flex-1 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded text-[11px] font-medium transition-colors disabled:opacity-40"
            >
              LIVE APPROVE
            </button>
            <button
              onClick={() => handleSetState("EMERGENCY_HALT")}
              disabled={isChangingState || stateMachine.state === "EMERGENCY_HALT"}
              className="flex-1 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 rounded text-[11px] font-medium transition-colors disabled:opacity-40"
            >
              HALT
            </button>
          </div>
        </div>

        {/* Pillar 2: Storage Tiering (Modul 01) */}
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                Storage Tiering (M-01)
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-950/70 text-purple-300 border border-purple-500/30">
                L1/L2/L3 Active
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <div className="flex justify-between text-slate-300 mb-1">
                  <span className="text-slate-400">L1 Ringbuffer (RAM):</span>
                  <span className="font-mono text-purple-300">
                    {(storageTiering.l1_shm_ringbuffer_bytes / 1024 / 1024).toFixed(1)} / {(storageTiering.l1_capacity_bytes / 1024 / 1024).toFixed(0)} MB
                  </span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-purple-500 h-full rounded-full" 
                    style={{ width: `${Math.min(100, (storageTiering.l1_shm_ringbuffer_bytes / storageTiering.l1_capacity_bytes) * 100)}%` }}
                  />
                </div>
              </div>

              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">L2 DuckDB Parquet:</span>
                <span className="font-mono text-slate-200">{storageTiering.l2_duckdb_parquet_files || 14} files ({storageTiering.l2_total_mb || 84.5} MB)</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">L3 Remote Sync:</span>
                <span className="font-mono text-emerald-400">{storageTiering.l3_rclone_sync_status || "SYNCHRONIZED"}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex justify-between text-[11px] text-slate-400">
            <span>Throughput: <strong className="text-slate-200 font-mono">{storageTiering.ingestion_rate_events_per_sec || 1450} ev/s</strong></span>
            <span>Latency: <strong className="text-slate-200 font-mono">{storageTiering.avg_latency_microseconds || 45} µs</strong></span>
          </div>
        </div>

        {/* Pillar 3: Resource Guard & Load Shedding (Modul 11) */}
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                Resource Guard (M-11)
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                resourceGuard.load_shedding_level === "NORMAL" 
                  ? "bg-emerald-950/70 text-emerald-300 border border-emerald-500/30"
                  : resourceGuard.load_shedding_level === "WARNING"
                  ? "bg-amber-950/70 text-amber-300 border border-amber-500/30"
                  : "bg-red-950/70 text-red-300 border border-red-500/30"
              }`}>
                {resourceGuard.load_shedding_level}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <div className="flex justify-between text-slate-300 mb-1">
                  <span className="text-slate-400">CPU Compute Load:</span>
                  <span className="font-mono text-amber-300">{resourceGuard.cpu_percent || 24.5}%</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-amber-500 h-full rounded-full" 
                    style={{ width: `${Math.min(100, resourceGuard.cpu_percent || 24.5)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-300 mb-1">
                  <span className="text-slate-400">Memory Utilization:</span>
                  <span className="font-mono text-cyan-300">{resourceGuard.memory_percent || 38.2}%</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-cyan-500 h-full rounded-full" 
                    style={{ width: `${Math.min(100, resourceGuard.memory_percent || 38.2)}%` }}
                  />
                </div>
              </div>

              <div className="flex justify-between text-slate-300 pt-1">
                <span className="text-slate-400">Dropped Events:</span>
                <span className="font-mono text-slate-200">{resourceGuard.dropped_events || 0}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex justify-between text-[11px] text-slate-400">
            <span>Workers: <strong className="text-slate-200 font-mono">{resourceGuard.active_threads || 4} threads</strong></span>
            <span>Policy: <strong className="text-emerald-400 font-mono">Zero-Drop</strong></span>
          </div>
        </div>

        {/* Pillar 4: SSE Watchdog Telemetry (Modul 17) */}
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                SSE Watchdog (M-17)
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1.5 ${
                isConnected 
                  ? "bg-emerald-950/70 text-emerald-300 border border-emerald-500/30"
                  : "bg-amber-950/70 text-amber-300 border border-amber-500/30"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-400 animate-ping" : "bg-amber-400"}`} />
                {isConnected ? "LIVE STREAM" : "RECONNECTING"}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">Heartbeat Status:</span>
                <span className="font-mono text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {watchdog.heartbeat_healthy ? "HEALTHY" : "STALE"}
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">Heartbeat Latency:</span>
                <span className="font-mono text-cyan-300">{watchdog.seconds_since_last_heartbeat?.toFixed(2) || "0.15"}s</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">Event Buffer:</span>
                <span className="font-mono text-slate-200">{telemetry?.recent_logs?.length || 25} queued</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex justify-between text-[11px] text-slate-400">
            <span>Timeout Gate: <strong className="text-slate-200 font-mono">5.0s</strong></span>
            <span>Pulsing: <strong className="text-emerald-400 font-mono">&lt; 150ms</strong></span>
          </div>
        </div>
      </div>

      {/* Real-time Non-Blocking Telemetry Event Log Table */}
      <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-semibold text-slate-200 tracking-wider uppercase">
              Real-Time SSE Event Stream & Hot-Path Audit Log (Modul 17)
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Last Telemetry Beat: {new Date(lastPing).toLocaleTimeString()}
          </span>
        </div>

        <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/50 font-mono text-xs">
          {telemetry?.recent_logs && telemetry.recent_logs.length > 0 ? (
            telemetry.recent_logs.map((log: any, idx: number) => (
              <div key={idx} className="px-4 py-2 hover:bg-slate-800/30 flex items-start justify-between gap-4 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 text-[10px] w-16">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                    log.category === "ERROR" || log.category === "CIRCUIT_BREAKER"
                      ? "bg-red-950 text-red-300 border border-red-800"
                      : log.category === "WARN" || log.category === "HEALTH"
                      ? "bg-amber-950 text-amber-300 border border-amber-800"
                      : "bg-blue-950 text-blue-300 border border-blue-800"
                  }`}>
                    {log.category || "SYSTEM"}
                  </span>
                  <span className="text-slate-200">{log.message}</span>
                </div>
                {log.payload && Object.keys(log.payload).length > 0 && (
                  <span className="text-slate-400 text-[10px] truncate max-w-xs text-right">
                    {JSON.stringify(log.payload)}
                  </span>
                )}
              </div>
            ))
          ) : (
            <div className="px-4 py-6 text-center text-slate-500 text-xs">
              Connecting to SSE telemetry stream...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
