"""
Bands in Town Public API v3 request helpers (read-only).

Written by: zapulam
"""

import json
from typing import Any, Dict, Optional, Tuple
from urllib.parse import quote

import requests

from repositories import ConnectionsRepository

BIT_API_BASE = "https://rest.bandsintown.com"


def get_bit_app_id() -> Tuple[Optional[str], Optional[str]]:
    repo = ConnectionsRepository()
    conn = repo.get_connection("bandsintown") or {}
    if not conn.get("enabled"):
        return None, "Bands in Town is disabled. Enable it in Settings and set your app_id."
    app_id = (conn.get("client_id") or "").strip()
    if not app_id:
        return None, "Bands in Town app_id is missing. Add it in Settings (see Bands in Town for Developers)."
    return app_id, None


def bit_get(
    path: str,
    params: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[Any], Optional[str]]:
    app_id, err = get_bit_app_id()
    if err:
        return None, err
    merged = {**(params or {}), "app_id": app_id}
    if not path.startswith("/"):
        path = "/" + path
    url = f"{BIT_API_BASE}{path}"
    try:
        response = requests.get(url, params=merged, timeout=25, headers={"Accept": "application/json"})
    except requests.RequestException as e:
        return None, f"Bands in Town request failed: {e}"
    if response.status_code >= 400:
        return None, f"Bands in Town API error: {response.status_code}"
    try:
        return response.json(), None
    except Exception:
        return None, "Bands in Town returned non-JSON body."


def artist_path_token(artist_name: str) -> str:
    """Path segment for /artists/{token} (encode special characters per BIT docs)."""
    s = (artist_name or "").strip()
    if not s:
        return ""
    return quote(s, safe="")


def artist_by_id_path(artist_id: str) -> str:
    a = (artist_id or "").strip()
    if not a:
        return ""
    if a.startswith("id_"):
        return f"/artists/{a}"
    return f"/artists/id_{a}"


__all__ = [
    "BIT_API_BASE",
    "artist_by_id_path",
    "artist_path_token",
    "bit_get",
    "get_bit_app_id",
]
