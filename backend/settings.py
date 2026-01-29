"""
AI admin chat settings.

Written by: zapulam
"""

import json

from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    db_path: str
    docs_path: str


@lru_cache(maxsize=1)
def get_settings(
        config_file: str = "config.json",
    ) -> Settings:

    # Load config.json once
    with open(config_file, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    return Settings(
        db_path = cfg["db_path"],
        docs_path = cfg["docs_path"]
    )


# Convenience alias used by most modules
settings = get_settings()
