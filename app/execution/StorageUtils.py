"""
=========================================================
Datei:      app/execution/StorageUtils.py
Zweck:      Sicheres Schreiben von Parquet-Dateien
Knoten:     Jaune
=========================================================
"""
import os
import pyarrow.parquet as pq

def write_parquet_atomically(target_path: str, table) -> None:
    tmp_path = f"{target_path}.tmp"
    pq.write_table(table, tmp_path)
    os.replace(tmp_path, target_path)
