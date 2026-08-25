"""
Vectorized DuckDB Compute & Query Engine for OHLCV Market Data Lake.

Features:
- SIMD-accelerated columnar execution
- Partition Pruning & Predicate/Projection Pushdown directly on Parquet files
- Range querying (query_range) with Zero-Copy export to PyArrow and Polars
- Vectorized OHLCV Resampling (resample_ohlcv) using DuckDB time_bucket
- Multi-threaded connection management with memory limit governance
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import duckdb
import polars as pl
import pyarrow as pa

from app.core.config import settings
from app.data_layer.ohlc_storage import normalize_symbol_name


class OHLCVQueryEngine:
    """
    DuckDB-powered query engine for high-throughput OHLCV analytical processing.
    """

    def __init__(self, lake_base_dir: Optional[Union[str, Path]] = None):
        self.lake_dir = Path(lake_base_dir or settings.OHLCV_LAKE_DIR)
        self.lake_dir.mkdir(parents=True, exist_ok=True)
        self._init_duckdb()

    def _init_duckdb(self) -> None:
        """Initializes an in-memory DuckDB connection optimized for Parquet analysis."""
        self.con = duckdb.connect(database=":memory:")
        self.con.execute(f"SET memory_limit='{settings.DUCKDB_MEMORY_LIMIT}';")
        self.con.execute(f"SET threads TO {settings.DUCKDB_THREADS};")
        self.con.execute("SET preserve_insertion_order=false;")
        self.con.execute("PRAGMA enable_object_cache;")

    def _get_parquet_glob(self, symbol: Optional[str] = None, year: Optional[Union[int, str]] = None) -> str:
        """Constructs an optimal Parquet glob path for DuckDB partition pruning."""
        safe_sym = normalize_symbol_name(symbol) if symbol else "*"
        yr_str = str(year) if year else "*"
        return str(self.lake_dir / safe_sym / yr_str / "*.parquet")

    def has_data(self) -> bool:
        """Checks if any Parquet files exist in the data lake."""
        return any(self.lake_dir.glob("*/*/*.parquet"))

    def query_range(
        self,
        symbol: str,
        start_time: Optional[Union[str, datetime, int]] = None,
        end_time: Optional[Union[str, datetime, int]] = None,
        timeframe: Optional[str] = None,
        columns: Optional[List[str]] = None,
        as_format: str = "polars",
    ) -> Union[pl.DataFrame, pa.Table, List[Dict[str, Any]]]:
        """
        Executes a vectorized DuckDB range query over partitioned Parquet files.
        
        Supports Projection Pushdown (columns) & Predicate Pushdown (timestamp, timeframe).
        Zero-copy export to Polars or PyArrow Table.
        """
        if not self.has_data():
            empty_pl = pl.DataFrame(schema={
                "timestamp": pl.Datetime("ns", "UTC"),
                "symbol": pl.String,
                "timeframe": pl.String,
                "open": pl.Float64,
                "high": pl.Float64,
                "low": pl.Float64,
                "close": pl.Float64,
                "volume": pl.Float64,
                "trades_count": pl.Int64,
                "vwap": pl.Float64,
            })
            if as_format == "arrow":
                return empty_pl.to_arrow()
            if as_format == "dicts":
                return []
            return empty_pl

        safe_symbol = normalize_symbol_name(symbol)
        parquet_glob = self._get_parquet_glob(safe_symbol)

        # Select Columns (Projection Pushdown)
        col_clause = "*"
        if columns:
            safe_cols = [f'"{c}"' for c in columns]
            col_clause = ", ".join(safe_cols)

        # Build Predicate Clauses (Predicate Pushdown)
        where_clauses = ["1=1"]
        params: List[Any] = []

        if start_time is not None:
            if isinstance(start_time, (int, float)):
                # epoch timestamp
                where_clauses.append("timestamp >= to_timestamp(? / 1000000000.0)")
                params.append(float(start_time if start_time > 1e16 else start_time * 1e9 if start_time < 1e12 else start_time * 1e6))
            else:
                where_clauses.append("timestamp >= ?::TIMESTAMPTZ")
                params.append(str(start_time))

        if end_time is not None:
            if isinstance(end_time, (int, float)):
                where_clauses.append("timestamp <= to_timestamp(? / 1000000000.0)")
                params.append(float(end_time if end_time > 1e16 else end_time * 1e9 if end_time < 1e12 else end_time * 1e6))
            else:
                where_clauses.append("timestamp <= ?::TIMESTAMPTZ")
                params.append(str(end_time))

        if timeframe is not None:
            where_clauses.append("timeframe = ?")
            params.append(timeframe)

        where_sql = " AND ".join(where_clauses)
        sql = f"""
            SELECT {col_clause}
            FROM read_parquet('{parquet_glob}', union_by_name=true)
            WHERE {where_sql}
            ORDER BY timestamp ASC
        """

        empty_pl = pl.DataFrame(schema={
            "timestamp": pl.Datetime("ns", "UTC"),
            "symbol": pl.String,
            "timeframe": pl.String,
            "open": pl.Float64,
            "high": pl.Float64,
            "low": pl.Float64,
            "close": pl.Float64,
            "volume": pl.Float64,
            "trades_count": pl.Int64,
            "vwap": pl.Float64,
        })

        try:
            # Check if parquet files exist for glob
            safe_sym = normalize_symbol_name(symbol) if symbol else "*"
            sym_dir = self.lake_dir / safe_sym
            if not sym_dir.exists() or not any(sym_dir.glob("*/*.parquet")):
                if as_format == "arrow":
                    return empty_pl.to_arrow()
                if as_format == "dicts":
                    return []
                return empty_pl

            arrow_table = self.con.execute(sql, params).arrow()
            if arrow_table is None or arrow_table.num_rows == 0 or len(arrow_table.schema) == 0:
                if as_format == "arrow":
                    return empty_pl.to_arrow()
                if as_format == "dicts":
                    return []
                return empty_pl

            if as_format == "arrow":
                return arrow_table
            if as_format == "dicts":
                return pl.from_arrow(arrow_table).to_dicts()

            return pl.from_arrow(arrow_table)

        except Exception as e:
            # If any exception occurs during read_parquet or from_arrow conversion
            if as_format == "arrow":
                return empty_pl.to_arrow()
            if as_format == "dicts":
                return []
            return empty_pl

    def resample_ohlcv(
        self,
        symbol: str,
        start_time: Optional[Union[str, datetime]] = None,
        end_time: Optional[Union[str, datetime]] = None,
        target_interval: str = "15 minutes",
        as_format: str = "polars",
    ) -> Union[pl.DataFrame, pa.Table, List[Dict[str, Any]]]:
        """
        Performs vectorized OHLCV aggregation/resampling via DuckDB time_bucket.
        
        Calculates:
        - open: FIRST(open ORDER BY timestamp)
        - high: MAX(high)
        - low: MIN(low)
        - close: LAST(close ORDER BY timestamp)
        - volume: SUM(volume)
        - trades_count: SUM(trades_count)
        - vwap: SUM(volume * vwap) / SUM(volume)
        """
        if not self.has_data():
            empty_pl = pl.DataFrame()
            return empty_pl.to_arrow() if as_format == "arrow" else [] if as_format == "dicts" else empty_pl

        safe_symbol = normalize_symbol_name(symbol)
        parquet_glob = self._get_parquet_glob(safe_symbol)

        where_clauses = ["1=1"]
        params: List[Any] = []

        if start_time is not None:
            where_clauses.append("timestamp >= ?::TIMESTAMPTZ")
            params.append(str(start_time))

        if end_time is not None:
            where_clauses.append("timestamp <= ?::TIMESTAMPTZ")
            params.append(str(end_time))

        where_sql = " AND ".join(where_clauses)

        sql = f"""
            SELECT
                time_bucket(INTERVAL '{target_interval}', timestamp) AS timestamp,
                '{symbol}' AS symbol,
                '{target_interval}' AS timeframe,
                first(open ORDER BY timestamp) AS open,
                max(high) AS high,
                min(low) AS low,
                last(close ORDER BY timestamp) AS close,
                CAST(sum(volume) AS DOUBLE) AS volume,
                CAST(sum(COALESCE(trades_count, 0)) AS BIGINT) AS trades_count,
                CAST(CASE 
                    WHEN sum(volume) > 0 THEN sum(volume * COALESCE(vwap, close)) / sum(volume)
                    ELSE last(close ORDER BY timestamp)
                END AS DOUBLE) AS vwap
            FROM read_parquet('{parquet_glob}', union_by_name=true)
            WHERE {where_sql}
            GROUP BY 1
            ORDER BY 1 ASC
        """

        try:
            arrow_table = self.con.execute(sql, params).arrow()
        except (duckdb.IOException, duckdb.Error, Exception):
            empty_pl = pl.DataFrame()
            return empty_pl.to_arrow() if as_format == "arrow" else [] if as_format == "dicts" else empty_pl

        if as_format == "arrow":
            return arrow_table
        if as_format == "dicts":
            return pl.from_arrow(arrow_table).to_dicts()

        return pl.from_arrow(arrow_table)

    def get_dataset_summary(self) -> Dict[str, Any]:
        """
        Scans all Parquet partitions and generates high-level lake metrics.
        """
        all_files = list(self.lake_dir.glob("*/*/*.parquet"))
        if not all_files:
            return {
                "total_files": 0,
                "total_size_bytes": 0,
                "total_rows": 0,
                "symbols": [],
                "partitions": [],
                "time_range": {"min": None, "max": None}
            }

        total_bytes = sum(f.stat().st_size for f in all_files)
        parquet_glob = str(self.lake_dir / "*/*/*.parquet")

        try:
            summary_sql = f"""
                SELECT
                    count(*) AS total_rows,
                    min(timestamp) AS min_ts,
                    max(timestamp) AS max_ts,
                    count(DISTINCT symbol) AS distinct_symbols
                FROM read_parquet('{parquet_glob}', union_by_name=true)
            """
            res = self.con.execute(summary_sql).fetchone()
            total_rows = res[0] if res else 0
            min_ts = str(res[1]) if res and res[1] else None
            max_ts = str(res[2]) if res and res[2] else None

            # Symbol level stats
            sym_sql = f"""
                SELECT
                    symbol,
                    count(*) AS rows,
                    min(timestamp) AS start_time,
                    max(timestamp) AS end_time,
                    avg(close) AS avg_price,
                    sum(volume) AS total_vol
                FROM read_parquet('{parquet_glob}', union_by_name=true)
                GROUP BY symbol
                ORDER BY rows DESC
            """
            sym_stats = self.con.execute(sym_sql).fetchall()
            symbol_details = [
                {
                    "symbol": s[0],
                    "rows": s[1],
                    "start_time": str(s[2]),
                    "end_time": str(s[3]),
                    "avg_price": round(float(s[4]), 2) if s[4] else 0.0,
                    "total_volume": round(float(s[5]), 2) if s[5] else 0.0,
                }
                for s in sym_stats
            ]
        except Exception:
            total_rows = 0
            min_ts, max_ts = None, None
            symbol_details = []

        # Unique partitions
        partition_dirs = set()
        for f in all_files:
            rel = f.relative_to(self.lake_dir)
            if len(rel.parts) >= 2:
                partition_dirs.add(f"{rel.parts[0]}/{rel.parts[1]}")

        return {
            "total_files": len(all_files),
            "total_size_bytes": total_bytes,
            "total_size_mb": round(total_bytes / (1024 * 1024), 2),
            "total_rows": total_rows,
            "symbols_count": len(symbol_details),
            "symbols": symbol_details,
            "partitions": sorted(list(partition_dirs)),
            "time_range": {"min": min_ts, "max": max_ts},
        }


# Singleton Instance
query_engine = OHLCVQueryEngine()
