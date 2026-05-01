"""
Bands in Town read tools (artist, events, event detail, search).

Written by: zapulam
"""

import json
from typing import Annotated, Any, List, Optional

from agents import function_tool

from bandsintown_client import artist_by_id_path, artist_path_token, bit_get


def _event_compact(raw: Any) -> dict:
    if not isinstance(raw, dict):
        return {}
    offers = raw.get("offers") or []
    if isinstance(offers, list) and offers:
        offers = [
            {
                "type": o.get("type"),
                "status": o.get("status"),
                "url": o.get("url"),
            }
            for o in offers
            if isinstance(o, dict)
        ]
    venue = raw.get("venue") or {}
    vdict = None
    if isinstance(venue, dict):
        vdict = {
            "name": venue.get("name"),
            "city": venue.get("city"),
            "region": venue.get("region"),
            "country": venue.get("country"),
        }
    return {
        "id": raw.get("id"),
        "title": raw.get("title") or raw.get("artist", {}).get("name"),
        "datetime": raw.get("datetime"),
        "on_sale_datetime": raw.get("on_sale_datetime"),
        "url": raw.get("url"),
        "lineup": raw.get("lineup"),
        "venue": vdict,
        "offers": offers,
    }


@function_tool()
def bit_get_artist(
    artist_name: Annotated[str, "Band or artist name as fans would search (e.g. 'Coldplay')"],
) -> str:
    """
    Get Bands in Town public profile: tracker count, image URL, and artist page link.
    """
    token = artist_path_token(artist_name)
    if not token:
        return "artist_name is required."
    data, err = bit_get(f"/artists/{token}")
    if err:
        return err
    if not isinstance(data, dict):
        return json.dumps(data, indent=2)
    out = {
        "id": data.get("id"),
        "name": data.get("name"),
        "url": data.get("url"),
        "image_url": data.get("image_url"),
        "thumb_url": data.get("thumb_url"),
        "tracker_count": data.get("tracker_count"),
        "upcoming_event_count": data.get("upcoming_event_count"),
    }
    return json.dumps(out, indent=2)


@function_tool()
def bit_get_artist_by_id(
    artist_id: Annotated[str, "Bands in Town artist id (numeric) or with id_ prefix"],
) -> str:
    """Get artist profile by Bands in Town id."""
    path = artist_by_id_path(artist_id)
    if not path:
        return "artist_id is required."
    data, err = bit_get(path)
    if err:
        return err
    if not isinstance(data, dict):
        return json.dumps(data, indent=2)
    return json.dumps(
        {
            "id": data.get("id"),
            "name": data.get("name"),
            "url": data.get("url"),
            "image_url": data.get("image_url"),
            "tracker_count": data.get("tracker_count"),
        },
        indent=2,
    )


@function_tool()
def bit_get_artist_events(
    artist_name: Annotated[str, "Band or artist name"],
    date: Annotated[
        Optional[str],
        'upcoming, past, all, or "YYYY-MM-DD,YYYY-MM-DD" range. Default upcoming.',
    ] = "upcoming",
) -> str:
    """
    List events for an artist. Each item includes venue and ticket offers (OfferData) when available.
    """
    token = artist_path_token(artist_name)
    if not token:
        return "artist_name is required."
    params: dict = {}
    if date and str(date).strip():
        params["date"] = str(date).strip()
    data, err = bit_get(f"/artists/{token}/events", params=params or None)
    if err:
        return err
    if not isinstance(data, list):
        return json.dumps(data, indent=2)
    compact = [_event_compact(x) for x in data if isinstance(x, dict)]
    return json.dumps(compact, indent=2)


@function_tool()
def bit_get_event(
    event_id: Annotated[str, "Bands in Town event id (number or string)"],
) -> str:
    """Get a single event by id (EventData + venue + offers)."""
    eid = (event_id or "").strip()
    if not eid:
        return "event_id is required."
    data, err = bit_get(f"/events/{eid}")
    if err:
        return err
    if isinstance(data, dict):
        return json.dumps(_event_compact(data) | {
            "description": data.get("description"),
        }, indent=2)
    return json.dumps(data, indent=2)


@function_tool()
def bit_search_events(
    location: Annotated[str, 'City, region, or "lat,long" (see Bands in Town spec)'],
    radius: Annotated[Optional[str], "Search radius (e.g. 50)"] = None,
    date: Annotated[Optional[str], "upcoming, past, all, or date range"] = "upcoming",
) -> str:
    """
    Search events by location. Useful for "shows near me" or in a given city.
    """
    if not (location or "").strip():
        return "location is required."
    params: dict = {"location": location.strip()}
    if date and str(date).strip():
        params["date"] = str(date).strip()
    if radius and str(radius).strip():
        params["radius"] = str(radius).strip()
    data, err = bit_get("/events", params=params)
    if err:
        return err
    if not isinstance(data, list):
        return json.dumps(data, indent=2)
    compact = [_event_compact(x) for x in data if isinstance(x, dict)]
    return json.dumps(compact[:30], indent=2)
