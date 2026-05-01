"""
Spotify Web API read tools for the music agent.

Written by: zapulam
"""

import json
from typing import Annotated, List, Optional

from agents import function_tool

from spotify_client import spotify_get


def _extract_spotify_id(value: str, expected_type: str) -> str:
    """Accept a raw Spotify id, spotify URI, or open.spotify.com URL."""
    raw = (value or "").strip()
    if not raw:
        return ""
    uri_prefix = f"spotify:{expected_type}:"
    if raw.startswith(uri_prefix):
        return raw.split(":")[-1]
    if "open.spotify.com" in raw:
        path = raw.split("?", 1)[0].rstrip("/")
        parts = path.split("/")
        if expected_type in parts:
            idx = parts.index(expected_type)
            if idx + 1 < len(parts):
                return parts[idx + 1]
    return raw


def _compact_track(track: dict) -> dict:
    if not isinstance(track, dict):
        return {}
    album = track.get("album") or {}
    return {
        "id": track.get("id"),
        "name": track.get("name"),
        "artists": [
            {"id": a.get("id"), "name": a.get("name")}
            for a in track.get("artists", [])
            if isinstance(a, dict)
        ],
        "album": {
            "id": album.get("id"),
            "name": album.get("name"),
            "release_date": album.get("release_date"),
        },
        "uri": track.get("uri"),
        "duration_ms": track.get("duration_ms"),
        "popularity": track.get("popularity"),
        "explicit": track.get("explicit"),
    }


@function_tool()
def spotify_get_profile() -> str:
    """Get the current Spotify profile (no email in output for privacy)."""
    data, error = spotify_get("/me")
    if error:
        return error
    profile = {
        "id": data.get("id"),
        "display_name": data.get("display_name"),
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
    """Get the user's top artists or tracks."""
    if item_type not in {"artists", "tracks"}:
        return "item_type must be 'artists' or 'tracks'."
    limit = max(1, min(int(limit), 50))
    data, error = spotify_get(f"/me/top/{item_type}", params={"limit": limit, "time_range": time_range})
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
                "artists": [a.get("name") for a in item.get("artists", [])],
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
    """Get track recommendations based on seed artists, tracks, or genres."""
    limit = max(1, min(int(limit), 100))
    seed_artists = seed_artists or []
    seed_tracks = seed_tracks or []
    seed_genres = seed_genres or []
    if not seed_artists and not seed_tracks and not seed_genres:
        top_artists, error = spotify_get("/me/top/artists", params={"limit": 2, "time_range": "medium_term"})
        if error:
            return error
        top_tracks, error = spotify_get("/me/top/tracks", params={"limit": 3, "time_range": "medium_term"})
        if error:
            return error
        seed_artists = [i.get("id") for i in top_artists.get("items", []) if i.get("id")]
        seed_tracks = [i.get("id") for i in top_tracks.get("items", []) if i.get("id")]
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
    data, error = spotify_get("/recommendations", params={k: v for k, v in params.items() if v})
    if error:
        return error
    recommendations = [
        {
            "id": t.get("id"),
            "name": t.get("name"),
            "artists": [a.get("name") for a in t.get("artists", [])],
            "album": (t.get("album") or {}).get("name"),
            "uri": t.get("uri"),
        }
        for t in data.get("tracks", [])
    ]
    return json.dumps(recommendations, indent=2)


@function_tool()
def spotify_get_audio_analysis(track_id: Annotated[str, "Spotify track ID"]) -> str:
    """Get simplified audio analysis for a track."""
    if not track_id or not track_id.strip():
        return "track_id is required."
    data, error = spotify_get(f"/audio-analysis/{track_id.strip()}")
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
    """Get the latest album/single release from each of the user's top artists."""
    artist_limit = max(1, min(int(artist_limit), 20))
    top_artists, error = spotify_get("/me/top/artists", params={"limit": artist_limit, "time_range": "medium_term"})
    if error:
        return error
    releases = []
    for artist in top_artists.get("items", []):
        artist_id = artist.get("id")
        if not artist_id:
            continue
        albums, error = spotify_get(
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
    """Get available genre seeds for the recommendations endpoint."""
    data, error = spotify_get("/recommendations/available-genre-seeds")
    if error:
        return error
    return json.dumps(data.get("genres", []), indent=2)


@function_tool()
def spotify_search(
    query: Annotated[str, "Search query"],
    types: Annotated[str, "Comma-separated: track, artist, album, playlist"] = "track,artist",
    limit: Annotated[int, "Per type (1-50)"] = 10,
) -> str:
    """Search tracks, artists, albums, and playlists on Spotify."""
    if not query or not query.strip():
        return "query is required."
    limit = max(1, min(int(limit), 50))
    data, error = spotify_get(
        "/search",
        params={"q": query.strip(), "type": types.replace(" ", ""), "limit": limit},
    )
    if error:
        return error
    return json.dumps(data, indent=2)


@function_tool()
def spotify_get_artist(
    artist_id: Annotated[str, "Spotify artist ID"],
) -> str:
    """Get public metadata for a Spotify artist."""
    artist_id = _extract_spotify_id(artist_id, "artist")
    if not artist_id:
        return "artist_id is required."
    data, error = spotify_get(f"/artists/{artist_id}")
    if error:
        return error
    compact = {
        "id": data.get("id"),
        "name": data.get("name"),
        "genres": data.get("genres", []),
        "popularity": data.get("popularity"),
        "followers": (data.get("followers") or {}).get("total"),
    }
    return json.dumps(compact, indent=2)


@function_tool()
def spotify_get_related_artists(artist_id: Annotated[str, "Spotify artist ID"]) -> str:
    """Get artists similar to the given artist."""
    artist_id = _extract_spotify_id(artist_id, "artist")
    if not artist_id:
        return "artist_id is required."
    data, error = spotify_get(f"/artists/{artist_id}/related-artists")
    if error:
        return error
    items = [
        {"id": a.get("id"), "name": a.get("name"), "genres": a.get("genres", [])}
        for a in data.get("artists", [])
    ]
    return json.dumps(items, indent=2)


@function_tool()
def spotify_get_artist_top_tracks(
    artist_id: Annotated[str, "Spotify artist ID, artist URI, or artist URL"],
    market: Annotated[str, "ISO country code for availability, e.g. US"] = "US",
) -> str:
    """Get an artist's current top tracks in a market."""
    artist_id = _extract_spotify_id(artist_id, "artist")
    if not artist_id:
        return "artist_id is required."
    market = (market or "US").strip().upper()
    data, error = spotify_get(f"/artists/{artist_id}/top-tracks", params={"market": market})
    if error:
        return error
    tracks = [_compact_track(t) for t in data.get("tracks", []) if isinstance(t, dict)]
    return json.dumps(tracks, indent=2)


@function_tool()
def spotify_get_track(
    track_id: Annotated[str, "Spotify track ID"],
) -> str:
    """Get full track object (single track)."""
    track_id = _extract_spotify_id(track_id, "track")
    if not track_id:
        return "track_id is required."
    data, error = spotify_get(f"/tracks/{track_id}")
    if error:
        return error
    return json.dumps(
        {
            "id": data.get("id"),
            "name": data.get("name"),
            "artists": [a.get("name") for a in data.get("artists", [])],
            "album": (data.get("album") or {}).get("name"),
            "uri": data.get("uri"),
            "popularity": data.get("popularity"),
        },
        indent=2,
    )


@function_tool()
def spotify_get_tracks_audio_features(
    track_ids: Annotated[List[str], "List of Spotify track IDs (max 100)"],
) -> str:
    """Get audio features (tempo, energy, danceability, etc.) for up to 100 tracks."""
    if not track_ids:
        return "track_ids is required."
    ids = [t.strip() for t in track_ids if t and str(t).strip()][:100]
    if not ids:
        return "No valid track IDs."
    data, error = spotify_get("/audio-features", params={"ids": ",".join(ids)})
    if error:
        return error
    return json.dumps(data.get("audio_features", data), indent=2)


@function_tool()
def spotify_get_saved_tracks(
    limit: Annotated[int, "Number of items (1-50)"] = 20,
    offset: Annotated[int, "Offset for pagination"] = 0,
) -> str:
    """Get the user's saved/liked tracks (requires Spotify library scope)."""
    limit = max(1, min(int(limit), 50))
    offset = max(0, int(offset))
    data, error = spotify_get("/me/tracks", params={"limit": limit, "offset": offset})
    if error:
        return error
    out = []
    for item in data.get("items", []):
        track = item.get("track") or {}
        if not track:
            continue
        out.append({
            "id": track.get("id"),
            "name": track.get("name"),
            "artists": [a.get("name") for a in track.get("artists", [])],
            "uri": track.get("uri"),
            "added_at": item.get("added_at"),
        })
    return json.dumps(out, indent=2)


@function_tool()
def spotify_get_recently_played(
    limit: Annotated[int, "Number of recently played tracks (1-50)"] = 20,
) -> str:
    """Get the user's recently played Spotify tracks."""
    limit = max(1, min(int(limit), 50))
    data, error = spotify_get("/me/player/recently-played", params={"limit": limit})
    if error:
        return error
    out = []
    for item in data.get("items", []):
        if not isinstance(item, dict):
            continue
        track = _compact_track(item.get("track") or {})
        if not track.get("id") and not track.get("name"):
            continue
        track["played_at"] = item.get("played_at")
        context = item.get("context") or {}
        if isinstance(context, dict) and context:
            track["context"] = {
                "type": context.get("type"),
                "uri": context.get("uri"),
            }
        out.append(track)
    return json.dumps(out, indent=2)


@function_tool()
def spotify_get_user_playlists(
    limit: Annotated[int, "Number of playlists (1-50)"] = 20,
    offset: Annotated[int, "Offset for pagination"] = 0,
) -> str:
    """List the user's Spotify playlists."""
    limit = max(1, min(int(limit), 50))
    offset = max(0, int(offset))
    data, error = spotify_get("/me/playlists", params={"limit": limit, "offset": offset})
    if error:
        return error
    playlists = []
    for item in data.get("items", []):
        if not isinstance(item, dict):
            continue
        owner = item.get("owner") or {}
        tracks = item.get("tracks") or {}
        playlists.append({
            "id": item.get("id"),
            "name": item.get("name"),
            "description": item.get("description"),
            "owner": owner.get("display_name") or owner.get("id"),
            "public": item.get("public"),
            "collaborative": item.get("collaborative"),
            "track_count": tracks.get("total"),
            "uri": item.get("uri"),
        })
    return json.dumps(
        {
            "total": data.get("total"),
            "limit": limit,
            "offset": offset,
            "items": playlists,
        },
        indent=2,
    )


@function_tool()
def spotify_get_playlist_tracks(
    playlist_id: Annotated[str, "Spotify playlist ID, playlist URI, or playlist URL"],
    limit: Annotated[int, "Number of tracks (1-100)"] = 50,
    offset: Annotated[int, "Offset for pagination"] = 0,
) -> str:
    """Get tracks from one Spotify playlist."""
    playlist_id = _extract_spotify_id(playlist_id, "playlist")
    if not playlist_id:
        return "playlist_id is required."
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))
    data, error = spotify_get(
        f"/playlists/{playlist_id}/tracks",
        params={
            "limit": limit,
            "offset": offset,
            "fields": (
                "total,next,items(added_at,track(id,name,artists(id,name),"
                "album(id,name,release_date),uri,duration_ms,popularity,explicit))"
            ),
        },
    )
    if error:
        return error
    tracks = []
    for item in data.get("items", []):
        if not isinstance(item, dict):
            continue
        track = _compact_track(item.get("track") or {})
        if track.get("id") or track.get("name"):
            track["added_at"] = item.get("added_at")
            tracks.append(track)
    return json.dumps(
        {
            "total": data.get("total"),
            "limit": limit,
            "offset": offset,
            "items": tracks,
        },
        indent=2,
    )
