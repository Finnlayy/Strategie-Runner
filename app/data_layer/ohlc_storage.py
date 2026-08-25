"""
High-Performance Partitioned Parquet Storage Layer for OHLCV Time Series.

Features:
- Strict Schema Validation (timestamp in nanoseconds UTC, float64 OHLCV, int64 trades_count, float64 vwap)
- Hive Partitioning Architecture: symbol/year (e.g., data/lake/ohlcv/BTC-USD/2026/...)
- Zstandard (ZSTD) Compression with optimized chunking and row group sizing
- Atomic write guarantees via temporary file staging and transactional rename
- Zero-copy PyArrow and Polars DataFrame interoperability
"""

import os
import uuid
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import polars as pl
import pyarrow as pa
import pyarrow.parquet as pq

from app.core.config import settings

# Canonical PyArrow Schema definition for enterprise OHLCV data
OHLCV_PYARROW_SCHEMA = pa.schema([
    pa.field("timestamp", pa.timestamp("ns", tz="UTC"), nullable=False),
    pa.field("symbol", pa.string(), nullable=False),
    pa.field("timeframe", pa.string(), nullable=False),
    pa.field("open", pa.float64(), nullable=False),
    pa.field("high", pa.float64(), nullable=False),
    pa.field("low", pa.float64(), nullable=False),
    pa.field("close", pa.float64(), nullable=False),
    pa.field("volume", pa.float64(), nullable=False),
    pa.field("trades_count", pa.int64(), nullable=True),
    pa.field("vwap", pa.float64(), nullable=True),
])


def normalize_symbol_name(symbol: str) -> str:
    """Normalizes symbol string to directory-safe naming (e.g., BTC/USD -> BTC-USD)."""
    return symbol.strip().replace("/", "-").replace(":", "-").upper()


class OHLCVStorageEngine:
    """
    Storage Engine responsible for writing and partitioning OHLCV datasets.
    """

    def __init__(self, lake_base_dir: Optional[Union[str, Path]] = None):
        self.lake_dir = Path(lake_base_dir or settings.OHLCV_LAKE_DIR)
        self.lake_dir.mkdir(parents=True, exist_ok=True)

    def _prepare_table(
        self,
        data: Union[pl.DataFrame, pa.Table, List[Dict[str, Any]]],
        symbol_override: Optional[str] = None,
        timeframe_override: Optional[str] = None,
    ) -> pa.Table:
        """
        Converts input data to a strictly typed, schema-compliant PyArrow Table.
        """
        if isinstance(data, list):
            if not data:
                return OHLCV_PYARROW_SCHEMA.empty_table()
            pl_df = pl.DataFrame(data)
        elif isinstance(data, pl.DataFrame):
            pl_df = data
        elif isinstance(data, pa.Table):
            pl_df = pl.from_arrow(data)
        else:
            raise TypeError(f"Unsupported data type for OHLCV storage: {type(data)}")

        # Normalize column names to lowercase
        pl_df = pl_df.rename({c: c.lower() for c in pl_df.columns})

        # Fill overrides if provided
        if symbol_override is not None and "symbol" not in pl_df.columns:
            pl_df = pl_df.with_columns(pl.lit(symbol_override).alias("symbol"))
        elif "symbol" in pl_df.columns and symbol_override is not None:
            pl_df = pl_df.with_columns(pl.lit(symbol_override).alias("symbol"))

        if timeframe_override is not None and "timeframe" not in pl_df.columns:
            pl_df = pl_df.with_columns(pl.lit(timeframe_override).alias("timeframe"))
        elif "timeframe" not in pl_df.columns:
            pl_df = pl_df.with_columns(pl.lit(settings.DEFAULT_TIMEFRAME).alias("timeframe"))

        # Optional columns
        if "trades_count" not in pl_df.columns:
            pl_df = pl_df.with_columns(pl.lit(None, dtype=pl.Int64).alias("trades_count"))
        if "vwap" not in pl_df.columns:
            # Approximate VWAP as typical price (H+L+C)/3 if not present
            if {"high", "low", "close"}.issubset(set(pl_df.columns)):
                pl_df = pl_df.with_columns(
                    ((pl.col("high") + pl.col("low") + pl.col("close")) / 3.0).alias("vwap")
                )
            else:
                pl_df = pl_df.with_columns(pl.lit(None, dtype=pl.Float64).alias("vwap"))

        # Timestamp normalization to UTC nanoseconds
        if "timestamp" in pl_df.columns:
            ts_dtype = pl_df.schema["timestamp"]
            if ts_dtype in (pl.Int64, pl.Int32, pl.Float64):
                # Check magnitude: seconds (~1e9), milliseconds (~1e12), or nanoseconds (~1e18)
                sample_val = pl_df["timestamp"][0] if len(pl_df) > 0 else 0
                if sample_val > 1e16:
                    # Already nanoseconds
                    pl_df = pl_df.with_columns(
                        pl.col("timestamp").cast(pl.Int64).cast(pl.Datetime("ns", "UTC"))
                    )
                elif sample_val > 1e11:
                    # Milliseconds -> convert to ns
                    pl_df = pl_df.with_columns(
                        (pl.col("timestamp") * 1_000_000).cast(pl.Int64).cast(pl.Datetime("ns", "UTC"))
                    )
                else:
                    # Seconds -> convert to ns
                    pl_df = pl_df.with_columns(
                        (pl.col("timestamp") * 1_000_000_000).cast(pl.Int64).cast(pl.Datetime("ns", "UTC"))
                    )
            elif ts_dtype == pl.Utf8 or ts_dtype == pl.String:
                pl_df = pl_df.with_columns(
                    pl.col("timestamp").str.to_datetime(time_unit="ns", time_zone="UTC")
                )
            elif isinstance(ts_dtype, pl.Datetime):
                if ts_dtype.time_zone is None:
                    pl_df = pl_df.with_columns(
                        pl.col("timestamp").dt.replace_time_zone("UTC").cast(pl.Datetime("ns", "UTC"))
                    )
                else:
                    pl_df = pl_df.with_columns(
                        pl.col("timestamp").dt.convert_time_zone("UTC").cast(pl.Datetime("ns", "UTC"))
                    )

        # Cast to exact types required
        pl_df = pl_df.select([
            pl.col("timestamp").cast(pl.Datetime("ns", "UTC")),
            pl.col("symbol").cast(pl.String),
            pl.col("timeframe").cast(pl.String),
            pl.col("open").cast(pl.Float64),
            pl.col("high").cast(pl.Float64),
            pl.col("low").cast(pl.Float64),
            pl.col("close").cast(pl.Float64),
            pl.col("volume").cast(pl.Float64),
            pl.col("trades_count").cast(pl.Int64),
            pl.col("vwap").cast(pl.Float64),
        ])

        # Convert to PyArrow Table with explicit Schema cast
        arrow_table = pl_df.to_arrow()
        return arrow_table.cast(OHLCV_PYARROW_SCHEMA)

    def write_partitioned(
        self,
        data: Union[pl.DataFrame, pa.Table, List[Dict[str, Any]]],
        symbol: Optional[str] = None,
        timeframe: Optional[str] = None,
        batch_id: Optional[str] = None,
    ) -> List[Path]:
        """
        Writes input OHLCV dataset into Hive-partitioned directory tree:
        `data/lake/ohlcv/<symbol>/<year>/data_<batch_id>.parquet`
        
        Guarantees atomic file operations via temp staging.
        """
        table = self._prepare_table(data, symbol_override=symbol, timeframe_override=timeframe)
        if table.num_rows == 0:
            return []

        # Convert to Polars for efficient grouping by symbol and year
        df = pl.from_arrow(table)
        df = df.with_columns([
            pl.col("timestamp").dt.year().alias("_year"),
            pl.col("symbol").map_elements(normalize_symbol_name, return_dtype=pl.String).alias("_safe_symbol")
        ])

        written_paths: List[Path] = []
        unique_partitions = df.select(["_safe_symbol", "_year"]).unique().to_dicts()

        batch_tag = batch_id or f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"

        for part in unique_partitions:
            part_symbol = part["_safe_symbol"]
            part_year = part["_year"]

            # Filter data for this specific symbol/year partition
            sub_df = df.filter(
                (pl.col("_safe_symbol") == part_symbol) & (pl.col("_year") == part_year)
            ).drop(["_year", "_safe_symbol"]).sort("timestamp")

            sub_table = sub_df.to_arrow().cast(OHLCV_PYARROW_SCHEMA)

            # Target directory: <lake_dir>/<symbol>/<year>
            partition_dir = self.lake_dir / part_symbol / str(part_year)
            partition_dir.mkdir(parents=True, exist_ok=True)

            target_file = partition_dir / f"delta_{batch_tag}.parquet"

            # Atomic Write via Temporary File
            temp_fd, temp_file_path = tempfile.mkstemp(
                dir=str(partition_dir), prefix=".tmp_ohlcv_", suffix=".parquet"
            )
            os.close(temp_fd)

            try:
                pq.write_table(
                    sub_table,
                    temp_file_path,
                    compression=settings.PARQUET_COMPRESSION,
                    compression_level=settings.PARQUET_COMPRESSION_LEVEL,
                    row_group_size=settings.PARQUET_ROW_GROUP_SIZE,
                    use_dictionary=True,
                )
                # Atomic Rename
                os.replace(temp_file_path, target_file)
                written_paths.append(target_file)
            except Exception as exc:
                if os.path.exists(temp_file_path):
                    os.remove(temp_file_path)
                raise IOError(f"Failed to write partition {target_file}: {exc}") from exc

        return written_paths


# Singleton Instance
storage_engine = OHLCVStorageEngine()
