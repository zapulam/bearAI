"""
SQLite persistence for user-approved actions (e.g. Spotify playlist creation).

Written by: zapulam
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .db import get_connection

_PENDING_TTL_HOURS = 24


class PendingActionsRepository:
    def create_pending(
        self,
        conversation_id: str,
        action_type: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        action_id = str(uuid.uuid4())
        expires = (
            datetime.now(timezone.utc) + timedelta(hours=_PENDING_TTL_HOURS)
        ).isoformat()
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO pending_actions (
                    id, conversation_id, action_type, payload, status, created_at, expires_at
                )
                VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, ?)
                """,
                (
                    action_id,
                    conversation_id,
                    action_type,
                    json.dumps(payload),
                    expires,
                ),
            )
            conn.commit()
        return self.get_by_id(action_id)  # type: ignore

    def get_by_id(self, action_id: str) -> Optional[Dict[str, Any]]:
        with get_connection() as conn:
            cur = conn.execute(
                """
                SELECT id, conversation_id, action_type, payload, status, created_at, expires_at
                FROM pending_actions
                WHERE id = ?
                """,
                (action_id,),
            )
            row = cur.fetchone()
        return self._row_to_dict(row) if row else None

    def list_for_conversation(
        self,
        conversation_id: str,
        status: str = "pending",
    ) -> List[Dict[str, Any]]:
        with get_connection() as conn:
            cur = conn.execute(
                """
                SELECT id, conversation_id, action_type, payload, status, created_at, expires_at
                FROM pending_actions
                WHERE conversation_id = ? AND status = ?
                ORDER BY created_at DESC
                """,
                (conversation_id, status),
            )
            rows = cur.fetchall()
        return [self._row_to_dict(r) for r in rows if r]

    def set_status(self, action_id: str, status: str) -> bool:
        with get_connection() as conn:
            cur = conn.execute(
                """
                UPDATE pending_actions
                SET status = ?
                WHERE id = ?
                """,
                (status, action_id),
            )
            conn.commit()
            return cur.rowcount > 0

    def _row_to_dict(self, row) -> Dict[str, Any]:
        return {
            "id": row[0],
            "conversation_id": row[1],
            "action_type": row[2],
            "payload": json.loads(row[3]) if row[3] else {},
            "status": row[4],
            "created_at": row[5],
            "expires_at": row[6],
        }
