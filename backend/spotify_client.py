"""
Spotify Web API HTTP helpers (shared by tools and playlist execution).

Written by: zapulam
"""

import json
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

from repositories import ConnectionsRepository

SPOTIFY_API_BASE = "https://api.spotify.com/v1"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"


def _is_connection_enabled(connection_type: str) -> bool:
    repo = ConnectionsRepository()
    connection = repo.get_connection(connection_type)
    return bool(connection and connection.get("enabled"))


def _get_spotify_connection() -> Dict[str, Any]:
    repo = ConnectionsRepository()
    return repo.get_connection("spotify") or {}


def _refresh_spotify_access_token(connection: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    refresh_token = connection.get("refresh_token")
    client_id = connection.get("client_id")
    if not refresh_token or not client_id:
        return None, "Spotify refresh token is missing. Reconnect Spotify in Settings."
    response = requests.post(
        SPOTIFY_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
        },
        timeout=20,
    )
    if response.status_code >= 400:
        return None, "Spotify token refresh failed. Reconnect Spotify in Settings."
    payload = response.json()
    access_token = payload.get("access_token")
    expires_in = payload.get("expires_in")
    token_expires_at = int(time.time()) + int(expires_in or 0) if expires_in else None
    updated = {
        **connection,
        "connection_type": "spotify",
        "access_token": access_token,
        "token_expires_at": token_expires_at,
    }
    if payload.get("refresh_token"):
        updated["refresh_token"] = payload.get("refresh_token")
    repo = ConnectionsRepository()
    repo.upsert_connection(updated)
    return access_token, None


def get_spotify_access_token() -> Tuple[Optional[str], Optional[str]]:
    if not _is_connection_enabled("spotify"):
        return None, "Spotify connection is disabled. Enable it in Settings to use this tool."
    connection = _get_spotify_connection()
    if not connection or not connection.get("refresh_token"):
        return None, "Spotify is not connected. Use Settings to connect your account."
    access_token = connection.get("access_token")
    token_expires_at = connection.get("token_expires_at")
    if access_token and token_expires_at and int(token_expires_at) - 60 > int(time.time()):
        return access_token, None
    return _refresh_spotify_access_token(connection)


def spotify_request(
    method: str,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    json_body: Any = None,
    allow_retry: bool = True,
) -> Tuple[Optional[Any], Optional[str]]:
    token, error = get_spotify_access_token()
    if error:
        return None, error
    url = f"{SPOTIFY_API_BASE}{path}" if path.startswith("/") else f"{SPOTIFY_API_BASE}/{path}"
    headers: Dict[str, str] = {"Authorization": f"Bearer {token}"}
    if json_body is not None:
        headers["Content-Type"] = "application/json"
    response = requests.request(
        method,
        url,
        headers=headers,
        params=params,
        json=json_body,
        timeout=30,
    )
    if response.status_code == 401 and allow_retry:
        connection = _get_spotify_connection()
        refreshed_token, refresh_error = _refresh_spotify_access_token(connection)
        if refresh_error:
            return None, refresh_error
        headers = {"Authorization": f"Bearer {refreshed_token}"}
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        response = requests.request(
            method,
            url,
            headers=headers,
            params=params,
            json=json_body,
            timeout=30,
        )
    if response.status_code >= 400:
        try:
            detail = response.json()
        except Exception:
            detail = response.text
        return None, f"Spotify API request failed: {response.status_code} {detail}"
    if response.status_code in (204, 205) or not response.content:
        return None, None
    try:
        return response.json(), None
    except Exception:
        return None, "Spotify API returned non-JSON response."


def spotify_get(
    path: str,
    params: Optional[Dict[str, Any]] = None,
    allow_retry: bool = True,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    data, err = spotify_request("GET", path, params=params, allow_retry=allow_retry)
    if err:
        return None, err
    if data is None:
        return {}, None
    if not isinstance(data, dict):
        return None, "Unexpected Spotify response type."
    return data, None
