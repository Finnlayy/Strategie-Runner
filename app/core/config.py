"""
Core Configuration Module for Enterprise OHLCV Data Architecture.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional
import os


@dataclass
class OHLCVSettings:
    # Storage Paths
    OHLCV_LAKE_DIR: str = os.getenv("OHLCV_LAKE_DIR", "data/lake/ohlcv")
    
    # Google Drive Sync Configuration
    GDRIVE_SERVICE_ACCOUNT_FILE: Optional[str] = os.getenv(
        "GDRIVE_SERVICE_ACCOUNT_FILE", "secrets/service_account.json"
    )
    GDRIVE_REMOTE_BASE_PATH: str = os.getenv("GDRIVE_REMOTE_BASE_PATH", "Backtest_Data/OHLCV")
    GDRIVE_CHUNK_SIZE_MB: int = int(os.getenv("GDRIVE_CHUNK_SIZE_MB", "10"))
    GDRIVE_MAX_RETRIES: int = int(os.getenv("GDRIVE_MAX_RETRIES", "5"))
    GDRIVE_INITIAL_BACKOFF_SEC: float = float(os.getenv("GDRIVE_INITIAL_BACKOFF_SEC", "1.5"))
    
    # Parquet & Compression Settings
    PARQUET_COMPRESSION: str = os.getenv("PARQUET_COMPRESSION", "zstd")
    PARQUET_COMPRESSION_LEVEL: int = int(os.getenv("PARQUET_COMPRESSION_LEVEL", "7"))
    PARQUET_ROW_GROUP_SIZE: int = int(os.getenv("PARQUET_ROW_GROUP_SIZE", "100000"))
    
    # DuckDB Compute Settings
    DUCKDB_MEMORY_LIMIT: str = os.getenv("DUCKDB_MEMORY_LIMIT", "2GB")
    DUCKDB_THREADS: int = int(os.getenv("DUCKDB_THREADS", "4"))
    DUCKDB_ENABLE_SIMD: bool = True
    
    # Defaults & Symbols
    DEFAULT_TIMEFRAME: str = "1m"
    SUPPORTED_SYMBOLS: List[str] = field(
        default_factory=lambda: [
            "BTC/USD",
            "ETH/USD",
            "SOL/USD",
            "XRP/USD",
            "ADA/USD",
            "DOT/USD",
            "AVAX/USD",
            "LINK/USD"
        ]
    )

    def get_lake_path(self) -> Path:
        p = Path(self.OHLCV_LAKE_DIR)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def get_service_account_path(self) -> Optional[Path]:
        if not self.GDRIVE_SERVICE_ACCOUNT_FILE:
            return None
        p = Path(self.GDRIVE_SERVICE_ACCOUNT_FILE)
        return p if p.exists() else None


# Global Config Singleton
settings = OHLCVSettings()
