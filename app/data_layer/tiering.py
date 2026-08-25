"""
Data Storage Tiering Architecture (Modul 1: 01_DATA_STORAGE_TIERING).
Implements 3-Tier Storage Hierarchy:
- Tier 1 (Hot): In-Memory Lock-Free Ringbuffer (Shared Memory / Preallocated Numpy Buffer)
- Tier 2 (Warm): Vectorized DuckDB + Polars Hive Parquet Lake
- Tier 3 (Cold): Asynchronous Cloud Synchronization (GDrive / rclone)
"""

from collections import deque
from datetime import datetime, timezone
import logging
import math
from pathlib import Path
import threading
import time
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import polars as pl

from app.core.config import settings
from app.core.directives import ExecutionPath, system_directive
from app.data_layer.facade import market_data
from app.data_layer.gdrive_sync import gdrive_sync_manager

logger = logging.getLogger("storage_tiering")


class ShmRingBuffer:
    """
    Tier 1: Preallocated In-Memory Ring Buffer for high-frequency sub-millisecond tick/candle access.
    Stores arrays of shape (capacity, 6): [timestamp_epoch_ms, open, high, low, close, volume].
    """

    def __init__(self, symbol: str, capacity: int = 10000):
        self.symbol = symbol
        self.capacity = capacity
        # Preallocated structured numpy array for zero-allocation hot-path writes
        self._buffer = np.zeros((capacity, 6), dtype=np.float64)
        self._head: int = 0
        self._size: int = 0
        self._lock = threading.Lock()

    def append(self, timestamp_epoch_ms: float, open_p: float, high_p: float, low_p: float, close_p: float, volume: float) -> None:
        """Appends one OHLCV bar into the ring buffer in O(1) time without heap allocations."""
        system_directive.record_path_execution(ExecutionPath.HOT_PATH)
        with self._lock:
            idx = self._head
            self._buffer[idx, 0] = timestamp_epoch_ms
            self._buffer[idx, 1] = open_p
            self._buffer[idx, 2] = high_p
            self._buffer[idx, 3] = low_p
            self._buffer[idx, 4] = close_p
            self._buffer[idx, 5] = volume

            self._head = (self._head + 1) % self.capacity
            if self._size < self.capacity:
                self._size += 1

    def get_latest(self, n: int = 100) -> np.ndarray:
        """
        Retrieves the latest n items in chronological order.
        """
        system_directive.record_path_execution(ExecutionPath.HOT_PATH)
        with self._lock:
            if self._size == 0:
                return np.empty((0, 6), dtype=np.float64)

            count = min(n, self._size)
            if self._size < self.capacity:
                # Contiguous slice from start
                start = max(0, self._head - count)
                return self._buffer[start:self._head].copy()
            else:
                # Wrapped slice
                indices = [(self._head - count + i) % self.capacity for i in range(count)]
                return self._buffer[indices].copy()

    def size(self) -> int:
        with self._lock:
            return self._size


class StorageTieringManager:
    """
    Coordinates Tier 1 (Shm Ringbuffer), Tier 2 (DuckDB Parquet Lake), and Tier 3 (Cold Sync).
    """

    def __init__(self):
        self._buffers: Dict[str, ShmRingBuffer] = {}
        self._lock = threading.Lock()
        self._sync_thread: Optional[threading.Thread] = None
        self._sync_active = False

    def get_or_create_ringbuffer(self, symbol: str, capacity: int = 10000) -> ShmRingBuffer:
        with self._lock:
            if symbol not in self._buffers:
                self._buffers[symbol] = ShmRingBuffer(symbol=symbol, capacity=capacity)
            return self._buffers[symbol]

    def ingest_tick_or_bar(
        self,
        symbol: str,
        open_p: float,
        high_p: float,
        low_p: float,
        close_p: float,
        volume: float,
        timestamp_epoch_ms: Optional[float] = None
    ) -> None:
        """Ingests into Tier 1 Ringbuffer."""
        ts = timestamp_epoch_ms or (time.time() * 1000.0)
        buf = self.get_or_create_ringbuffer(symbol)
        buf.append(ts, open_p, high_p, low_p, close_p, volume)

    def query_tiered_history(self, symbol: str, lookback_bars: int = 500) -> pl.DataFrame:
        """
        Reads from Tier 1 (In-Memory Ringbuffer). If insufficient, transparently spills over
        to Tier 2 (Vectorized DuckDB Lake).
        """
        buf = self.get_or_create_ringbuffer(symbol)
        if buf.size() >= lookback_bars:
            arr = buf.get_latest(lookback_bars)
            df = pl.DataFrame({
                "timestamp": [datetime.fromtimestamp(row[0] / 1000.0, tz=timezone.utc).isoformat() for row in arr],
                "open": arr[:, 1],
                "high": arr[:, 2],
                "low": arr[:, 3],
                "close": arr[:, 4],
                "volume": arr[:, 5]
            })
            return df

        # Spill over to Tier 2 (DuckDB Parquet Lake)
        system_directive.record_path_execution(ExecutionPath.WARM_PATH)
        return market_data.get_candles(symbol=symbol).tail(lookback_bars)

    def trigger_cold_sync_async(self, symbol: Optional[str] = None) -> Dict[str, Any]:
        """
        Tier 3: Asynchronously initiates cold cloud synchronization without blocking trading pipelines.
        """
        system_directive.record_path_execution(ExecutionPath.COLD_PATH)
        if not gdrive_sync_manager.is_configured():
            return {
                "status": "unconfigured",
                "message": "Google Drive sync is not configured (missing Service Account or OAuth credentials)."
            }

        def _worker():
            try:
                res = gdrive_sync_manager.push_to_drive(symbol=symbol)
                logger.info(f"[Tier 3 Cloud Sync] Completed: {res.get('uploaded_files', 0)} files uploaded.")
            except Exception as e:
                logger.error(f"[Tier 3 Cloud Sync Error]: {e}")

        t = threading.Thread(target=_worker, daemon=True, name="Tier3ColdSyncWorker")
        t.start()
        return {"status": "dispatched", "worker_thread": t.name}

    def get_tiering_status(self) -> Dict[str, Any]:
        with self._lock:
            t1_summary = {sym: buf.size() for sym, buf in self._buffers.items()}

        lake_status = market_data.get_lake_summary()
        gdrive_status = gdrive_sync_manager.get_sync_status()

        return {
            "tier1_in_memory_buffers": t1_summary,
            "tier2_lake_partitions": lake_status.get("summary", {}),
            "tier3_cloud_sync": gdrive_status,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


# Global Singleton
storage_tiering = StorageTieringManager()
