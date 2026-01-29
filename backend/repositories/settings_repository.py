from typing import Optional

from .db import get_connection


class SettingsRepository:
    _OPENAI_API_KEY = "openai_api_key"

    def get_openai_api_key(self) -> Optional[str]:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT setting_value
                FROM settings
                WHERE setting_key = ?
                """,
                (self._OPENAI_API_KEY,),
            )
            row = cursor.fetchone()
        return row[0] if row else None

    def set_openai_api_key(self, api_key: str) -> None:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO settings (setting_key, setting_value, created_at, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (self._OPENAI_API_KEY, api_key),
            )
            conn.commit()

    def clear_openai_api_key(self) -> None:
        with get_connection() as conn:
            conn.execute(
                """
                DELETE FROM settings
                WHERE setting_key = ?
                """,
                (self._OPENAI_API_KEY,),
            )
            conn.commit()
