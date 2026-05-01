"""
Execute an approved Spotify playlist creation (server-side only).

Written by: zapulam
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from spotify_client import spotify_get, spotify_request


def pending_action_is_expired(expires_at: Optional[str]) -> bool:
    if not expires_at:
        return False
    try:
        if str(expires_at).endswith("Z"):
            exp = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        else:
            exp = datetime.fromisoformat(str(expires_at))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) > exp
    except Exception:
        return False


def execute_spotify_create_playlist(
    payload: Dict[str, Any],
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    name = (payload.get("name") or "").strip()
    uris = payload.get("track_uris") or []
    if not name:
        return None, "Missing playlist name"
    if not uris or not isinstance(uris, list):
        return None, "Missing track_uris"
    is_public = bool(payload.get("is_public"))
    description = (payload.get("description") or "").strip()

    me, err = spotify_get("/me")
    if err or not me:
        return None, err or "Failed to load Spotify profile"
    user_id = me.get("id")
    if not user_id:
        return None, "Spotify user id missing"

    body = {
        "name": name,
        "public": is_public,
        "description": description,
    }
    pl, err2 = spotify_request(
        "POST",
        f"/users/{user_id}/playlists",
        json_body=body,
    )
    if err2:
        return None, err2
    if not isinstance(pl, dict):
        return None, "Unexpected playlist response"
    playlist_id = pl.get("id")
    if not playlist_id:
        return None, "No playlist id in response"
    # Spotify allows adding up to 100 per request; we enforce that at proposal
    add_body = {"uris": uris}
    _, err3 = spotify_request(
        "POST",
        f"/playlists/{playlist_id}/tracks",
        json_body=add_body,
    )
    if err3:
        return None, f"Playlist created but failed to add tracks: {err3}"
    return {
        "playlist_id": playlist_id,
        "name": pl.get("name") or name,
        "uri": pl.get("uri"),
        "external_urls": pl.get("external_urls"),
    }, None
