"""Shared SQLite + env helpers for brain.py and watchdog.py.

WAL mode is mandatory: the Control App (Node) writes the same file concurrently.
Timestamps are ISO-8601 UTC strings with a trailing 'Z', matching the Node side.
"""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# repo root = parent of the directory holding this file (brain/ -> repo root).
REPO_ROOT = Path(__file__).resolve().parent.parent


def load_env() -> None:
    """Load <repo-root>/.env into os.environ without overriding existing vars.

    Prefers python-dotenv if installed; otherwise falls back to a tiny parser so
    this works even before the venv is fully provisioned.
    """
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return
    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(env_path, override=False)
        return
    except ImportError:
        pass
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key, val = key.strip(), val.strip()
        if (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            val = val[1:-1]
        os.environ.setdefault(key, val)


def resolve_db_path() -> Path:
    load_env()
    p = os.environ.get("DB_PATH", "db/fertigation.db")
    path = Path(p)
    return path if path.is_absolute() else (REPO_ROOT / path)


def connect() -> sqlite3.Connection:
    db_path = resolve_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_setting(conn: sqlite3.Connection, key: str, default: Optional[str] = None) -> Optional[str]:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row is not None else default


def get_fuzzy_config(conn: sqlite3.Connection) -> dict[str, float]:
    """Return the active fuzzy_config row as a dict ready for FuzzyConfig(**row)."""
    row = conn.execute("SELECT * FROM fuzzy_config WHERE id = 1").fetchone()
    if row is None:
        raise RuntimeError("fuzzy_config row (id=1) missing — run the seed script.")
    d = dict(row)
    d.pop("id", None)
    d.pop("updated_at", None)
    return d


def log_event(conn: sqlite3.Connection, level: str, event: str, detail: Any = None) -> None:
    conn.execute(
        "INSERT INTO event_log (ts, level, event, detail) VALUES (?, ?, ?, ?)",
        (now_iso(), level, event, None if detail is None else json.dumps(detail)),
    )
    conn.commit()
