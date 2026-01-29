"""
Stream parsing functionality for OpenAI RunResult and structured output.

Written by zapulam
"""

from agents.stream_events import AgentUpdatedStreamEvent, RawResponsesStreamEvent, RunItemStreamEvent
from dataclasses import dataclass
from openai.types.responses.response_text_delta_event import ResponseTextDeltaEvent
from pydantic import BaseModel
from typing import Any, Literal


# SSE Event Models (for chat streaming) ---------------------------------------------------------------------------------------------------
class ChatChunkEvent(BaseModel):
    """
    SSE chunk event during streaming for thought or response content.
    """
    type: Literal["thought", "response"]
    content: str


class ChatToolInput(BaseModel):
    """
    SSE tool input event when a tool is called from an agent.
    """
    type: Literal["tool_call"]
    tool_name: str
    content: Any


class ChatToolOutput(BaseModel):
    """
    SSE tool output event when a tool completes execution.
    """
    type: Literal["tool_output"]
    tool_name: str
    content: Any


class ChatComplete(BaseModel):
    """
    SSE complete event when streaming finishes.
    """
    type: Literal["complete"]
    conversation_id: str
    thought: str
    response: str
    status: str


class ChatError(BaseModel):
    """
    SSE error event when an error occurs during chat generation.
    """
    type: Literal["error"]
    content: str


async def stream_result_events(result):
    """
    Stream events from a RunResult and yield formatted chunks.
    
    Args:
        result: The RunResult from Runner.run_streamed
        
    Yields:
        dict: Formatted event chunks with type and content
    """
    async for event in result.stream_events():
        # Check most common type first for performance
        if isinstance(event, RawResponsesStreamEvent):
            if isinstance(event.data, ResponseTextDeltaEvent):
                delta = event.data.delta
                yield {
                    "type": "chunk",
                    "content": delta
                }
        elif isinstance(event, RunItemStreamEvent):
            if event.item.type == "tool_call_item":
                tool_name = event.item.raw_item.name
                tool_args = event.item.raw_item.arguments if hasattr(event.item.raw_item, 'arguments') else {}
                yield {
                    "type": "tool_call",
                    "content": tool_name,
                    "arguments": tool_args
                }
            elif event.item.type == "tool_call_output_item":
                yield {
                    "type": "tool_output",
                    "content": event.item.output
                }
        elif isinstance(event, AgentUpdatedStreamEvent):
            yield {
                "type": "agent_update",
                "content": event.new_agent.name
            }


@dataclass(frozen=True)
class StructuredStreamEvent:
    """
    Incremental parsed content event from a structured assistant JSON output.
    """
    field: Literal["thought", "response"]
    text: str


class StructuredOutputStreamParser:
    """
    Streaming parser for assistant outputs shaped like:
        {"thought":"...","response":"...","status":"complete"}

    This parser is robust to arbitrary streaming delta boundaries and supports
    JSON escape sequences inside string values (e.g. \\n, \\\", \\\\).
    """

    _ESCAPE_MAP: dict[str, str] = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
    }

    def __init__(self, max_tail: int = 256) -> None:
        self._max_tail = max_tail
        self.reset()


    def reset(self) -> None:
        self._buf = ""
        self._state = "seek_thought_key"
        self._escaped = False
        self._current_field: Literal["thought", "response"] | None = None

        self.thought = ""
        self.response = ""
        self.thought_done = False
        self.response_done = False


    def feed(self, delta: str) -> list[StructuredStreamEvent]:
        if not delta or self._state == "done":
            return []

        self._buf += delta
        out: list[StructuredStreamEvent] = []

        while True:
            if self._state == "seek_thought_key":
                if self._seek_key("thought") is None:
                    return out
                self._state = "seek_thought_value"

            elif self._state == "seek_thought_value":
                if self._seek_string_value_start() is None:
                    return out
                self._current_field = "thought"
                self._escaped = False
                self._state = "in_string"

            elif self._state == "seek_response_key":
                if self._seek_key("response") is None:
                    return out
                self._state = "seek_response_value"

            elif self._state == "seek_response_value":
                if self._seek_string_value_start() is None:
                    return out
                self._current_field = "response"
                self._escaped = False
                self._state = "in_string"

            elif self._state == "in_string":
                field = self._current_field
                if field is None:
                    # Defensive: should never happen.
                    self._state = "done"
                    return out

                chunk_text, done = self._consume_string_chars()
                if chunk_text:
                    if field == "thought":
                        self.thought += chunk_text
                    else:
                        self.response += chunk_text
                    out.append(StructuredStreamEvent(field=field, text=chunk_text))

                if not done:
                    return out

                if field == "thought":
                    self.thought_done = True
                    self._state = "seek_response_key"
                else:
                    self.response_done = True
                    self._state = "done"
                    return out

            elif self._state == "done":
                return out


    def _seek_key(self, key: str) -> int | None:
        needle = f"\"{key}\""
        idx = self._buf.find(needle)
        if idx == -1:
            self._buf = self._buf[-self._max_tail :]
            return None
        self._buf = self._buf[idx + len(needle) :]
        return idx


    def _seek_string_value_start(self) -> int | None:
        """
        Move buffer to the first character *inside* the opening quote of the value.
        Returns None if not enough buffer yet.
        """
        colon = self._buf.find(":")
        if colon == -1:
            self._buf = self._buf[-self._max_tail :]
            return None

        j = colon + 1
        while j < len(self._buf) and self._buf[j] in " \t\r\n":
            j += 1
        if j >= len(self._buf):
            self._buf = self._buf[-self._max_tail :]
            return None

        if self._buf[j] != '"':
            # We only support JSON string values for thought/response.
            self._buf = self._buf[-self._max_tail :]
            return None

        # Consume up to and including the opening quote.
        self._buf = self._buf[j + 1 :]
        return j


    def _consume_string_chars(self) -> tuple[str, bool]:
        """
        Consume as much of the current JSON string value as possible.
        Returns:
            (text, done)
        - text: decoded text chunk to emit (may be empty)
        - done: True if we hit the closing quote of the string
        """
        if not self._buf:
            return "", False

        emitted: list[str] = []
        i = 0
        while i < len(self._buf):
            ch = self._buf[i]
            i += 1

            if self._escaped:
                emitted.append(self._ESCAPE_MAP.get(ch, ch))
                self._escaped = False
                continue

            if ch == "\\":
                self._escaped = True
                continue

            if ch == '"':
                # Closing quote reached: drop it and keep remainder in buffer.
                self._buf = self._buf[i:]
                return "".join(emitted), True

            emitted.append(ch)

        # Consumed entire buffer without finishing the string.
        self._buf = ""
        return "".join(emitted), False
