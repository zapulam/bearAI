"""
bearAI Internal Chat - API models

Written by: zapulam
"""

from pydantic import BaseModel, Field
from typing import Optional, Any, Literal


# Chat Context
class ChatContext(BaseModel):
    api_key: str


# Structured output for bearAI triage agent
class Output(BaseModel):
    """
    Structured output for the bearAI triage agent.
    """
    thought: str = Field(
        default=None,
        description=(
            "Internal process of how you came to your response, written in complete sentences. "
            "This is shown separately from the final response."
        ),
    )
    response: str = Field(
        description="Detailed, user-facing response, written in complete sentences."
    )
    status: Literal["incomplete", "awaiting_approval", "complete"] = Field(
        default="incomplete"
    )


# Chat generation
class TurnRequest(BaseModel):
    """
    FastAPI payload
    """
    conversation_id: str
    user_input: str


# Connections 
class ConnectionType(str):
    GMAIL = "gmail"
    JIRA = "jira"
    OUTLOOK = "outlook"
    SPOTIFY = "spotify"


class ConnectionRequest(BaseModel):
    connection_type: Literal["gmail", "jira", "outlook", "spotify"]
    enabled: bool = False
    base_url: Optional[str] = None
    email: Optional[str] = None
    api_token: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    refresh_token: Optional[str] = None
    tenant_id: Optional[str] = None
    redirect_uri: Optional[str] = None


class ConnectionResponse(ConnectionRequest):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# Memories 
class MemoryCreateRequest(BaseModel):
    category: Optional[str] = None
    content: str


class MemoryUpdateRequest(BaseModel):
    category: Optional[str] = None
    content: str


class MemoryResponse(BaseModel):
    id: int
    category: Optional[str] = None
    content: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# Settings 
class OpenAIKeyRequest(BaseModel):
    api_key: str = Field(min_length=1)


class OpenAIKeyResponse(BaseModel):
    has_key: bool
    masked_key: Optional[str] = None


class SpotifyConnectRequest(BaseModel):
    client_id: str = Field(min_length=1)
    redirect_uri: str = Field(min_length=1)


class SpotifyConnectResponse(BaseModel):
    auth_url: str


class SpotifyCallbackRequest(BaseModel):
    code: str = Field(min_length=1)
    state: str = Field(min_length=1)


class SpotifyDisconnectResponse(BaseModel):
    disconnected: bool


class SpotifyRefreshResponse(BaseModel):
    refreshed: bool
    token_expires_at: Optional[int] = None