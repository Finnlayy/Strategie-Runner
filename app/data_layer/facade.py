"""
Unified MarketDataManager Facade.

The single, authoritative entry point for all application components to interact
with the OHLCV Data Lake, DuckDB Query Engine, Compaction Pipeline, and Google Drive Cloud Sync.
"""

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import polars as pl
import pyarrow as pa

from app.core.config import settings
from app.data_layer.gdrive_sync import gdrive_sync_manager
from app.data_layer.ohlc_maintenance import maintenance_engine
from app.data_layer.ohlc_query import query_engine
from app.data_layer.ohlc_storage import normalize_symbol_name, storage_engine


class MarketDataManager:
    """
    Unified Data Manager Facade for Enterprise OHLCV Data Storage & Analytics.
    """

    def __init__(self, lake_dir: Optional[Union[str, Path]] = None):
        self.storage = storage_engine if lake_dir is None else type(storage_engine)(lake_dir)
        self.query = query_engine if lake_dir is None else type(query_engine)(lake_dir)
        self.maintenance = maintenance_engine if lake_dir is None else type(maintenance_engine)(lake_dir)
        self.cloud_sync = gdrive_sync_manager if lake_dir is None else type(gdrive_sync_manager)(lake_dir)

    # --------------------------------------------------------------------------
    # Ingestion & Storage API
    # --------------------------------------------------------------------------
    def ingest_candles(
        self,
        candles: Union[pl.DataFrame, pa.Table, List[Dict[str, Any]]],
        symbol: Optional[str] = None,
        timeframe: Optional[str] = None,
        batch_id: Optional[str] = None,
    ) -> List[Path]:
        """
        Ingests a batch of OHLCV candles, writes to Hive-partitioned Parquet files with ZSTD.
        """
        return self.storage.write_partitioned(
            data=candles,
            symbol=symbol,
            timeframe=timeframe,
            batch_id=batch_id,
        )

    # --------------------------------------------------------------------------
    # Vectorized Analytics & Range Queries (DuckDB)
    # --------------------------------------------------------------------------
    def get_candles(
        self,
        symbol: str,
        start_time: Optional[Union[str, datetime, int]] = None,
        end_time: Optional[Union[str, datetime, int]] = None,
        timeframe: Optional[str] = None,
        columns: Optional[List[str]] = None,
        as_format: str = "polars",
    ) -> Union[pl.DataFrame, pa.Table, List[Dict[str, Any]]]:
        """
        Queries range of OHLCV data using vectorized DuckDB engine with Partition Pruning.
        """
        return self.query.query_range(
            symbol=symbol,
            start_time=start_time,
            end_time=end_time,
            timeframe=timeframe,
            columns=columns,
            as_format=as_format,
        )

    def resample(
        self,
        symbol: str,
        start_time: Optional[Union[str, datetime]] = None,
        end_time: Optional[Union[str, datetime]] = None,
        target_interval: str = "15 minutes",
        as_format: str = "polars",
    ) -> Union[pl.DataFrame, pa.Table, List[Dict[str, Any]]]:
        """
        Resamples high-frequency OHLCV data into larger timeframe bars.
        """
        return self.query.resample_ohlcv(
            symbol=symbol,
            start_time=start_time,
            end_time=end_time,
            target_interval=target_interval,
            as_format=as_format,
        )

    # --------------------------------------------------------------------------
    # Compaction & Storage Optimization
    # --------------------------------------------------------------------------
    def compact(self, symbol: Optional[str] = None) -> Dict[str, Any]:
        """
        Triggers compaction and deduplication pipeline across partitions.
        """
        return self.maintenance.compact_all(symbol=symbol)

    # --------------------------------------------------------------------------
    # Cloud Backup & Google Drive Sync
    # --------------------------------------------------------------------------
    def sync_to_cloud(self, symbol: Optional[str] = None) -> Dict[str, Any]:
        """
        Synchronizes local Parquet lake with Google Drive via resumable chunked uploads.
        """
        return self.cloud_sync.push_to_drive(symbol=symbol)

    def get_cloud_sync_status(self) -> Dict[str, Any]:
        """
        Returns cloud sync configuration and sync parity status.
        """
        return self.cloud_sync.get_sync_status()

    # --------------------------------------------------------------------------
    # Lake Telemetry & System Health
    # --------------------------------------------------------------------------
    def get_lake_summary(self) -> Dict[str, Any]:
        """
        Generates full summary of partition files, symbols, row counts, and date ranges.
        """
        summary = self.query.get_dataset_summary()
        summary["cloud_sync"] = self.get_cloud_sync_status()
        summary["storage_config"] = {
            "lake_dir": settings.OHLCV_LAKE_DIR,
            "compression": settings.PARQUET_COMPRESSION,
            "compression_level": settings.PARQUET_COMPRESSION_LEVEL,
            "row_group_size": settings.PARQUET_ROW_GROUP_SIZE,
            "duckdb_memory_limit": settings.DUCKDB_MEMORY_LIMIT,
            "duckdb_threads": settings.DUCKDB_THREADS,
        }
        return summary


# Global Singleton Facade Instance
market_data = MarketDataManager()
