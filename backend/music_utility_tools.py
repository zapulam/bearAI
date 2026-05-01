"""
Small utility tools for the music agent (no external APIs).

Written by: zapulam
"""

import calendar
from datetime import datetime

from agents import function_tool


@function_tool()
def get_date_and_time() -> str:
    """Get the current local date and time (useful for tour date questions)."""
    today = datetime.now()
    date = today.strftime("%Y-%m-%d %H:%M:%S")
    weekday = calendar.day_name[today.weekday()]
    return f"{weekday}, {date}"
