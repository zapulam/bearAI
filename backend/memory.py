"""
bearAI Internal Chat - memory objects and functions.

Written by: zapulam
"""

import asyncio
import json
import os
import sqlite3
import threading

from typing import Any, Dict, List, Optional

from agents import Agent
from agents.items import TResponseInputItem
from agents.memory.session import SessionABC
from dotenv import load_dotenv
from pathlib import Path

from settings import settings

DB_PATH = settings.db_path


def initialize_sqlite_db(
        db_path: str | Path,
        sessions_table: str = "sessions",
        messages_table: str = "messages",
    ) -> None:
    """
    Initialize the SQLite database schema at application startup.
    """
    db_path = Path(db_path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS "{sessions_table}" (
            session_id TEXT PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            current_agent TEXT NOT NULL DEFAULT 'Triage Agent',
            summary TEXT DEFAULT NULL
        )
    """
    )
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {messages_table} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            message_data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES {sessions_table} (session_id)
                ON DELETE CASCADE
        )
    """
    )
    conn.execute(
        f"""
        CREATE INDEX IF NOT EXISTS idx_{messages_table}_session_id
        ON {messages_table} (session_id, created_at)
    """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS connections (
            connection_type TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 0,
            base_url TEXT,
            email TEXT,
            api_token TEXT,
            client_id TEXT,
            client_secret TEXT,
            refresh_token TEXT,
            tenant_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.commit()
    conn.close()


class SQLiteSession(SessionABC):
    """SQLite-based implementation of session storage.

    This implementation stores conversation history in a SQLite database.
    By default, uses an in-memory database that is lost when the process ends.
    For persistent storage, provide a file path.
    """

    def __init__(
            self,
            session_id: str,
            db_path: str | Path,
            sessions_table: str = "sessions",
            messages_table: str = "messages",
        ):
        """
        Initialize the SQLite session.

        Args:
            session_id: Unique identifier for the conversation session
            db_path: Path to the SQLite database file.
            sessions_table: Name of the table to store session metadata. Defaults to
                'sessions'
            messages_table: Name of the table to store message data. Defaults to
                'messages'
        """
        self.session_id = session_id
        self.db_path = db_path
        self.sessions_table = sessions_table
        self.messages_table = messages_table
        self._local = threading.local()
        self._lock = threading.Lock()

        # Ensure per-session seed (uses this instance's connection)
        self._ensure_session_initialized(self._get_connection())


    def _get_connection(self) -> sqlite3.Connection:
        """
        Get a database connection.
        """
        # Use thread-local connections for file databases
        if not hasattr(self._local, "connection"):
            self._local.connection = sqlite3.connect(
                str(self.db_path),
                check_same_thread=False,
            )
            self._local.connection.execute("PRAGMA journal_mode=WAL")
        assert isinstance(self._local.connection, sqlite3.Connection), (
            f"Expected sqlite3.Connection, got {type(self._local.connection)}"
        )
        return self._local.connection


    def _ensure_session_initialized(
            self,
            conn: sqlite3.Connection
        ) -> None:
        """Ensure session row exists and seed initial system message once per session."""
        # Initialize 
        conn.execute(
            f"""
            INSERT OR IGNORE INTO {self.sessions_table} (session_id)
            VALUES (?)
            """,
            (self.session_id,),
        )

        conn.commit()

    async def get_agent_state(
            self,
            agent_name_to_obj: Dict[str, Agent],
            default_agent: Agent,
        ) -> Agent:
        """
        Get agent state from the session database.
        
        Args:
            agent_name_to_obj: Dictionary mapping agent names to agent instances.
            default_agent: Default agent to use if no agent is found in the session.
            
        Returns:
            tuple: Containing:
                - The agent instance (from agent_name_to_obj or default_agent)
        """
        def _get_agent_state_sync():
            conn = self._get_connection()
            cur = conn.execute(
                f"SELECT current_agent FROM {self.sessions_table} WHERE session_id = ?",
                (self.session_id,),
            )
            row = cur.fetchone()
            
            if row is None:
                # Session doesn't exist yet, use defaults
                return default_agent
            
            agent_key = row
            agent = agent_name_to_obj.get(agent_key or "", default_agent)
            
            return agent
        
        return await asyncio.to_thread(_get_agent_state_sync)


    async def get_items(
                self,
                limit: int | None = None
            ) -> list[TResponseInputItem]:
        """
        Retrieve the conversation history for this session.

        Args:
            limit: Maximum number of items to retrieve. If None, retrieves all items.
                   When specified, returns the latest N items in chronological order.

        Returns:
            list: Input items representing the conversation history
        """

        def _get_items_sync():
            conn = self._get_connection()
            with self._lock:
                if limit is None:
                    # Fetch all items in chronological order
                    cursor = conn.execute(
                        f"""
                        SELECT message_data FROM {self.messages_table}
                        WHERE session_id = ?
                        ORDER BY created_at ASC
                    """,
                        (self.session_id,),
                    )
                else:
                    # Fetch the latest N items in chronological order
                    cursor = conn.execute(
                        f"""
                        SELECT message_data FROM {self.messages_table}
                        WHERE session_id = ?
                        ORDER BY created_at DESC
                        LIMIT ?
                        """,
                        (self.session_id, limit),
                    )

                rows = cursor.fetchall()

                # Reverse to get chronological order when using DESC
                if limit is not None:
                    rows = list(reversed(rows))

                items = []
                for (message_data,) in rows:
                    try:
                        item = json.loads(message_data)
                        items.append(item)
                    except json.JSONDecodeError:
                        # Skip invalid JSON entries
                        continue

                return items

        return await asyncio.to_thread(_get_items_sync)


    async def add_items(
            self,
            items: list[TResponseInputItem]
        ) -> None:
        """
        Add new items to the conversation history.

        Args:
            items: List of input items to add to the history
        """
        if not items:
            return

        def _add_items_sync():
            conn = self._get_connection()

            with self._lock:
                # Ensure session exists
                conn.execute(
                    f"""
                    INSERT OR IGNORE INTO {self.sessions_table} (session_id) VALUES (?)
                """,
                    (self.session_id,),
                )

                # Add items
                message_data = [(self.session_id, json.dumps(item)) for item in items]
                conn.executemany(
                    f"""
                    INSERT INTO {self.messages_table} (session_id, message_data) VALUES (?, ?)
                """,
                    message_data,
                )

                # Update session timestamp
                conn.execute(
                    f"""
                    UPDATE {self.sessions_table}
                    SET updated_at = CURRENT_TIMESTAMP
                    WHERE session_id = ?
                """,
                    (self.session_id,),
                )

                conn.commit()

        await asyncio.to_thread(_add_items_sync)


    async def pop_item(self) -> TResponseInputItem | None:
        """Remove and return the most recent item from the session.

        Returns:
            TResponseInputItem: The most recent item if it exists, None if the session is empty
        """

        def _pop_item_sync():
            conn = self._get_connection()
            with self._lock:
                # Use DELETE with RETURNING to atomically delete and return the most recent item
                cursor = conn.execute(
                    f"""
                    DELETE FROM {self.messages_table}
                    WHERE id = (
                        SELECT id FROM {self.messages_table}
                        WHERE session_id = ?
                        ORDER BY created_at DESC
                        LIMIT 1
                    )
                    RETURNING message_data
                    """,
                    (self.session_id,),
                )

                result = cursor.fetchone()
                conn.commit()

                if result:
                    message_data = result[0]
                    try:
                        item = json.loads(message_data)
                        return item
                    except json.JSONDecodeError:
                        # Return None for corrupted JSON entries (already deleted)
                        return None

                return None

        return await asyncio.to_thread(_pop_item_sync)


    async def clear_session(self) -> None:
        """Clear all items for this session."""

        def _clear_session_sync():
            conn = self._get_connection()
            with self._lock:
                conn.execute(
                    f"DELETE FROM {self.messages_table} WHERE session_id = ?",
                    (self.session_id,),
                )
                conn.execute(
                    f"DELETE FROM {self.sessions_table} WHERE session_id = ?",
                    (self.session_id,),
                )
                conn.commit()

        await asyncio.to_thread(_clear_session_sync)


    def close(self) -> None:
        """Close the database connection."""
        if hasattr(self._local, "connection"):
            self._local.connection.close()


# Create Session and Load State -----------------------------------------------------------------------------------------------------------
async def create_session_and_load_state(
        conversation_id: str
    ) -> SQLiteSession:
    """
    Create or load session and load agent state in a single optimized operation.
    
    This function creates a SQLite session.
    
    Args:
        conversation_id: Session id provided by the frontend.

    Returns:
        SQLiteSession: The session object.
    """
    session = SQLiteSession(
        conversation_id,
        DB_PATH
    )
    return session


# Get Conversations -----------------------------------------------------------------------------------------------------------------------
async def get_conversations() -> List[Dict[str, Any]]:
    """
    Retrieve all conversations.
    
    Args:
    Returns:
        list[dict]: List of conversation dictionaries with conversation_id, summary, created_at, updated_at.
    """
    def _fetch_conversations() -> List[Dict[str, Any]]:
        with sqlite3.connect(DB_PATH, check_same_thread=False) as conn:
            cursor = conn.execute(
                """
                SELECT session_id, summary, created_at, updated_at
                FROM sessions
                ORDER BY updated_at DESC
                """,
            )
            rows = cursor.fetchall()

            conversations = []
            for row in rows:
                conversations.append({
                    "conversation_id": row[0],
                    "summary": row[1],
                    "created_at": row[2],
                    "updated_at": row[3],
                })

            return conversations

    return await asyncio.to_thread(_fetch_conversations)


# Get Messages for Conversation -----------------------------------------------------------------------------------------------------------
async def get_conversation_messages(
        conversation_id: str,
    ) -> List[Dict[str, Any]]:
    """
    Retrieve all messages for a specific conversation.
    
    Args:
        conversation_id: The conversation/session ID to load messages for.
    Returns:
        list[dict]: List of message dictionaries in chronological order.
    """
    def _fetch_messages() -> List[Dict[str, Any]]:
        with sqlite3.connect(DB_PATH, check_same_thread=False) as conn:
            cursor = conn.execute(
                """
                SELECT message_data, created_at
                FROM messages
                WHERE session_id = ?
                ORDER BY created_at ASC
                """,
                (conversation_id,),
            )
            rows = cursor.fetchall()

            messages = []
            for row in rows:
                try:
                    message_data = json.loads(row[0])
                    messages.append({
                        "data": message_data,
                        "created_at": row[1],
                    })
                except json.JSONDecodeError:
                    continue

            return messages

    return await asyncio.to_thread(_fetch_messages)


# Update Session Summary ------------------------------------------------------------------------------------------------------------------
async def update_session_summary(
        conversation_id: str,
        summary: str,
    ) -> None:
    """
    Update the summary for a conversation session.
    
    Args:
        conversation_id: The conversation/session ID.
        summary: The summary text to store.
        
    """
    def _update_summary() -> None:
        with sqlite3.connect(DB_PATH, check_same_thread=False) as conn:
            conn.execute("PRAGMA journal_mode=WAL")

            cursor = conn.execute(
                "SELECT 1 FROM sessions WHERE session_id = ?",
                (conversation_id,),
            )
            row = cursor.fetchone()

            if row is None:
                raise RuntimeError(f"Session {conversation_id} not found")

            conn.execute(
                """
                UPDATE sessions
                SET summary = ?,
                    updated_at = datetime('now')
                WHERE session_id = ?
                """,
                (summary, conversation_id),
            )
            conn.commit()

    await asyncio.to_thread(_update_summary)


# Check for Session Summary ---------------------------------------------------------------------------------------------------------------
async def get_session_has_summary(
        conversation_id: str,
    ) -> bool:
    """
    Check if a session already has a summary.
    
    Args:
        conversation_id: The conversation/session ID.
        
    Returns:
        bool: True if the session has a summary, False otherwise.
        
    """
    def _has_summary() -> bool:
        with sqlite3.connect(DB_PATH, check_same_thread=False) as conn:
            cursor = conn.execute(
                "SELECT summary FROM sessions WHERE session_id = ?",
                (conversation_id,),
            )
            row = cursor.fetchone()
            return row is not None and row[0] is not None and row[0] != ""

    return await asyncio.to_thread(_has_summary)


