"""
bearAI Internal Chat - service.

Written by: zapulam
"""

import json

from agents import (
    Agent,
    ModelSettings,
    RunConfig,
    Runner,
    WebSearchTool
)
from agents.extensions.handoff_prompt import RECOMMENDED_PROMPT_PREFIX
from agents.mcp import MCPServerStdio, MCPServerStreamableHttp, create_static_tool_filter

from dataclasses import dataclass
from openai import AsyncOpenAI
from openai.types.responses.web_search_tool import Filters
from openai.types.shared import Reasoning
from typing import Sequence, AsyncGenerator

from prompts import *
from models import Output
from tools import (
    gmail_search_messages,
    gmail_send_email,
    gmail_get_recent_emails,
    outlook_search_messages,
    outlook_send_email,
    outlook_get_recent_emails,
    spotify_get_profile,
    spotify_get_top_items,
    spotify_get_recommendations,
    spotify_get_audio_analysis,
    spotify_get_new_releases,
    spotify_get_genre_seeds,
)
from memory import (
    create_session_and_load_state,
    get_session_has_summary,
    update_session_summary
)
from repositories import ConnectionsRepository, MemoriesRepository
from streaming import stream_result_events


def _build_intercom_server(intercom_token: str, intercom_id: str) -> MCPServerStreamableHttp:
    return MCPServerStreamableHttp(
        params={
            "name": "intercom-mcp",
            "url": "https://mcp.intercom.com/mcp",
            "headers": {
                "Authorization": f"Bearer {intercom_token}",
                "Intercom-Workspace-Id": f"{intercom_id}"
            }
        },
        tool_filter=create_static_tool_filter(
            allowed_tool_names=[
                "search",
                "fetch",
                "search_conversations",
                "get_conversation",
                "search_contacts",
                "get_contact"
            ],
            blocked_tool_names=[]
        ),
        cache_tools_list=True,
        client_session_timeout_seconds=20
    )


def _build_atlassian_server(site: str) -> MCPServerStdio:
    return MCPServerStdio(
        name="Atlassian Rovo MCP via mcp-remote",
        params={
            "command": "npx",
            "args": [
                "-y",
                "mcp-remote",
                "https://mcp.atlassian.com/v1/sse",
                "--resource",
                site,
            ],
        },
        tool_filter=create_static_tool_filter(
            allowed_tool_names=[
                "JiraTool",
                "search"
            ]
        ),
        cache_tools_list=True,
    )


@dataclass
class ChatService:
    client: AsyncOpenAI
    model: str = "gpt-5-mini"

    def __post_init__(
            self,
        ):
        """
        Initialize ChatService agentic system

        Args:
            client (OpenAI): OpenAI client
            model (str): OpenAI model to use for agents.
        """

        self.base_tools = [
            WebSearchTool()
        ]


    def _get_enabled_connections(self) -> set[str]:
        repo = ConnectionsRepository()
        enabled = set()
        for connection in repo.list_connections():
            if connection.get("enabled"):
                enabled.add(connection.get("connection_type"))
        return enabled


    async def generate_summary(
            self,
            user_input: str,
            assistant_response: str,
        ) -> str:
        """
        Generate a short summary of a conversation based on the first exchange.
        
        Args:
            user_input (str): The first user message.
            assistant_response (str): The assistant's response to the first message.
            
        Returns:
            str: A 5-8 word summary of the conversation topic.
        """
        system_prompt = f"""Generate a very brief summary (4-6 words max) of this conversation topic.
            The summary should capture the main intent or question from the user.
            Do not include phrases like "User asked about" or "Conversation about".
            Just provide a direct, concise description."""

        input_text = f"""User: {user_input}
            Assistant: {assistant_response}"""
        
        # Generate summary
        response = await self.client.responses.create(
            model=self.summary_model,
            instructions=system_prompt,
            input=input_text,
            max_output_tokens=50,
            temperature=0,
        )
        
        return response.output[0].content[0].text.strip()


    async def run_turn(
            self,
            conversation_id: str,
            user_input: str
        ) -> AsyncGenerator[dict, None]:
        """
        Run a single user turn with streaming response.

        Args:
            conversation_id: Identifier for conversation state storage.
            user_input: The user's message for this turn.
            user: User identifier for this session.

        Yields:
            dict: Streaming chunks with 'type' and 'content' keys.
        """
        enabled_connections = self._get_enabled_connections()
        repo = ConnectionsRepository()
        mcp_servers = []

        if "intercom" in enabled_connections:
            intercom_conn = repo.get_connection("intercom") or {}
            intercom_token = intercom_conn.get("api_token")
            intercom_id = intercom_conn.get("tenant_id")
            if intercom_token and intercom_id:
                mcp_servers.append(_build_intercom_server(intercom_token, intercom_id))
        if "atlassian" in enabled_connections:
            atlassian_conn = repo.get_connection("atlassian") or {}
            atlassian_site = atlassian_conn.get("base_url")
            if atlassian_site:
                mcp_servers.append(_build_atlassian_server(atlassian_site))

        tools = [WebSearchTool()]
        if "gmail" in enabled_connections:
            tools.extend([
                gmail_search_messages,
                gmail_send_email,
                gmail_get_recent_emails,
            ])
        if "outlook" in enabled_connections:
            tools.extend([
                outlook_search_messages,
                outlook_send_email,
                outlook_get_recent_emails,
            ])
        if "spotify" in enabled_connections:
            tools.extend([
                spotify_get_profile,
                spotify_get_top_items,
                spotify_get_recommendations,
                spotify_get_audio_analysis,
                spotify_get_new_releases,
                spotify_get_genre_seeds,
            ])

        memories_repo = MemoriesRepository()
        memories = memories_repo.list_memories()
        memories_by_category = {}
        for memory in memories:
            category = memory.get("category") or "General"
            memories_by_category.setdefault(category, []).append(memory.get("content") or "")
        memory_lines = []
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
            name="Triage agent",
            instructions=f"""{RECOMMENDED_PROMPT_PREFIX}\n{TRIAGE_PROMPT}\n{memories_block}""",
            tools=tools,
            mcp_servers=mcp_servers,
            output_type=Output,
            model=self.model,
            model_settings=ModelSettings(
                reasoning=Reasoning(effort="medium"),
                verbosity="medium",
                parallel_tool_calls=True,
                store=False,
                response_include=["reasoning.encrypted_content"]
            )
        )

        # Connect to servers
        for server in mcp_servers:
            await server.connect()
        
        # Load session
        session = await create_session_and_load_state(
            conversation_id=conversation_id
        )

        try:
            # Run with streaming and yield chunks as they come
            result = Runner.run_streamed(
                triage,
                input=user_input,
                session=session,
                max_turns=20,
                run_config=RunConfig(
                    tracing_disabled=True
                )
            )

            # Stream the response content using stream_events()
            accumulated_text = ""
            async for chunk in stream_result_events(result):
                if chunk["type"] == "chunk":
                    accumulated_text += chunk["content"]
                yield chunk

            # Send final message with complete response
            yield {
                "type": "complete",
                "content": accumulated_text,
                "finished": True
            }

            # Generate summary after the first exchange if not already generated
            has_summary = await get_session_has_summary(conversation_id)
            if not has_summary and accumulated_text:

                response_json = json.loads(accumulated_text)
                assistant_response = response_json.get("response", accumulated_text)
                
                if assistant_response and assistant_response.strip():
                    summary = await self.generate_summary(
                        user_input=user_input,
                        assistant_response=assistant_response,
                    )
                    if summary and summary.strip():
                        await update_session_summary(conversation_id, summary)
        except Exception as e:
            # Send error
            yield {
                "type": "error",
                "content": str(e)
            }
