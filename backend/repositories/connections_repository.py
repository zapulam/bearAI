from typing import Any, Dict, List, Optional

from .db import get_connection


class ConnectionsRepository:
    def list_connections(self) -> List[Dict[str, Any]]:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT
                    connection_type,
                    enabled,
                    base_url,
                    email,
                    api_token,
                    client_id,
                    client_secret,
                    refresh_token,
                    tenant_id,
                    created_at,
                    updated_at
                FROM connections
                ORDER BY connection_type ASC
                """
            )
            rows = cursor.fetchall()
        return [self._row_to_dict(row) for row in rows]

    def get_connection(self, connection_type: str) -> Optional[Dict[str, Any]]:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT
                    connection_type,
                    enabled,
                    base_url,
                    email,
                    api_token,
                    client_id,
                    client_secret,
                    refresh_token,
                    tenant_id,
                    created_at,
                    updated_at
                FROM connections
                WHERE connection_type = ?
                """,
                (connection_type,),
            )
            row = cursor.fetchone()
        return self._row_to_dict(row) if row else None

    def upsert_connection(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO connections (
                    connection_type,
                    enabled,
                    base_url,
                    email,
                    api_token,
                    client_id,
                    client_secret,
                    refresh_token,
                    tenant_id,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(connection_type) DO UPDATE SET
                    enabled = excluded.enabled,
                    base_url = excluded.base_url,
                    email = excluded.email,
                    api_token = excluded.api_token,
                    client_id = excluded.client_id,
                    client_secret = excluded.client_secret,
                    refresh_token = excluded.refresh_token,
                    tenant_id = excluded.tenant_id,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    payload.get("connection_type"),
                    1 if payload.get("enabled") else 0,
                    payload.get("base_url"),
                    payload.get("email"),
                    payload.get("api_token"),
                    payload.get("client_id"),
                    payload.get("client_secret"),
                    payload.get("refresh_token"),
                    payload.get("tenant_id"),
                ),
            )
            conn.commit()
        return self.get_connection(payload.get("connection_type"))

    def set_enabled(self, connection_type: str, enabled: bool) -> Optional[Dict[str, Any]]:
        with get_connection() as conn:
            conn.execute(
                """
                UPDATE connections
                SET enabled = ?, updated_at = CURRENT_TIMESTAMP
                WHERE connection_type = ?
                """,
                (1 if enabled else 0, connection_type),
            )
            conn.commit()
        return self.get_connection(connection_type)

    def _row_to_dict(self, row) -> Dict[str, Any]:
        return {
            "connection_type": row[0],
            "enabled": bool(row[1]),
            "base_url": row[2],
            "email": row[3],
            "api_token": row[4],
            "client_id": row[5],
            "client_secret": row[6],
            "refresh_token": row[7],
            "tenant_id": row[8],
            "created_at": row[9],
            "updated_at": row[10],
        }
