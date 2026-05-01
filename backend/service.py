"""
bearAI — music agent chat service.

Written by: zapulam
"""

from contextlib import contextmanager
from dataclasses import dataclass
import json
from typing import AsyncGenerator

from agents import (
    Agent,
    ModelSettings,
    RunConfig,
    Runner,
    WebSearchTool,
)
from agents.extensions.handoff_prompt import RECOMMENDED_PROMPT_PREFIX
from openai import AsyncOpenAI
from openai.types.shared import Reasoning

from bandsintown_tools import (
    bit_get_artist,
    bit_get_artist_by_id,
    bit_get_artist_events,
    bit_get_event,
    bit_search_events,
)
from memory import create_session_and_load_state, get_session_has_summary, update_session_summary
from music_context import current_conversation_id
from music_utility_tools import get_date_and_time
from models import Output
from prompts import TRIAGE_PROMPT
from repositories import ConnectionsRepository, MemoriesRepository
from spotify_playlist_tools import propose_spotify_playlist
from spotify_tools import (
    spotify_get_artist,
    spotify_get_artist_top_tracks,
    spotify_get_audio_analysis,
    spotify_get_genre_seeds,
    spotify_get_new_releases,
    spotify_get_playlist_tracks,
    spotify_get_profile,
    spotify_get_recently_played,
    spotify_get_recommendations,
    spotify_get_related_artists,
    spotify_get_saved_tracks,
    spotify_get_top_items,
    spotify_get_track,
    spotify_get_tracks_audio_features,
    spotify_get_user_playlists,
    spotify_search,
)
from streaming import stream_result_events


@contextmanager
def _conversation_id_scope(conversation_id: str):
    token = current_conversation_id.set(conversation_id)
    try:
        yield
    finally:
        current_conversation_id.reset(token)


@dataclass
class ChatService:
    client: AsyncOpenAI
    model: str = "gpt-5-mini"
    summary_model: str = "gpt-5-nano"

    def __post_init__(self) -> None:
        self.base_tools: list = [WebSearchTool()]

    def _get_enabled_connections(self) -> set[str]:
        repo = ConnectionsRepository()
        enabled = set()
        for connection in repo.list_connections():
            if connection.get("enabled"):
                enabled.add(connection.get("connection_type"))
        return enabled

    def _extract_response_for_summary(self, accumulated_text: str) -> str:
        try:
            parsed = json.loads(accumulated_text)
        except Exception:
            return accumulated_text
        if isinstance(parsed, dict):
            response = parsed.get("response")
            if isinstance(response, str) and response.strip():
                return response.strip()
        return accumulated_text

    def _fallback_summary(self, user_input: str, assistant_response: str) -> str:
        text = " ".join((user_input or assistant_response or "Untitled chat").split())
        if len(text) <= 48:
            return text
        return text[:45].rstrip() + "..."

    async def generate_summary(self, user_input: str, assistant_response: str) -> str:
        system_prompt = """Generate a very brief summary (4-6 words max) of this conversation topic.
            The summary should capture the main intent or question from the user.
            Do not include phrases like "User asked about" or "Conversation about".
            Just provide a direct, concise description."""

        input_text = f"""User: {user_input}
            Assistant: {assistant_response}"""

        response = await self.client.responses.create(
            model=self.summary_model,
            instructions=system_prompt,
            input=input_text,
            max_output_tokens=50,
        )

        output_text = getattr(response, "output_text", None)
        if isinstance(output_text, str) and output_text.strip():
            return output_text.strip()

        output_items = getattr(response, "output", []) or []
        for item in output_items:
            content_items = getattr(item, "content", []) or []
            for content in content_items:
                text = getattr(content, "text", None)
                if isinstance(text, str) and text.strip():
                    return text.strip()

        return ""

    async def run_turn(
        self, conversation_id: str, user_input: str
    ) -> AsyncGenerator[dict, None]:
        enabled_connections = self._get_enabled_connections()

        tools: list = [
            WebSearchTool(),
            get_date_and_time,
        ]

        if "spotify" in enabled_connections:
            tools.extend(
                [
                    spotify_get_profile,
                    spotify_get_top_items,
                    spotify_get_recommendations,
                    spotify_get_audio_analysis,
                    spotify_get_new_releases,
                    spotify_get_genre_seeds,
                    spotify_search,
                    spotify_get_artist,
                    spotify_get_artist_top_tracks,
                    spotify_get_related_artists,
                    spotify_get_track,
                    spotify_get_tracks_audio_features,
                    spotify_get_saved_tracks,
                    spotify_get_recently_played,
                    spotify_get_user_playlists,
                    spotify_get_playlist_tracks,
                    propose_spotify_playlist,
                ]
            )
        if "bandsintown" in enabled_connections:
            tools.extend(
                [
                    bit_get_artist,
                    bit_get_artist_by_id,
                    bit_get_artist_events,
                    bit_get_event,
                    bit_search_events,
                ]
            )

        memories_repo = MemoriesRepository()
        memories = memories_repo.list_memories()
        memories_by_category: dict = {}
        for memory in memories:
            category = memory.get("category") or "General"
            memories_by_category.setdefault(category, []).append(memory.get("content") or "")
        memory_lines: list = []
        for category, items in sorted(memories_by_category.items()):
            cleaned_items = [item for item in items if str(item).strip()]
            if not cleaned_items:
                continue
            memory_lines.append(f"## {category}")
            memory_lines.extend(f"- {item}" for item in cleaned_items)
        memories_block = ""
        if memory_lines:
            memories_block = "\n\n## User Memories\n" + "\n".join(memory_lines)

        triage = Agent(
            name="Music taste agent",
            instructions=f"""{RECOMMENDED_PROMPT_PREFIX}\n{TRIAGE_PROMPT}\n{memories_block}""",
            tools=tools,
            mcp_servers=[],
            output_type=Output,
            model=self.model,
            model_settings=ModelSettings(
                reasoning=Reasoning(effort="medium"),
                verbosity="medium",
                parallel_tool_calls=True,
                store=False,
                response_include=["reasoning.encrypted_content"],
            ),
        )

        with _conversation_id_scope(conversation_id):
            session = await create_session_and_load_state(
                conversation_id=conversation_id
            )

            try:
                result = Runner.run_streamed(
                    triage,
                    input=user_input,
                    session=session,
                    max_turns=20,
                    run_config=RunConfig(tracing_disabled=True),
                )

                accumulated_text = ""
                async for chunk in stream_result_events(result):
                    if chunk["type"] == "chunk":
                        accumulated_text += chunk["content"]
                    yield chunk

                yield {
                    "type": "complete",
                    "content": accumulated_text,
                    "finished": True,
                }

                has_summary = await get_session_has_summary(conversation_id)
                if not has_summary and accumulated_text:
                    summary_source = self._extract_response_for_summary(accumulated_text)
                    try:
                        summary = await self.generate_summary(
                            user_input=user_input,
                            assistant_response=summary_source,
                        )
                    except Exception as summary_error:
                        print(f"Conversation summary generation failed: {summary_error}")
                        summary = ""
                    await update_session_summary(
                        conversation_id,
                        summary.strip() or self._fallback_summary(user_input, summary_source),
                    )

            except Exception as e:
                yield {"type": "error", "content": str(e)}
