"""
bearAI Internal Chat - FastAPI application.

Written by: zapulam
"""

import os
import json
import uuid
import traceback
import uvicorn
import base64
import hashlib
import secrets
import time
import urllib.parse
import requests

from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Any, Dict, List, AsyncGenerator, Optional
from openai import AsyncOpenAI

from service import ChatService
from models import (
    TurnRequest,
    ConnectionRequest,
    ConnectionResponse,
    MemoryCreateRequest,
    MemoryUpdateRequest,
    MemoryResponse,
    OpenAIKeyRequest,
    OpenAIKeyResponse,
    SpotifyConnectRequest,
    SpotifyConnectResponse,
    SpotifyCallbackRequest,
    SpotifyDisconnectResponse,
    SpotifyRefreshResponse,
)
from memory import (
    create_session_and_load_state,
    get_conversations,
    initialize_sqlite_db,
)
from repositories import ConnectionsRepository, MemoriesRepository, SettingsRepository
from settings import settings
from streaming import (
    ChatChunkEvent,
    ChatToolInput,
    ChatToolOutput,
    ChatComplete,
    ChatError,
    StructuredOutputStreamParser,
)

class AppRuntime:
    """Runtime for admin chat service."""
    def __init__(self, chat_service: Optional[ChatService], openai_api_key: Optional[str]):
        self.chat_service = chat_service
        self.openai_api_key = openai_api_key

    async def close(self):
        """Clean up resources."""
        pass

def get_cors_origins() -> List[str]:
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_SCOPES = "user-read-private user-read-email user-top-read"


def _base64_url_encode(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).decode("utf-8").rstrip("=")


def _generate_pkce_verifier() -> str:
    return secrets.token_urlsafe(64)[:128]


def _generate_pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    return _base64_url_encode(digest)

def get_runtime(request: Request):
    """Dependency to get runtime from app state."""
    rt = getattr(request.app.state, "runtime", None)
    if rt is None:
        raise HTTPException(503, "Runtime not initialized")
    return rt


def _mask_api_key(api_key: str) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 8:
        return "****"
    return f"{api_key[:4]}...{api_key[-4:]}"


def _build_runtime(api_key: str) -> AppRuntime:
    os.environ["OPENAI_API_KEY"] = api_key
    client = AsyncOpenAI(api_key=api_key)
    chat_service = ChatService(client=client)
    return AppRuntime(chat_service=chat_service, openai_api_key=api_key)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown."""
    # Load env variables
    load_dotenv()

    # Initialize SQLite database
    db_path = settings.db_path
    if db_path:
        initialize_sqlite_db(db_path)

    repo = SettingsRepository()
    api_key = repo.get_openai_api_key()
    if api_key:
        app.state.runtime = _build_runtime(api_key)
    else:
        app.state.runtime = AppRuntime(chat_service=None, openai_api_key=None)

    try:
        yield
    finally:
        await app.state.runtime.close()


# Create FastAPI app
app = FastAPI(title="Admin Chat Service", lifespan=lifespan)

# Add CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/chat/generate")
async def create_chat(
        req: TurnRequest,
        rt: AppRuntime = Depends(get_runtime),
    ) -> StreamingResponse:
    """
    Calls the agentic chat module to answer user questions with streaming response.

    Args:
        req (TurnRequest): The TurnRequest API payload containing conversation_id, and user_input.
        rt (AppRuntime): The AppRuntime object containing the chat module.

    Returns:
        StreamingResponse: Server-Sent Events stream of the response.
    """
    async def generate_stream() -> AsyncGenerator[str, None]:
        """Generate SSE stream from the chat service."""
        conversation_id = req.conversation_id or str(uuid.uuid4())
        parser = StructuredOutputStreamParser()
        last_tool_name = None

        try:
            async for chunk in rt.chat_service.run_turn(
                conversation_id=conversation_id,
                user_input=req.user_input,
                # context = ChatContext(
                #         api_key=api_key
                #     )
            ):
                if chunk.get("type") == "tool_call":
                    last_tool_name = chunk.get("content")
                    parser.reset()
                    event = ChatToolInput(
                        type="tool_call",
                        tool_name=chunk.get("content", ""),
                        content=chunk.get("arguments", {}),
                    )
                    yield f"data: {event.model_dump_json()}\n\n"

                if chunk.get("type") == "chunk":
                    delta = chunk.get("content", "")
                    for evt in parser.feed(delta):
                        event = ChatChunkEvent(type=evt.field, content=evt.text)
                        yield f"data: {event.model_dump_json()}\n\n"

                elif chunk.get("type") == "tool_output":
                    tool_output_content = chunk.get("content", "")
                    tool_name = last_tool_name or "unknown_tool"
                    content = tool_output_content
                    if isinstance(tool_output_content, dict):
                        tool_name = tool_output_content.get("name", tool_name)
                        content = tool_output_content.get("content", tool_output_content)

                    event = ChatToolOutput(
                        type="tool_output",
                        tool_name=tool_name,
                        content=content,
                    )
                    yield f"data: {event.model_dump_json()}\n\n"

                elif chunk.get("type") == "complete":
                    content_str = chunk.get("content", "")
                    thought = parser.thought
                    response = parser.response
                    status = ""

                    try:
                        content_json = json.loads(content_str)
                        if isinstance(content_json, dict):
                            thought = content_json.get("thought", thought) or thought
                            response = content_json.get("response", response) or response
                            status = content_json.get("status", status) or status
                    except json.JSONDecodeError:
                        pass

                    event = ChatComplete(
                        type="complete",
                        conversation_id=conversation_id,
                        thought=thought,
                        response=response,
                        status=status,
                    )
                    yield f"data: {event.model_dump_json()}\n\n"

            done_event = {"type": "done"}
            yield f"data: {json.dumps(done_event)}\n\n"

        except Exception as e:
            detail = f"{type(e).__name__}: {e}".strip()
            if not detail or detail.endswith(":"):
                detail = "Unexpected error during chat generation."
            traceback.print_exc()
            event = ChatError(type="error", content=detail)
            yield f"data: {event.model_dump_json()}\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@app.get("/chat/sessions")
async def get_sessions(
    rt: AppRuntime = Depends(get_runtime),
) -> Dict[str, Any]:
    """
    Get all chat sessions for a specific user.

    Args:
        rt: AppRuntime dependency.

    Returns:
        Dictionary containing list of sessions.
    """
    sessions = await get_conversations()
    return {"sessions": sessions}


@app.get("/chat/history")
async def get_chat_history(
        conversation_id: str,
        rt: AppRuntime = Depends(get_runtime),
    ) -> Dict[str, Any]:
    """
    Get chat history for a specific session.

    Args:
        conversation_id: Session identifier.
        rt: AppRuntime dependency.

    Returns:
        Dictionary containing list of messages.
    """
    

    try:
        session, _ = await create_session_and_load_state(
            conversation_id
        )
        items = await session.get_items()
    except Exception as e:
        # Return empty messages instead of failing
        return {"messages": []}
    
    # Convert items to message format
    messages = []
    for item in items:
        if isinstance(item, dict):
            role = item.get("role", "user")
            content = item.get("content", "")
            created_at = item.get("created_at")
        else:
            role = getattr(item, "role", "user")
            content = getattr(item, "content", "")
            created_at = getattr(item, "created_at", None)
        
        thought = None
        status = None

        # Handle assistant messages where content might be a structured Output,
        # or legacy text/list/dict structures.
        if role == "assistant":
            # First, try to interpret content as structured Output with thought/response/status
            structured = None

            if isinstance(content, dict) and (
                "thought" in content or "response" in content or "status" in content
            ):
                structured = content
            elif isinstance(content, str):
                # Try to parse JSON string into structured dict
                try:
                    parsed = json.loads(content)
                    if isinstance(parsed, dict) and (
                        "thought" in parsed or "response" in parsed or "status" in parsed
                    ):
                        structured = parsed
                except Exception:
                    structured = None

            if structured is not None:
                # Extract structured fields
                thought_val = structured.get("thought")
                response_val = structured.get("response")
                status_val = structured.get("status")

                thought = (
                    thought_val
                    if isinstance(thought_val, str)
                    else (json.dumps(thought_val) if thought_val is not None else None)
                )
                # Response/content shown to user
                if isinstance(response_val, str):
                    content = response_val
                elif response_val is not None:
                    content = json.dumps(response_val)
                else:
                    # Fallback to empty string if response is missing
                    content = ""

                if isinstance(status_val, str):
                    status = status_val
                elif status_val is not None:
                    status = str(status_val)
            else:
                # Legacy handling: content as list/dict with 'text' field or other types
                if isinstance(content, list) and len(content) > 0:
                    # Handle list of dicts like [{"text": "...", ...}]
                    first_item = content[0]
                    if isinstance(first_item, dict):
                        content = first_item.get("text", "")
                    else:
                        content = str(first_item)
                elif isinstance(content, dict):
                    # Extract text from dict structure like {'text': '...', 'annotations': ..., 'type': ..., 'logprobs': ...}
                    content = content.get("text", "")
                elif not isinstance(content, str):
                    # Fallback: convert to string if it's not already a string
                    content = str(content)
        elif not isinstance(content, str):
            # For non-assistant messages, convert to string if needed
            content = str(content)
        
        message_data: Dict[str, Any] = {
            "role": role,
            "content": content,
        }

        # Prefer the stored created_at as the canonical timestamp for history
        if created_at is not None:
            message_data["created_at"] = created_at
            # Also expose it as a generic timestamp field for frontend convenience
            message_data["timestamp"] = created_at

        # Only attach thought/status for assistant messages when present so
        # the frontend can render them like live streamed chats.
        if role == "assistant":
            if thought is not None and str(thought).strip():
                message_data["thought"] = thought
            if status is not None:
                message_data["status"] = status

        messages.append(message_data)
    
    return {"messages": messages}


@app.get("/settings/connections", response_model=List[ConnectionResponse])
async def list_connections() -> List[ConnectionResponse]:
    repo = ConnectionsRepository()
    return repo.list_connections()


@app.put("/settings/connections/{connection_type}", response_model=ConnectionResponse)
async def upsert_connection(
        connection_type: str,
        req: ConnectionRequest,
    ) -> ConnectionResponse:
    if req.connection_type and req.connection_type != connection_type:
        raise HTTPException(status_code=400, detail="Connection type mismatch")
    repo = ConnectionsRepository()
    payload = req.model_dump()
    payload["connection_type"] = connection_type
    updated = repo.upsert_connection(payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    return updated


@app.post("/spotify/connect", response_model=SpotifyConnectResponse)
async def spotify_connect(req: SpotifyConnectRequest) -> SpotifyConnectResponse:
    repo = ConnectionsRepository()
    existing = repo.get_connection("spotify") or {}
    pkce_verifier = _generate_pkce_verifier()
    pkce_state = _base64_url_encode(secrets.token_bytes(16))
    payload = {
        **existing,
        "connection_type": "spotify",
        "client_id": req.client_id.strip(),
        "redirect_uri": req.redirect_uri.strip(),
        "pkce_verifier": pkce_verifier,
        "pkce_state": pkce_state,
        "access_token": None,
        "refresh_token": None,
        "token_expires_at": None,
    }
    repo.upsert_connection(payload)
    params = {
        "response_type": "code",
        "client_id": req.client_id.strip(),
        "redirect_uri": req.redirect_uri.strip(),
        "state": pkce_state,
        "code_challenge_method": "S256",
        "code_challenge": _generate_pkce_challenge(pkce_verifier),
        "scope": SPOTIFY_SCOPES,
    }
    auth_url = f"{SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return SpotifyConnectResponse(auth_url=auth_url)


@app.post("/spotify/callback", response_model=ConnectionResponse)
async def spotify_callback(req: SpotifyCallbackRequest) -> ConnectionResponse:
    repo = ConnectionsRepository()
    connection = repo.get_connection("spotify") or {}
    stored_state = connection.get("pkce_state")
    pkce_verifier = connection.get("pkce_verifier")
    client_id = connection.get("client_id")
    redirect_uri = connection.get("redirect_uri")
    if not stored_state or stored_state != req.state:
        raise HTTPException(status_code=400, detail="Invalid Spotify state")
    if not pkce_verifier or not client_id or not redirect_uri:
        raise HTTPException(status_code=400, detail="Spotify PKCE configuration missing")
    token_response = requests.post(
        SPOTIFY_TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": req.code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "code_verifier": pkce_verifier,
        },
        timeout=20,
    )
    if token_response.status_code >= 400:
        raise HTTPException(status_code=400, detail="Spotify token exchange failed")
    token_json = token_response.json()
    access_token = token_json.get("access_token")
    refresh_token = token_json.get("refresh_token")
    expires_in = token_json.get("expires_in")
    token_expires_at = int(time.time()) + int(expires_in or 0) if expires_in else None
    payload = {
        **connection,
        "connection_type": "spotify",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_expires_at": token_expires_at,
        "pkce_verifier": None,
        "pkce_state": None,
    }
    updated = repo.upsert_connection(payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Spotify connection not found")
    return updated


@app.post("/spotify/refresh", response_model=SpotifyRefreshResponse)
async def spotify_refresh() -> SpotifyRefreshResponse:
    repo = ConnectionsRepository()
    connection = repo.get_connection("spotify") or {}
    refresh_token = connection.get("refresh_token")
    client_id = connection.get("client_id")
    if not refresh_token or not client_id:
        raise HTTPException(status_code=400, detail="Spotify refresh token missing")
    token_response = requests.post(
        SPOTIFY_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
        },
        timeout=20,
    )
    if token_response.status_code >= 400:
        raise HTTPException(status_code=400, detail="Spotify token refresh failed")
    token_json = token_response.json()
    access_token = token_json.get("access_token")
    expires_in = token_json.get("expires_in")
    token_expires_at = int(time.time()) + int(expires_in or 0) if expires_in else None
    payload = {
        **connection,
        "connection_type": "spotify",
        "access_token": access_token,
        "token_expires_at": token_expires_at,
    }
    repo.upsert_connection(payload)
    return SpotifyRefreshResponse(refreshed=True, token_expires_at=token_expires_at)


@app.post("/spotify/disconnect", response_model=SpotifyDisconnectResponse)
async def spotify_disconnect() -> SpotifyDisconnectResponse:
    repo = ConnectionsRepository()
    connection = repo.get_connection("spotify") or {}
    if not connection:
        return SpotifyDisconnectResponse(disconnected=True)
    payload = {
        **connection,
        "connection_type": "spotify",
        "enabled": False,
        "access_token": None,
        "refresh_token": None,
        "token_expires_at": None,
        "pkce_verifier": None,
        "pkce_state": None,
    }
    repo.upsert_connection(payload)
    return SpotifyDisconnectResponse(disconnected=True)


@app.get("/settings/memories", response_model=List[MemoryResponse])
async def list_memories() -> List[MemoryResponse]:
    repo = MemoriesRepository()
    return repo.list_memories()


@app.get("/settings/openai-api-key", response_model=OpenAIKeyResponse)
async def get_openai_api_key_status() -> OpenAIKeyResponse:
    repo = SettingsRepository()
    api_key = repo.get_openai_api_key()
    return OpenAIKeyResponse(
        has_key=bool(api_key),
        masked_key=_mask_api_key(api_key) if api_key else None,
    )


@app.put("/settings/openai-api-key", response_model=OpenAIKeyResponse)
async def update_openai_api_key(
        req: OpenAIKeyRequest,
        request: Request,
    ) -> OpenAIKeyResponse:
    api_key = req.api_key.strip()
    repo = SettingsRepository()
    repo.set_openai_api_key(api_key)
    request.app.state.runtime = _build_runtime(api_key)
    return OpenAIKeyResponse(
        has_key=True,
        masked_key=_mask_api_key(api_key),
    )


@app.delete("/settings/openai-api-key", response_model=OpenAIKeyResponse)
async def clear_openai_api_key(request: Request) -> OpenAIKeyResponse:
    repo = SettingsRepository()
    repo.clear_openai_api_key()
    os.environ.pop("OPENAI_API_KEY", None)
    request.app.state.runtime = AppRuntime(chat_service=None, openai_api_key=None)
    return OpenAIKeyResponse(
        has_key=False,
        masked_key=None,
    )


@app.delete("/settings/openai-api-key", response_model=OpenAIKeyResponse)
async def clear_openai_api_key(request: Request) -> OpenAIKeyResponse:
    repo = SettingsRepository()
    repo.clear_openai_api_key()
    os.environ.pop("OPENAI_API_KEY", None)
    request.app.state.runtime = AppRuntime(chat_service=None, openai_api_key=None)
    return OpenAIKeyResponse(
        has_key=False,
        masked_key=None,
    )


@app.post("/settings/memories", response_model=MemoryResponse)
async def create_memory(req: MemoryCreateRequest) -> MemoryResponse:
    repo = MemoriesRepository()
    return repo.create_memory(category=req.category, content=req.content)


@app.put("/settings/memories/{memory_id}", response_model=MemoryResponse)
async def update_memory(memory_id: int, req: MemoryUpdateRequest) -> MemoryResponse:
    repo = MemoriesRepository()
    updated = repo.update_memory(memory_id=memory_id, category=req.category, content=req.content)
    if updated is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    return updated


@app.delete("/settings/memories/{memory_id}")
async def delete_memory(memory_id: int) -> Dict[str, Any]:
    repo = MemoriesRepository()
    deleted = repo.delete_memory(memory_id=memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"deleted": True}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "admin_chat"}


if __name__ == "__main__":
    port = 5000
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)

