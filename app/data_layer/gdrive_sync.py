"""
Cloud Backup & Synchronization Layer using Google Drive API v3.

Features:
- Service Account & OAuth authentication
- Recursive mirroring of Hive Parquet partitions (symbol/year/...) to Google Drive
- MD5 Checksum verification to skip already synchronized files
- Resumable chunked uploads (configurable 10MB chunking) for large Parquet datasets
- Exponential backoff with random jitter on rate limits (429/5xx HttpError)
- Comprehensive sync telemetry (files uploaded, skipped, failed, transfer speed)
"""

import hashlib
import io
import os
import random
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload
    GOOGLE_DRIVE_AVAILABLE = True
except ImportError:
    GOOGLE_DRIVE_AVAILABLE = False

from app.core.config import settings
from app.data_layer.ohlc_storage import normalize_symbol_name

SCOPES = ["https://www.googleapis.com/auth/drive"]


def compute_md5(file_path: Union[str, Path]) -> str:
    """Computes standard hexadecimal MD5 checksum of a local file."""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096 * 1024), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


class GoogleDriveSyncManager:
    """
    Manages cloud synchronization of Parquet data lake with Google Drive.
    """

    def __init__(self, lake_base_dir: Optional[Union[str, Path]] = None):
        self.lake_dir = Path(lake_base_dir or settings.OHLCV_LAKE_DIR)
        self.lake_dir.mkdir(parents=True, exist_ok=True)
        self.service = None
        self._folder_cache: Dict[str, str] = {}  # Path -> Drive Folder ID
        self._init_service()

    def _init_service(self) -> None:
        """Initializes Google Drive v3 API Client using Service Account or environment."""
        if not GOOGLE_DRIVE_AVAILABLE:
            return

        sa_path = settings.get_service_account_path()
        if sa_path and sa_path.exists():
            try:
                creds = service_account.Credentials.from_service_account_file(
                    str(sa_path), scopes=SCOPES
                )
                self.service = build("drive", "v3", credentials=creds, cache_discovery=False)
            except Exception as e:
                print(f"[GDriveSync] Warning: Failed to load service account: {e}")
        else:
            # Check for GOOGLE_APPLICATION_CREDENTIALS or inline JSON env
            sa_json_env = os.getenv("GDRIVE_SERVICE_ACCOUNT_JSON")
            if sa_json_env:
                try:
                    import json
                    info = json.loads(sa_json_env)
                    creds = service_account.Credentials.from_service_account_info(
                        info, scopes=SCOPES
                    )
                    self.service = build("drive", "v3", credentials=creds, cache_discovery=False)
                except Exception as e:
                    print(f"[GDriveSync] Warning: Failed to load service account from env JSON: {e}")

    def is_configured(self) -> bool:
        """Returns True if Google Drive API credentials are valid and active."""
        return self.service is not None

    def _execute_with_backoff(self, request_fn, *args, **kwargs) -> Any:
        """Executes a Google Drive API request with exponential backoff and jitter."""
        max_retries = settings.GDRIVE_MAX_RETRIES
        backoff = settings.GDRIVE_INITIAL_BACKOFF_SEC

        for attempt in range(1, max_retries + 1):
            try:
                return request_fn(*args, **kwargs)
            except HttpError as err:
                status_code = err.resp.status if hasattr(err, "resp") else 500
                if status_code in (429, 500, 502, 503, 504) and attempt < max_retries:
                    sleep_time = backoff * (2 ** (attempt - 1)) + random.uniform(0.1, 0.5)
                    time.sleep(sleep_time)
                else:
                    raise
            except Exception as e:
                if attempt < max_retries:
                    sleep_time = backoff * (2 ** (attempt - 1)) + random.uniform(0.1, 0.5)
                    time.sleep(sleep_time)
                else:
                    raise

    def get_or_create_remote_folder(self, folder_path: str, parent_id: str = "root") -> str:
        """
        Recursively ensures that remote folder hierarchy exists on Google Drive.
        Returns the Drive Folder ID of the deepest folder.
        """
        if not self.is_configured():
            raise RuntimeError("Google Drive sync is not configured (missing service account credentials).")

        normalized_path = folder_path.strip("/").replace("\\", "/")
        if not normalized_path:
            return parent_id

        if normalized_path in self._folder_cache:
            return self._folder_cache[normalized_path]

        parts = normalized_path.split("/")
        current_parent = parent_id
        current_accum_path = ""

        for part in parts:
            current_accum_path = f"{current_accum_path}/{part}".strip("/")
            if current_accum_path in self._folder_cache:
                current_parent = self._folder_cache[current_accum_path]
                continue

            query = (
                f"mimeType='application/vnd.google-apps.folder' and "
                f"name='{part}' and "
                f"'{current_parent}' in parents and "
                f"trashed=false"
            )

            results = self._execute_with_backoff(
                lambda: self.service.files().list(
                    q=query, spaces="drive", fields="files(id, name)"
                ).execute()
            )
            files = results.get("files", [])

            if files:
                folder_id = files[0]["id"]
            else:
                # Create Folder
                folder_metadata = {
                    "name": part,
                    "mimeType": "application/vnd.google-apps.folder",
                    "parents": [current_parent],
                }
                folder = self._execute_with_backoff(
                    lambda: self.service.files().create(
                        body=folder_metadata, fields="id"
                    ).execute()
                )
                folder_id = folder.get("id")

            self._folder_cache[current_accum_path] = folder_id
            current_parent = folder_id

        return current_parent

    def list_remote_files(self, folder_id: str) -> List[Dict[str, Any]]:
        """Lists all files in a specific Google Drive folder with MD5 checksums."""
        if not self.is_configured():
            return []

        query = f"'{folder_id}' in parents and trashed=false"
        files: List[Dict[str, Any]] = []
        page_token = None

        while True:
            response = self._execute_with_backoff(
                lambda: self.service.files().list(
                    q=query,
                    spaces="drive",
                    fields="nextPageToken, files(id, name, md5Checksum, size, modifiedTime, mimeType)",
                    pageToken=page_token,
                ).execute()
            )
            files.extend(response.get("files", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                break

        return files

    def upload_parquet_file(
        self,
        local_file_path: Path,
        remote_folder_id: str,
        existing_remote_file: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Uploads a Parquet file using Resumable Chunked Upload.
        Verifies MD5 before upload to skip if already matching.
        """
        local_md5 = compute_md5(local_file_path)
        file_name = local_file_path.name
        file_size = local_file_path.stat().st_size

        if existing_remote_file:
            remote_md5 = existing_remote_file.get("md5Checksum")
            if remote_md5 and remote_md5.lower() == local_md5.lower():
                return {
                    "file_name": file_name,
                    "status": "skipped",
                    "reason": "md5_matched",
                    "size_bytes": file_size,
                    "drive_file_id": existing_remote_file["id"],
                }

        # Setup Resumable Media Upload with 10MB chunksize
        chunk_size = settings.GDRIVE_CHUNK_SIZE_MB * 1024 * 1024
        media = MediaFileUpload(
            str(local_file_path),
            mimetype="application/octet-stream",
            resumable=True,
            chunksize=chunk_size,
        )

        file_metadata = {
            "name": file_name,
            "parents": [remote_folder_id],
        }

        if existing_remote_file:
            # Update existing file
            req = self.service.files().update(
                fileId=existing_remote_file["id"],
                media_body=media,
                fields="id, name, md5Checksum, size",
            )
        else:
            # Create new file
            req = self.service.files().create(
                body=file_metadata,
                media_body=media,
                fields="id, name, md5Checksum, size",
            )

        response = None
        while response is None:
            status, response = self._execute_with_backoff(lambda: req.next_chunk())

        return {
            "file_name": file_name,
            "status": "uploaded",
            "size_bytes": file_size,
            "drive_file_id": response.get("id"),
            "md5": response.get("md5Checksum", local_md5),
        }

    def push_to_drive(self, symbol: Optional[str] = None) -> Dict[str, Any]:
        """
        Pushes local Parquet partitions to Google Drive.
        """
        start_time = time.perf_counter()

        if not self.is_configured():
            # Return graceful unconfigured report
            return {
                "status": "unconfigured",
                "message": (
                    "Google Drive credentials not detected. Place service account at "
                    f"{settings.GDRIVE_SERVICE_ACCOUNT_FILE} or set GDRIVE_SERVICE_ACCOUNT_JSON."
                ),
                "synced_files": 0,
                "skipped_files": 0,
                "uploaded_bytes": 0,
                "duration_ms": 0,
            }

        # 1. Base Remote Folder
        base_folder_id = self.get_or_create_remote_folder(settings.GDRIVE_REMOTE_BASE_PATH)

        # 2. Gather local files
        symbol_filter = normalize_symbol_name(symbol) if symbol else "*"
        local_files = sorted(list(self.lake_dir.glob(f"{symbol_filter}/*/*.parquet")))

        uploaded_count = 0
        skipped_count = 0
        failed_count = 0
        total_uploaded_bytes = 0
        file_results = []

        for local_file in local_files:
            rel_path = local_file.relative_to(self.lake_dir)
            rel_folder = str(rel_path.parent).replace("\\", "/")

            # Remote subfolder: e.g. "BTC-USD/2026"
            subfolder_id = self.get_or_create_remote_folder(rel_folder, parent_id=base_folder_id)

            # Check existing files in that folder
            remote_files_in_folder = self.list_remote_files(subfolder_id)
            existing_match = next((rf for rf in remote_files_in_folder if rf["name"] == local_file.name), None)

            try:
                upload_res = self.upload_parquet_file(local_file, subfolder_id, existing_match)
                file_results.append(upload_res)
                if upload_res["status"] == "uploaded":
                    uploaded_count += 1
                    total_uploaded_bytes += upload_res.get("size_bytes", 0)
                elif upload_res["status"] == "skipped":
                    skipped_count += 1
            except Exception as err:
                failed_count += 1
                file_results.append({
                    "file_name": local_file.name,
                    "status": "failed",
                    "error": str(err)
                })

        duration_sec = time.perf_counter() - start_time

        return {
            "status": "success",
            "remote_base_path": settings.GDRIVE_REMOTE_BASE_PATH,
            "total_local_files": len(local_files),
            "uploaded_files": uploaded_count,
            "skipped_files": skipped_count,
            "failed_files": failed_count,
            "uploaded_bytes": total_uploaded_bytes,
            "uploaded_mb": round(total_uploaded_bytes / (1024 * 1024), 2),
            "duration_sec": round(duration_sec, 2),
            "transfer_rate_mb_s": round(
                (total_uploaded_bytes / (1024 * 1024)) / duration_sec, 2
            ) if duration_sec > 0 and total_uploaded_bytes > 0 else 0.0,
            "file_details": file_results,
        }

    def get_sync_status(self) -> Dict[str, Any]:
        """
        Returns cloud synchronization health and partition parity summary.
        """
        all_local = list(self.lake_dir.glob("*/*/*.parquet"))
        local_total_bytes = sum(f.stat().st_size for f in all_local)

        return {
            "configured": self.is_configured(),
            "service_account_path": settings.GDRIVE_SERVICE_ACCOUNT_FILE,
            "remote_base_path": settings.GDRIVE_REMOTE_BASE_PATH,
            "local_lake_dir": str(self.lake_dir),
            "local_files_count": len(all_local),
            "local_total_bytes": local_total_bytes,
            "local_total_mb": round(local_total_bytes / (1024 * 1024), 2),
            "chunk_size_mb": settings.GDRIVE_CHUNK_SIZE_MB,
            "resumable_uploads_enabled": True,
            "md5_deduplication_enabled": True,
        }


# Singleton Instance
gdrive_sync_manager = GoogleDriveSyncManager()
