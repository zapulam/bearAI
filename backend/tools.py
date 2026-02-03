"""
bearAI Internal Chat - agent tools.

Written by: zapulam
"""

import base64
import calendar
import json
import time
import requests

from agents import function_tool
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from email.message import EmailMessage
from langchain_community.vectorstores import SQLiteVec
from typing import Annotated, Any, Dict, Optional, Tuple, List

from repositories import ConnectionsRepository
from settings import settings


_openai_api_key = None
_client = None
_embeddings = None
_llm = None
_db = None

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1"
GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token"
OUTLOOK_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
OUTLOOK_TOKEN_URL_TEMPLATE = "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
SPOTIFY_API_BASE = "https://api.spotify.com/v1"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"

def _get_vector_db() -> SQLiteVec:
    """
    Get or initialize the help docs vector database.

    Args:
       - None

    Returns:
       - SQLiteVec: Vector database connection for help docs.
    """
    global _db
    if not _openai_api_key or _embeddings is None:
        raise RuntimeError("OpenAI API key not configured. Set it in Settings.")
    if _db is None:
        db_path = settings.docs_path
        if not db_path:
            raise RuntimeError("VECTOR_DB_PATH missing")
        connection = SQLiteVec.create_connection(db_file=db_path)
        _db = SQLiteVec(
            table="articles",
            connection=connection,
            embedding=_embeddings
        )
    return _db

def _is_connection_enabled(connection_type: str) -> bool:
    """
    Check if a connection is enabled in settings.

    Args:
       - connection_type (str): Connection key to check.

    Returns:
       - bool: True if enabled, otherwise False.
    """
    repo = ConnectionsRepository()
    connection = repo.get_connection(connection_type)
    return bool(connection and connection.get("enabled"))


# Gmail ---------------------------------------------------------------------------------------------------------------
def _get_gmail_connection() -> Dict[str, Any]:
    """
    Fetch the Gmail connection record.

    Args:
       - None

    Returns:
       - dict: Gmail connection data or empty dict.
    """
    repo = ConnectionsRepository()
    return repo.get_connection("gmail") or {}


def _refresh_gmail_access_token(connection: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """
    Refresh the Gmail access token and persist it.

    Args:
       - connection (dict): Gmail connection record.

    Returns:
       - tuple: (access_token, error_message).
    """
    refresh_token = connection.get("refresh_token")
    client_id = connection.get("client_id")
    client_secret = connection.get("client_secret")
    if not refresh_token or not client_id or not client_secret:
        return None, "Gmail credentials are missing. Reconnect Gmail in Settings."
    response = requests.post(
        GMAIL_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=20,
    )
    if response.status_code >= 400:
        return None, "Gmail token refresh failed. Reconnect Gmail in Settings."
    payload = response.json()
    access_token = payload.get("access_token")
    expires_in = payload.get("expires_in")
    token_expires_at = int(time.time()) + int(expires_in or 0) if expires_in else None
    updated = {
        **connection,
        "connection_type": "gmail",
        "access_token": access_token,
        "token_expires_at": token_expires_at,
    }
    repo = ConnectionsRepository()
    repo.upsert_connection(updated)
    return access_token, None


def _get_gmail_access_token() -> Tuple[Optional[str], Optional[str]]:
    """
    Resolve a valid Gmail access token, refreshing if needed.

    Args:
       - None

    Returns:
       - tuple: (access_token, error_message).
    """
    if not _is_connection_enabled("gmail"):
        return None, "Gmail connection is disabled. Enable it in Settings to use this tool."
    connection = _get_gmail_connection()
    if not connection or not connection.get("refresh_token"):
        return None, "Gmail is not connected. Reconnect Gmail in Settings."
    access_token = connection.get("access_token")
    token_expires_at = connection.get("token_expires_at")
    if access_token and token_expires_at and int(token_expires_at) - 60 > int(time.time()):
        return access_token, None
    return _refresh_gmail_access_token(connection)


def _gmail_get(
        path: str,
        params: Optional[Dict[str, Any]] = None,
        allow_retry: bool = True,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Perform a Gmail API GET request.

    Args:
       - path (str): Gmail API path.
       - params (dict | None): Query parameters.
       - allow_retry (bool): Whether to retry after refresh on 401.

    Returns:
       - tuple: (response_json, error_message).
    """
    token, error = _get_gmail_access_token()
    if error:
        return None, error
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{GMAIL_API_BASE}{path}", headers=headers, params=params, timeout=20)
    if response.status_code == 401 and allow_retry:
        connection = _get_gmail_connection()
        refreshed_token, refresh_error = _refresh_gmail_access_token(connection)
        if refresh_error:
            return None, refresh_error
        headers = {"Authorization": f"Bearer {refreshed_token}"}
        response = requests.get(f"{GMAIL_API_BASE}{path}", headers=headers, params=params, timeout=20)
    if response.status_code >= 400:
        return None, f"Gmail API request failed: {response.status_code}"
    return response.json(), None


@function_tool()
def gmail_search_messages(
        query: Annotated[str, "Search query for Gmail messages"],
    ) -> str:
    """
    Search Gmail messages using Gmail search syntax.

    Args:
       - query (str): Gmail search query.

    Returns:
       - str: JSON list of matching messages or an error message.
    """
    if not query or not query.strip():
        return "query is required."
    data, error = _gmail_get(
        "/users/me/messages",
        params={"q": query.strip(), "maxResults": 10},
    )
    if error:
        return error
    message_ids = data.get("messages", [])
    if not message_ids:
        return "No Gmail messages found for that query."
    results = []
    for message in message_ids[:10]:
        message_id = message.get("id")
        if not message_id:
            continue
        detail, detail_error = _gmail_get(
            f"/users/me/messages/{message_id}",
            params={"format": "metadata", "metadataHeaders": ["Subject", "From", "Date"]},
        )
        if detail_error:
            continue
        headers = {item.get("name"): item.get("value") for item in detail.get("payload", {}).get("headers", [])}
        results.append({
            "id": detail.get("id"),
            "thread_id": detail.get("threadId"),
            "subject": headers.get("Subject"),
            "from": headers.get("From"),
            "date": headers.get("Date"),
            "snippet": detail.get("snippet"),
        })
    return json.dumps(results, indent=2)


@function_tool()
def gmail_get_recent_emails(
        hours: Annotated[int, "Number of hours to look back"],
        max_results: Annotated[int, "Maximum number of messages to return"] = 10,
    ) -> str:
    """
    Fetch Gmail messages received within the past N hours.

    Args:
       - hours (int): Number of hours to look back.
       - max_results (int): Maximum number of messages to return.

    Returns:
       - str: JSON list of recent messages or an error message.
    """
    hours = int(hours)
    if hours <= 0:
        return "hours must be greater than 0."
    max_results = max(1, min(int(max_results), 50))
    query = f"newer_than:{hours}h"
    data, error = _gmail_get(
        "/users/me/messages",
        params={"q": query, "maxResults": max_results},
    )
    if error:
        return error
    message_ids = data.get("messages", [])
    if not message_ids:
        return "No Gmail messages found in that time range."
    results = []
    for message in message_ids[:max_results]:
        message_id = message.get("id")
        if not message_id:
            continue
        detail, detail_error = _gmail_get(
            f"/users/me/messages/{message_id}",
            params={"format": "metadata", "metadataHeaders": ["Subject", "From", "Date"]},
        )
        if detail_error:
            continue
        headers = {item.get("name"): item.get("value") for item in detail.get("payload", {}).get("headers", [])}
        results.append({
            "id": detail.get("id"),
            "thread_id": detail.get("threadId"),
            "subject": headers.get("Subject"),
            "from": headers.get("From"),
            "date": headers.get("Date"),
            "snippet": detail.get("snippet"),
        })
    return json.dumps(results, indent=2)


@function_tool()
def gmail_send_email(
        to: Annotated[str, "Recipient email address"],
        subject: Annotated[str, "Email subject"],
        body: Annotated[str, "Email body"],
    ) -> str:
    """
    Send an email through Gmail.

    Args:
       - to (str): Recipient email address.
       - subject (str): Email subject.
       - body (str): Email body.

    Returns:
       - str: JSON payload with message identifiers or an error message.
    """
    if not to or not to.strip():
        return "to is required."
    message = EmailMessage()
    profile, profile_error = _gmail_get("/users/me/profile")
    sender_email = None if profile_error else profile.get("emailAddress")
    if sender_email:
        message["From"] = sender_email
    message["To"] = to.strip()
    message["Subject"] = subject or ""
    message.set_content(body or "")
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
    payload = {"raw": raw}
    token, error = _get_gmail_access_token()
    if error:
        return error
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    response = requests.post(f"{GMAIL_API_BASE}/users/me/messages/send", headers=headers, json=payload, timeout=20)
    if response.status_code == 401:
        connection = _get_gmail_connection()
        refreshed_token, refresh_error = _refresh_gmail_access_token(connection)
        if refresh_error:
            return refresh_error
        headers = {"Authorization": f"Bearer {refreshed_token}", "Content-Type": "application/json"}
        response = requests.post(f"{GMAIL_API_BASE}/users/me/messages/send", headers=headers, json=payload, timeout=20)
    if response.status_code >= 400:
        return f"Gmail API request failed: {response.status_code}"
    data = response.json()
    return json.dumps(
        {"id": data.get("id"), "thread_id": data.get("threadId")},
        indent=2,
    )


# Outlook -------------------------------------------------------------------------------------------------------------
def _get_outlook_connection() -> Dict[str, Any]:
    """
    Fetch the Outlook connection record.

    Args:
       - None

    Returns:
       - dict: Outlook connection data or empty dict.
    """
    repo = ConnectionsRepository()
    return repo.get_connection("outlook") or {}


def _refresh_outlook_access_token(connection: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """
    Refresh the Outlook access token and persist it.

    Args:
       - connection (dict): Outlook connection record.

    Returns:
       - tuple: (access_token, error_message).
    """
    refresh_token = connection.get("refresh_token")
    client_id = connection.get("client_id")
    client_secret = connection.get("client_secret")
    tenant_id = connection.get("tenant_id")
    if not refresh_token or not client_id or not client_secret or not tenant_id:
        return None, "Outlook credentials are missing. Reconnect Outlook in Settings."
    response = requests.post(
        OUTLOOK_TOKEN_URL_TEMPLATE.format(tenant_id=tenant_id),
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=20,
    )
    if response.status_code >= 400:
        return None, "Outlook token refresh failed. Reconnect Outlook in Settings."
    payload = response.json()
    access_token = payload.get("access_token")
    expires_in = payload.get("expires_in")
    token_expires_at = int(time.time()) + int(expires_in or 0) if expires_in else None
    updated = {
        **connection,
        "connection_type": "outlook",
        "access_token": access_token,
        "token_expires_at": token_expires_at,
    }
    if payload.get("refresh_token"):
        updated["refresh_token"] = payload.get("refresh_token")
    repo = ConnectionsRepository()
    repo.upsert_connection(updated)
    return access_token, None


def _get_outlook_access_token() -> Tuple[Optional[str], Optional[str]]:
    """
    Resolve a valid Outlook access token, refreshing if needed.

    Args:
       - None

    Returns:
       - tuple: (access_token, error_message).
    """
    if not _is_connection_enabled("outlook"):
        return None, "Outlook connection is disabled. Enable it in Settings to use this tool."
    connection = _get_outlook_connection()
    if not connection or not connection.get("refresh_token"):
        return None, "Outlook is not connected. Reconnect Outlook in Settings."
    access_token = connection.get("access_token")
    token_expires_at = connection.get("token_expires_at")
    if access_token and token_expires_at and int(token_expires_at) - 60 > int(time.time()):
        return access_token, None
    return _refresh_outlook_access_token(connection)


@function_tool()
def outlook_search_messages(
        query: Annotated[str, "Search query for Outlook messages"],
    ) -> str:
    """
    Search Outlook messages via Microsoft Graph.

    Args:
       - query (str): Search query for Outlook messages.

    Returns:
       - str: JSON list of matching messages or an error message.
    """
    if not query or not query.strip():
        return "query is required."
    token, error = _get_outlook_access_token()
    if error:
        return error
    headers = {
        "Authorization": f"Bearer {token}",
        "ConsistencyLevel": "eventual",
    }
    params = {
        "$search": f"\"{query.strip()}\"",
        "$top": 10,
        "$select": "id,subject,from,receivedDateTime,bodyPreview",
    }
    response = requests.get(
        f"{OUTLOOK_GRAPH_BASE}/me/messages",
        headers=headers,
        params=params,
        timeout=20,
    )
    if response.status_code == 401:
        connection = _get_outlook_connection()
        refreshed_token, refresh_error = _refresh_outlook_access_token(connection)
        if refresh_error:
            return refresh_error
        headers["Authorization"] = f"Bearer {refreshed_token}"
        response = requests.get(
            f"{OUTLOOK_GRAPH_BASE}/me/messages",
            headers=headers,
            params=params,
            timeout=20,
        )
    if response.status_code >= 400:
        return f"Outlook API request failed: {response.status_code}"
    data = response.json()
    items = []
    for item in data.get("value", []):
        from_address = (item.get("from") or {}).get("emailAddress", {})
        items.append({
            "id": item.get("id"),
            "subject": item.get("subject"),
            "from": from_address.get("address"),
            "received_at": item.get("receivedDateTime"),
            "preview": item.get("bodyPreview"),
        })
    return json.dumps(items, indent=2)


@function_tool()
def outlook_get_recent_emails(
        hours: Annotated[int, "Number of hours to look back"],
        max_results: Annotated[int, "Maximum number of messages to return"] = 10,
    ) -> str:
    """
    Fetch Outlook messages received within the past N hours.

    Args:
       - hours (int): Number of hours to look back.
       - max_results (int): Maximum number of messages to return.

    Returns:
       - str: JSON list of recent messages or an error message.
    """
    hours = int(hours)
    if hours <= 0:
        return "hours must be greater than 0."
    max_results = max(1, min(int(max_results), 50))
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    cutoff_iso = cutoff.replace(microsecond=0).isoformat() + "Z"
    token, error = _get_outlook_access_token()
    if error:
        return error
    headers = {
        "Authorization": f"Bearer {token}",
        "ConsistencyLevel": "eventual",
    }
    params = {
        "$filter": f"receivedDateTime ge {cutoff_iso}",
        "$top": max_results,
        "$select": "id,subject,from,receivedDateTime,bodyPreview",
        "$orderby": "receivedDateTime desc",
    }
    response = requests.get(
        f"{OUTLOOK_GRAPH_BASE}/me/messages",
        headers=headers,
        params=params,
        timeout=20,
    )
    if response.status_code == 401:
        connection = _get_outlook_connection()
        refreshed_token, refresh_error = _refresh_outlook_access_token(connection)
        if refresh_error:
            return refresh_error
        headers["Authorization"] = f"Bearer {refreshed_token}"
        response = requests.get(
            f"{OUTLOOK_GRAPH_BASE}/me/messages",
            headers=headers,
            params=params,
            timeout=20,
        )
    if response.status_code >= 400:
        return f"Outlook API request failed: {response.status_code}"
    data = response.json()
    items = []
    for item in data.get("value", []):
        from_address = (item.get("from") or {}).get("emailAddress", {})
        items.append({
            "id": item.get("id"),
            "subject": item.get("subject"),
            "from": from_address.get("address"),
            "received_at": item.get("receivedDateTime"),
            "preview": item.get("bodyPreview"),
        })
    return json.dumps(items, indent=2)


@function_tool()
def outlook_send_email(
        to: Annotated[str, "Recipient email address"],
        subject: Annotated[str, "Email subject"],
        body: Annotated[str, "Email body"],
    ) -> str:
    """
    Send an email through Outlook via Microsoft Graph.

    Args:
       - to (str): Recipient email address.
       - subject (str): Email subject.
       - body (str): Email body.

    Returns:
       - str: Confirmation string or an error message.
    """
    if not to or not to.strip():
        return "to is required."
    payload = {
        "message": {
            "subject": subject or "",
            "body": {
                "contentType": "Text",
                "content": body or "",
            },
            "toRecipients": [
                {"emailAddress": {"address": to.strip()}}
            ],
        },
        "saveToSentItems": True,
    }
    token, error = _get_outlook_access_token()
    if error:
        return error
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    response = requests.post(f"{OUTLOOK_GRAPH_BASE}/me/sendMail", headers=headers, json=payload, timeout=20)
    if response.status_code == 401:
        connection = _get_outlook_connection()
        refreshed_token, refresh_error = _refresh_outlook_access_token(connection)
        if refresh_error:
            return refresh_error
        headers = {"Authorization": f"Bearer {refreshed_token}", "Content-Type": "application/json"}
        response = requests.post(
            f"{OUTLOOK_GRAPH_BASE}/me/sendMail",
            headers=headers,
            json=payload,
            timeout=20,
        )
    if response.status_code >= 400:
        return f"Outlook API request failed: {response.status_code}"
    return "Outlook email sent."


# Spotify ---------------------------------------------------------------------------------------------------------------
def _get_spotify_connection() -> Dict[str, Any]:
    """
    Fetch the Spotify connection record.

    Args:
       - None

    Returns:
       - dict: Spotify connection data or empty dict.
    """
    repo = ConnectionsRepository()
    return repo.get_connection("spotify") or {}


def _refresh_spotify_access_token(connection: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """
    Refresh the Spotify access token and persist it.

    Args:
       - connection (dict): Spotify connection record.

    Returns:
       - tuple: (access_token, error_message).
    """
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


def _get_spotify_access_token() -> Tuple[Optional[str], Optional[str]]:
    """
    Resolve a valid Spotify access token, refreshing if needed.

    Args:
       - None

    Returns:
       - tuple: (access_token, error_message).
    """
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


def _spotify_get(
        path: str,
        params: Optional[Dict[str, Any]] = None,
        allow_retry: bool = True,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Perform a Spotify API GET request.

    Args:
       - path (str): Spotify API path.
       - params (dict | None): Query parameters.
       - allow_retry (bool): Whether to retry after refresh on 401.

    Returns:
       - tuple: (response_json, error_message).
    """
    token, error = _get_spotify_access_token()
    if error:
        return None, error
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{SPOTIFY_API_BASE}{path}", headers=headers, params=params, timeout=20)
    if response.status_code == 401 and allow_retry:
        connection = _get_spotify_connection()
        refreshed_token, refresh_error = _refresh_spotify_access_token(connection)
        if refresh_error:
            return None, refresh_error
        headers = {"Authorization": f"Bearer {refreshed_token}"}
        response = requests.get(f"{SPOTIFY_API_BASE}{path}", headers=headers, params=params, timeout=20)
    if response.status_code >= 400:
        return None, f"Spotify API request failed: {response.status_code}"
    return response.json(), None


@function_tool()
def spotify_get_profile() -> str:
    """
    Get the current Spotify profile.

    Args:
       - None

    Returns:
       - str: JSON profile data or an error message.
    """
    data, error = _spotify_get("/me")
    if error:
        return error
    profile = {
        "id": data.get("id"),
        "display_name": data.get("display_name"),
        "email": data.get("email"),
        "country": data.get("country"),
        "product": data.get("product"),
        "followers": (data.get("followers") or {}).get("total"),
    }
    return json.dumps(profile, indent=2)


@function_tool()
def spotify_get_top_items(
        item_type: Annotated[str, "Type of items: artists or tracks"],
        limit: Annotated[int, "Number of items to return (1-50)"] = 20,
        time_range: Annotated[str, "short_term, medium_term, or long_term"] = "medium_term",
    ) -> str:
    """
    Get the user's top artists or tracks.

    Args:
       - item_type (str): Type of items: artists or tracks.
       - limit (int): Number of items to return (1-50).
       - time_range (str): short_term, medium_term, or long_term.

    Returns:
       - str: JSON list of top items or an error message.
    """
    if item_type not in {"artists", "tracks"}:
        return "item_type must be 'artists' or 'tracks'."
    limit = max(1, min(int(limit), 50))
    data, error = _spotify_get(f"/me/top/{item_type}", params={"limit": limit, "time_range": time_range})
    if error:
        return error
    items = []
    for item in data.get("items", []):
        if item_type == "artists":
            items.append({
                "id": item.get("id"),
                "name": item.get("name"),
                "genres": item.get("genres", []),
                "popularity": item.get("popularity"),
            })
        else:
            items.append({
                "id": item.get("id"),
                "name": item.get("name"),
                "artists": [artist.get("name") for artist in item.get("artists", [])],
                "album": (item.get("album") or {}).get("name"),
                "popularity": item.get("popularity"),
            })
    return json.dumps(items, indent=2)


@function_tool()
def spotify_get_recommendations(
        seed_artists: Annotated[Optional[List[str]], "List of seed artist IDs"] = None,
        seed_tracks: Annotated[Optional[List[str]], "List of seed track IDs"] = None,
        seed_genres: Annotated[Optional[List[str]], "List of seed genres"] = None,
        limit: Annotated[int, "Number of recommendations (1-100)"] = 20,
    ) -> str:
    """
    Get track recommendations based on seed artists, tracks, or genres.

    Args:
       - seed_artists (list[str] | None): List of seed artist IDs.
       - seed_tracks (list[str] | None): List of seed track IDs.
       - seed_genres (list[str] | None): List of seed genres.
       - limit (int): Number of recommendations (1-100).

    Returns:
       - str: JSON list of recommended tracks or an error message.
    """
    limit = max(1, min(int(limit), 100))
    seed_artists = seed_artists or []
    seed_tracks = seed_tracks or []
    seed_genres = seed_genres or []
    if not seed_artists and not seed_tracks and not seed_genres:
        top_artists, error = _spotify_get("/me/top/artists", params={"limit": 2, "time_range": "medium_term"})
        if error:
            return error
        top_tracks, error = _spotify_get("/me/top/tracks", params={"limit": 3, "time_range": "medium_term"})
        if error:
            return error
        seed_artists = [item.get("id") for item in top_artists.get("items", []) if item.get("id")]
        seed_tracks = [item.get("id") for item in top_tracks.get("items", []) if item.get("id")]
        seed_artists = seed_artists[:2]
        seed_tracks = seed_tracks[:3]
    if len(seed_artists) + len(seed_tracks) + len(seed_genres) > 5:
        return "Provide at most 5 combined seeds across artists, tracks, and genres."
    params = {
        "limit": limit,
        "seed_artists": ",".join(seed_artists) if seed_artists else None,
        "seed_tracks": ",".join(seed_tracks) if seed_tracks else None,
        "seed_genres": ",".join(seed_genres) if seed_genres else None,
    }
    data, error = _spotify_get("/recommendations", params={k: v for k, v in params.items() if v})
    if error:
        return error
    recommendations = [
        {
            "id": track.get("id"),
            "name": track.get("name"),
            "artists": [artist.get("name") for artist in track.get("artists", [])],
            "album": (track.get("album") or {}).get("name"),
            "uri": track.get("uri"),
        }
        for track in data.get("tracks", [])
    ]
    return json.dumps(recommendations, indent=2)


@function_tool()
def spotify_get_audio_analysis(
        track_id: Annotated[str, "Spotify track ID"],
    ) -> str:
    """
    Get audio analysis for a track.

    Args:
       - track_id (str): Spotify track ID.

    Returns:
       - str: JSON audio analysis data or an error message.
    """
    if not track_id or not track_id.strip():
        return "track_id is required."
    data, error = _spotify_get(f"/audio-analysis/{track_id.strip()}")
    if error:
        return error
    track_info = data.get("track", {})
    analysis = {
        "duration": track_info.get("duration"),
        "tempo": track_info.get("tempo"),
        "key": track_info.get("key"),
        "mode": track_info.get("mode"),
        "time_signature": track_info.get("time_signature"),
        "loudness": track_info.get("loudness"),
    }
    return json.dumps(analysis, indent=2)


@function_tool()
def spotify_get_new_releases(
        artist_limit: Annotated[int, "Number of top artists to check (1-20)"] = 5,
    ) -> str:
    """
    Get the latest releases from the user's top artists.

    Args:
       - artist_limit (int): Number of top artists to check (1-20).

    Returns:
       - str: JSON list of new releases or an error message.
    """
    artist_limit = max(1, min(int(artist_limit), 20))
    top_artists, error = _spotify_get("/me/top/artists", params={"limit": artist_limit, "time_range": "medium_term"})
    if error:
        return error
    releases = []
    for artist in top_artists.get("items", []):
        artist_id = artist.get("id")
        if not artist_id:
            continue
        albums, error = _spotify_get(
            f"/artists/{artist_id}/albums",
            params={"include_groups": "album,single", "limit": 1, "market": "US"},
        )
        if error:
            return error
        items = albums.get("items", [])
        if not items:
            continue
        latest = items[0]
        releases.append({
            "artist": artist.get("name"),
            "album": latest.get("name"),
            "release_date": latest.get("release_date"),
            "uri": latest.get("uri"),
        })
    return json.dumps(releases, indent=2)


@function_tool()
def spotify_get_genre_seeds() -> str:
    """
    Get available genre seeds for recommendations.

    Args:
       - None

    Returns:
       - str: JSON list of genre seeds or an error message.
    """
    data, error = _spotify_get("/recommendations/available-genre-seeds")
    if error:
        return error
    return json.dumps(data.get("genres", []), indent=2)


# General tools
@function_tool()
def get_date_and_time():
    """
    Gets the current date and time.

    Args:
       - None

    Returns:
       - str: Formatted date and time string.
    """
    today = datetime.now()
    date = today.strftime("%Y-%m-%d %H:%M:%S")
    weekday = calendar.day_name[today.weekday()]
    return f"{weekday}, {date}"


@function_tool()
def scrape_website(
        domain: Annotated[str, "The webpage domain to scrape"],
    ) -> str:
    """
    Scrape a webpage and extract info using optional CSS selectors.

    Args:
       - domain (str): The webpage domain to scrape.

    Returns:
       - str: Formatted string with page title, metadata, and extracted content.
    """
    try:
        response = requests.get(f"https://{domain}", headers={"User-Agent": "Mozilla/5.0"})
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

        title = soup.title.string.strip() if soup.title and soup.title.string else "No title found"
        meta_desc = soup.find("meta", attrs={"name": "description"})
        meta_kw = soup.find("meta", attrs={"name": "keywords"})

        meta_description = meta_desc["content"].strip() if meta_desc and meta_desc.get("content") else "No meta description found"
        meta_keywords = meta_kw["content"].strip() if meta_kw and meta_kw.get("content") else "No meta keywords found"

        # Extract headings and paragraphs
        headings = [el.get_text(strip=True) for el in soup.select("h1, h2, h3")]
        paragraphs = [el.get_text(strip=True) for el in soup.select("article p, main p, div[class*='content'] p")]

        formatted_output = [
            f"URL: https://{domain}",
            f"Title: {title}",
            f"Meta Description: {meta_description}",
            f"Meta Keywords: {meta_keywords}",
            "\nHeadings:",
            "\n".join(f"  - {h}" for h in headings) if headings else "  None found",
            "\nMain Content:",
            "\n".join(f"  {p}" for p in paragraphs) if paragraphs else "  None found",
        ]

        return "\n".join(formatted_output)

    except requests.RequestException as e:
        return f"Error fetching {domain}: {e}"


@function_tool()
def search_help_docs(
        query: Annotated[str, "The search query to find relevant help documentation"]
    ) -> str:
    """
    Search the help docs vector database.

    Args:
       - query (str): The search query to find relevant help documentation.

    Returns:
       - str: Formatted search results with article titles, URLs, and relevant content excerpts.
    """
    
    db = _get_vector_db()
    results = db.similarity_search_with_score(query, k=15)
    results = [(doc, score) for doc, score in results]
    
    if not results:
        return "No relevant help documentation found for this query."
    
    # Format results
    formatted_results = ["Found relevant help documentation:\n"]
    
    for idx, item in enumerate(results, 1):
        doc, score = item
        title = doc.metadata.get('title', 'Untitled')
        url = doc.metadata.get('url', 'N/A')
        collection = doc.metadata.get('collection', 'Unknown')
        content_preview = doc.page_content[:400].strip()
        
        formatted_results.append(f"\n{idx}. {title}")
        formatted_results.append(f"   Collection: {collection}")
        formatted_results.append(f"   URL: {url}")
        formatted_results.append(f"   Relevance Score: {score:.4f}")
        formatted_results.append(f"   Content: {content_preview}...")
        formatted_results.append("")
    
    return "\n".join(formatted_results)
