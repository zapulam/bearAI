"""
DB config

Written by: zapulam
"""

import sqlite3

from contextlib import contextmanager
from pathlib import Path

try:
    from settings import settings
except ModuleNotFoundError:  # Allow running as a package.
    from backend.settings import settings


def get_db_path() -> str:
    db_path = settings.db_path
    if not db_path:
        raise RuntimeError("SESSION_DB_PATH not configured")
    return str(Path(db_path))


@contextmanager
def get_connection():
    conn = sqlite3.connect(get_db_path(), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
    finally:
        conn.close()
