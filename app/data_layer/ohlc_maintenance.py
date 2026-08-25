"""
Compaction & Maintenance Engine for OHLCV Parquet Lake.

Features:
- Automated consolidation of fragmented delta Parquet files within (symbol/year) partitions
- High-performance timestamp-level deduplication: eliminates duplicate candles, keeping the latest state
- Monotonic sorting by timestamp ASC
- Atomic partition replacement: zero data loss during compactions
- Detailed telemetry: reduction ratios, storage freed, row counts, and duration
"""

import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import polars as pl
import pyarrow.parquet as pq

from app.core.config import settings
from app.data_layer.ohlc_storage import OHLCV_PYARROW_SCHEMA, normalize_symbol_name


class OHLCVMaintenanceEngine:
    """
    Handles compaction, consolidation, deduplication, and optimization of the OHLCV data lake.
    """

    def __init__(self, lake_base_dir: Optional[Union[str, Path]] = None):
        self.lake_dir = Path(lake_base_dir or settings.OHLCV_LAKE_DIR)
        self.lake_dir.mkdir(parents=True, exist_ok=True)

    def compact_partition(self, partition_path: Path) -> Dict[str, Any]:
        """
        Compacts all delta and existing parquet files in a single partition directory (e.g. data/lake/ohlcv/BTC-USD/2026).
        
        Performs:
        1. Multi-file Parquet reading via Polars
        2. Deduplication on (symbol, timeframe, timestamp), keeping latest
        3. Sorting by timestamp ASC
        4. Atomic write of single consolidated file `compacted_<year>.parquet`
        5. Removal of stale delta files
        """
        start_time = time.perf_counter()
        parquet_files = list(partition_path.glob("*.parquet"))

        # Skip if partition is empty or already has exactly 1 file named compacted_*.parquet
        if not parquet_files:
            return {
                "partition": str(partition_path.relative_to(self.lake_dir)),
                "status": "skipped",
                "reason": "empty",
                "duration_ms": 0,
            }

        if len(parquet_files) == 1 and parquet_files[0].name.startswith("compacted_"):
            return {
                "partition": str(partition_path.relative_to(self.lake_dir)),
                "status": "already_compacted",
                "files_count": 1,
                "duration_ms": round((time.perf_counter() - start_time) * 1000, 2),
            }

        original_size_bytes = sum(f.stat().st_size for f in parquet_files)
        original_files_count = len(parquet_files)

        # Read and merge all parquet files in partition
        try:
            merged_df = pl.read_parquet([str(f) for f in parquet_files])
        except Exception as exc:
            return {
                "partition": str(partition_path.relative_to(self.lake_dir)),
                "status": "error",
                "error": str(exc),
            }

        initial_rows = len(merged_df)

        # Deduplicate on (symbol, timeframe, timestamp) and sort
        deduped_df = merged_df.unique(
            subset=["symbol", "timeframe", "timestamp"], keep="last"
        ).sort("timestamp")

        final_rows = len(deduped_df)
        duplicates_removed = initial_rows - final_rows

        # Ensure correct Arrow schema
        arrow_table = deduped_df.to_arrow().cast(OHLCV_PYARROW_SCHEMA)

        # Year tag
        year_name = partition_path.name
        compacted_file_name = f"compacted_{year_name}.parquet"
        target_compacted_path = partition_path / compacted_file_name

        # Staged atomic write
        temp_fd, temp_file_path = tempfile.mkstemp(
            dir=str(partition_path), prefix=".tmp_compact_", suffix=".parquet"
        )
        os.close(temp_fd)

        try:
            pq.write_table(
                arrow_table,
                temp_file_path,
                compression=settings.PARQUET_COMPRESSION,
                compression_level=settings.PARQUET_COMPRESSION_LEVEL,
                row_group_size=settings.PARQUET_ROW_GROUP_SIZE,
                use_dictionary=True,
            )

            # Atomic replace
            os.replace(temp_file_path, target_compacted_path)

            # Remove previous delta files
            removed_count = 0
            for old_file in parquet_files:
                if old_file != target_compacted_path and old_file.exists():
                    try:
                        old_file.unlink()
                        removed_count += 1
                    except OSError:
                        pass

            new_size_bytes = target_compacted_path.stat().st_size
            bytes_saved = max(0, original_size_bytes - new_size_bytes)
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

            return {
                "partition": str(partition_path.relative_to(self.lake_dir)),
                "status": "success",
                "original_files": original_files_count,
                "files_removed": removed_count,
                "initial_rows": initial_rows,
                "final_rows": final_rows,
                "duplicates_removed": duplicates_removed,
                "original_bytes": original_size_bytes,
                "compacted_bytes": new_size_bytes,
                "bytes_saved": bytes_saved,
                "compression_gain_percent": round(
                    (bytes_saved / original_size_bytes * 100) if original_size_bytes > 0 else 0, 2
                ),
                "duration_ms": duration_ms,
            }

        except Exception as exc:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
            return {
                "partition": str(partition_path.relative_to(self.lake_dir)),
                "status": "error",
                "error": str(exc),
            }

    def compact_all(self, symbol: Optional[str] = None) -> Dict[str, Any]:
        """
        Runs compaction pipeline across all partitions (or for a specific symbol).
        """
        overall_start = time.perf_counter()
        symbol_filter = normalize_symbol_name(symbol) if symbol else "*"
        
        partition_dirs = sorted([
            p for p in self.lake_dir.glob(f"{symbol_filter}/*") if p.is_dir()
        ])

        results = []
        total_duplicates_removed = 0
        total_bytes_saved = 0
        total_files_removed = 0

        for part_dir in partition_dirs:
            res = self.compact_partition(part_dir)
            results.append(res)
            if res.get("status") == "success":
                total_duplicates_removed += res.get("duplicates_removed", 0)
                total_bytes_saved += res.get("bytes_saved", 0)
                total_files_removed += res.get("files_removed", 0)

        total_duration_ms = round((time.perf_counter() - overall_start) * 1000, 2)

        return {
            "status": "completed",
            "partitions_scanned": len(partition_dirs),
            "total_files_removed": total_files_removed,
            "total_duplicates_removed": total_duplicates_removed,
            "total_bytes_saved": total_bytes_saved,
            "total_mb_saved": round(total_bytes_saved / (1024 * 1024), 2),
            "total_duration_ms": total_duration_ms,
            "partition_results": results,
        }


# Singleton Instance
maintenance_engine = OHLCVMaintenanceEngine()
