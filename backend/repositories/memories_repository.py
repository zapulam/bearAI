from typing import Any, Dict, List, Optional

from .db import get_connection


class MemoriesRepository:
    def list_memories(self) -> List[Dict[str, Any]]:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, category, content, created_at, updated_at
                FROM memories
                ORDER BY updated_at DESC, id DESC
                """
            )
            rows = cursor.fetchall()
        return [self._row_to_dict(row) for row in rows]

    def create_memory(self, category: Optional[str], content: str) -> Dict[str, Any]:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO memories (category, content, created_at, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                (category, content),
            )
            conn.commit()
            memory_id = cursor.lastrowid
        return self.get_memory(memory_id)

    def update_memory(self, memory_id: int, category: Optional[str], content: str) -> Optional[Dict[str, Any]]:
        with get_connection() as conn:
            conn.execute(
                """
                UPDATE memories
                SET category = ?, content = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (category, content, memory_id),
            )
            conn.commit()
        return self.get_memory(memory_id)

    def delete_memory(self, memory_id: int) -> bool:
        with get_connection() as conn:
            cursor = conn.execute(
                "DELETE FROM memories WHERE id = ?",
                (memory_id,),
            )
            conn.commit()
            return cursor.rowcount > 0

    def get_memory(self, memory_id: int) -> Optional[Dict[str, Any]]:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, category, content, created_at, updated_at
                FROM memories
                WHERE id = ?
                """,
                (memory_id,),
            )
            row = cursor.fetchone()
        return self._row_to_dict(row) if row else None

    def _row_to_dict(self, row) -> Dict[str, Any]:
        return {
            "id": row[0],
            "category": row[1],
            "content": row[2],
            "created_at": row[3],
            "updated_at": row[4],
        }
