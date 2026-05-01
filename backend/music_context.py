"""
Request-scoped context for agent tools (e.g. current chat session id).

Written by: zapulam
"""

from contextvars import ContextVar
from typing import Optional

current_conversation_id: ContextVar[Optional[str]] = ContextVar(
    "current_conversation_id", default=None
)
