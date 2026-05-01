"""
Spotify playlist proposal tool (no direct writes; user approves in UI).

Written by: zapulam
"""

import json
from typing import Annotated, List

from agents import function_tool

from music_context import current_conversation_id
from repositories import PendingActionsRepository


@function_tool()
def propose_spotify_playlist(
    name: Annotated[str, "Playlist title visible in Spotify"],
    track_uris: Annotated[
        List[str],
        "Spotify track URIs in order, e.g. spotify:track:xxx (max 100 per creation batch)",
    ],
    description: Annotated[str, "Optional playlist description"] = "",
    is_public: Annotated[bool, "If true, playlist is public"] = False,
) -> str:
    """
    Stage a new Spotify playlist for user approval. Does NOT create the playlist
    on Spotify. Returns a pending_action_id; the user must approve in the app
    before any write occurs.
    """
    conversation_id = current_conversation_id.get()
    if not conversation_id:
        return "Internal error: missing conversation id for playlist proposal."
    n = (name or "").strip()
    if not n:
        return "Playlist name is required."
    uris = [u.strip() for u in (track_uris or []) if u and str(u).strip()]
    if not uris:
        return "At least one spotify:track:… URI is required."
    for u in uris:
        if not u.startswith("spotify:track:"):
            return f"Invalid track URI (must start with spotify:track:): {u[:40]}…"
    if len(uris) > 100:
        return "At most 100 tracks per approved action; shorten the list or split into multiple proposals."

    repo = PendingActionsRepository()
    row = repo.create_pending(
        conversation_id=conversation_id,
        action_type="spotify_create_playlist",
        payload={
            "name": n,
            "description": (description or "").strip(),
            "is_public": bool(is_public),
            "track_uris": uris,
        },
    )
    if not row:
        return "Failed to store playlist proposal."
    out = {
        "pending_action_id": row["id"],
        "name": n,
        "track_count": len(uris),
        "is_public": bool(is_public),
        "message": (
            "Proposal saved. Ask the user to review and click Approve in the "
            "chat to create this playlist on Spotify (or reject to cancel)."
        ),
    }
    return json.dumps(out, indent=2)
