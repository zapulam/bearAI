import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Lock, Unlock, Pencil, Trash2, Plus } from 'lucide-react';
import { API_ENDPOINTS, buildApiUrl } from '../config/api';

const DEFAULT_CONNECTIONS = {
  jira: {
    connection_type: 'jira',
    enabled: false,
    base_url: '',
    email: '',
    api_token: '',
    client_id: '',
    client_secret: '',
    refresh_token: '',
    tenant_id: '',
  },
  gmail: {
    connection_type: 'gmail',
    enabled: false,
    base_url: '',
    email: '',
    api_token: '',
    client_id: '',
    client_secret: '',
    refresh_token: '',
    tenant_id: '',
  },
  outlook: {
    connection_type: 'outlook',
    enabled: false,
    base_url: '',
    email: '',
    api_token: '',
    client_id: '',
    client_secret: '',
    refresh_token: '',
    tenant_id: '',
  },
  spotify: {
    connection_type: 'spotify',
    enabled: false,
    base_url: '',
    email: '',
    api_token: '',
    client_id: '',
    client_secret: '',
    refresh_token: '',
    tenant_id: '',
    redirect_uri: '',
  },
};

export default function Settings() {
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiKeyStatus, setOpenaiKeyStatus] = useState({ hasKey: false, maskedKey: null });
  const [openaiKeyLoading, setOpenaiKeyLoading] = useState(false);
  const [openaiKeySaving, setOpenaiKeySaving] = useState(false);
  const [openaiKeyClearing, setOpenaiKeyClearing] = useState(false);
  const [openaiKeyError, setOpenaiKeyError] = useState(null);

  const [connections, setConnections] = useState(DEFAULT_CONNECTIONS);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState(null);
  const [connectionsSaving, setConnectionsSaving] = useState({});
  const [spotifyAuthLoading, setSpotifyAuthLoading] = useState(false);
  const [spotifyAuthMessage, setSpotifyAuthMessage] = useState(null);

  const [memories, setMemories] = useState([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoriesError, setMemoriesError] = useState(null);
  const [newMemory, setNewMemory] = useState({ category: '', content: '' });
  const [editingMemoryId, setEditingMemoryId] = useState(null);
  const [editingMemory, setEditingMemory] = useState({ category: '', content: '' });

  const [sectionOpen, setSectionOpen] = useState({
    openai: false,
    connections: false,
    memories: false,
  });
  const [connectionOpen, setConnectionOpen] = useState({
    jira: false,
    gmail: false,
    outlook: false,
    spotify: false,
  });
  const [sensitiveVisibility, setSensitiveVisibility] = useState({});

  const getDefaultSpotifyRedirect = () => `${window.location.origin}/spotify/callback`;

  const fetchConnections = async () => {
    setConnectionsLoading(true);
    setConnectionsError(null);
    try {
      const url = buildApiUrl(API_ENDPOINTS.SETTINGS_CONNECTIONS);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load connections: ${response.statusText}`);
      }
      const data = await response.json();
      const next = { ...DEFAULT_CONNECTIONS };
      data.forEach((item) => {
        if (next[item.connection_type]) {
          next[item.connection_type] = { ...next[item.connection_type], ...item };
        }
      });
      if (next.spotify && !String(next.spotify.redirect_uri || '').trim()) {
        next.spotify.redirect_uri = getDefaultSpotifyRedirect();
      }
      setConnections(next);
    } catch (err) {
      setConnectionsError(err.message);
    } finally {
      setConnectionsLoading(false);
    }
  };

  useEffect(() => {
    const loadOpenAIKey = async () => {
      setOpenaiKeyLoading(true);
      setOpenaiKeyError(null);
      try {
        const url = buildApiUrl(API_ENDPOINTS.SETTINGS_OPENAI_API_KEY);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load OpenAI key status: ${response.statusText}`);
        }
        const data = await response.json();
        setOpenaiKeyStatus({
          hasKey: Boolean(data.has_key),
          maskedKey: data.masked_key || null,
        });
      } catch (err) {
        setOpenaiKeyError(err.message);
      } finally {
        setOpenaiKeyLoading(false);
      }
    };

    const loadMemories = async () => {
      setMemoriesLoading(true);
      setMemoriesError(null);
      try {
        const url = buildApiUrl(API_ENDPOINTS.SETTINGS_MEMORIES);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load memories: ${response.statusText}`);
        }
        const data = await response.json();
        setMemories(data);
      } catch (err) {
        setMemoriesError(err.message);
      } finally {
        setMemoriesLoading(false);
      }
    };

    fetchConnections();
    loadMemories();
    loadOpenAIKey();
  }, []);

  useEffect(() => {
    if (window.location.pathname !== '/spotify/callback') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const code = params.get('code');
    const state = params.get('state');
    if (error) {
      setConnectionsError(`Spotify authorization failed: ${error}`);
      return;
    }
    if (!code || !state) {
      setConnectionsError('Spotify authorization missing code or state.');
      return;
    }
    const finalizeAuth = async () => {
      setSpotifyAuthLoading(true);
      setSpotifyAuthMessage(null);
      setConnectionsError(null);
      try {
        const url = buildApiUrl(API_ENDPOINTS.SPOTIFY_CALLBACK);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        });
        if (!response.ok) {
          throw new Error(`Spotify callback failed: ${response.statusText}`);
        }
        await response.json();
        setSpotifyAuthMessage('Spotify connected successfully.');
        await fetchConnections();
      } catch (err) {
        setConnectionsError(err.message);
      } finally {
        setSpotifyAuthLoading(false);
        window.history.replaceState({}, '', '/');
      }
    };
    finalizeAuth();
  }, []);

  const updateConnectionField = (type, field, value) => {
    setConnections((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [field]: value,
      },
    }));
  };

  const toggleSection = (key) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleConnection = (key) => {
    setConnectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSensitiveVisibility = (key) => {
    setSensitiveVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderSensitiveInput = ({ id, value, onChange, placeholder }) => (
    <div className="relative">
      <input
        type={sensitiveVisibility[id] ? 'text' : 'password'}
        className="w-full px-3 py-2 pr-12 bg-surface border border-divider rounded-lg text-white text-sm"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        onClick={() => toggleSensitiveVisibility(id)}
        aria-pressed={Boolean(sensitiveVisibility[id])}
        aria-label={sensitiveVisibility[id] ? 'Hide value' : 'Show value'}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1.5"
      >
        {sensitiveVisibility[id] ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
      </button>
    </div>
  );

  const isConnectionComplete = (type) => {
    const connection = connections[type];
    if (!connection) {
      return false;
    }
    const requiredFieldsByType = {
      jira: ['base_url', 'email', 'api_token'],
      gmail: ['client_id', 'client_secret', 'refresh_token'],
      outlook: ['client_id', 'client_secret', 'refresh_token', 'tenant_id'],
      spotify: ['client_id', 'redirect_uri', 'refresh_token'],
    };
    const requiredFields = requiredFieldsByType[type] || [];
    return requiredFields.every((field) => String(connection[field] || '').trim());
  };

  const isSpotifyConnected = Boolean(connections.spotify && connections.spotify.refresh_token);

  const handleSaveOpenAIKey = async () => {
    if (!openaiKey.trim()) {
      setOpenaiKeyError('OpenAI API key is required.');
      return;
    }
    setOpenaiKeySaving(true);
    setOpenaiKeyError(null);
    try {
      const url = buildApiUrl(API_ENDPOINTS.SETTINGS_OPENAI_API_KEY);
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: openaiKey.trim() }),
      });
      if (!response.ok) {
        throw new Error(`Failed to save OpenAI key: ${response.statusText}`);
      }
      const data = await response.json();
      setOpenaiKeyStatus({
        hasKey: Boolean(data.has_key),
        maskedKey: data.masked_key || null,
      });
      setOpenaiKey('');
    } catch (err) {
      setOpenaiKeyError(err.message);
    } finally {
      setOpenaiKeySaving(false);
    }
  };

  const handleClearOpenAIKey = async () => {
    setOpenaiKeyClearing(true);
    setOpenaiKeyError(null);
    try {
      const url = buildApiUrl(API_ENDPOINTS.SETTINGS_OPENAI_API_KEY);
      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(`Failed to clear OpenAI key: ${response.statusText}`);
      }
      const data = await response.json();
      setOpenaiKeyStatus({
        hasKey: Boolean(data.has_key),
        maskedKey: data.masked_key || null,
      });
      setOpenaiKey('');
    } catch (err) {
      setOpenaiKeyError(err.message);
    } finally {
      setOpenaiKeyClearing(false);
    }
  };

  const handleSaveConnection = async (type) => {
    setConnectionsSaving((prev) => ({ ...prev, [type]: true }));
    setConnectionsError(null);
    try {
      const url = buildApiUrl(`${API_ENDPOINTS.SETTINGS_CONNECTIONS}/${type}`);
      const payload = connections[type];
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Failed to save connection: ${response.statusText}`);
      }
      const saved = await response.json();
      setConnections((prev) => ({
        ...prev,
        [type]: { ...prev[type], ...saved },
      }));
    } catch (err) {
      setConnectionsError(err.message);
    } finally {
      setConnectionsSaving((prev) => ({ ...prev, [type]: false }));
    }
  };

  const saveSpotifyConnection = async (nextConnection) => {
    setConnectionsSaving((prev) => ({ ...prev, spotify: true }));
    setConnectionsError(null);
    try {
      const url = buildApiUrl(`${API_ENDPOINTS.SETTINGS_CONNECTIONS}/spotify`);
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConnection),
      });
      if (!response.ok) {
        throw new Error(`Failed to save Spotify connection: ${response.statusText}`);
      }
      const saved = await response.json();
      setConnections((prev) => ({
        ...prev,
        spotify: { ...prev.spotify, ...saved },
      }));
      return true;
    } catch (err) {
      setConnectionsError(err.message);
      return false;
    } finally {
      setConnectionsSaving((prev) => ({ ...prev, spotify: false }));
    }
  };

  const handleSpotifyEnabledChange = async (enabled) => {
    const nextConnection = { ...connections.spotify, enabled };
    setConnections((prev) => ({
      ...prev,
      spotify: nextConnection,
    }));
    await saveSpotifyConnection(nextConnection);
  };

  const handleSpotifyConnect = async () => {
    const clientId = String(connections.spotify.client_id || '').trim();
    const redirectUri = String(connections.spotify.redirect_uri || '').trim();
    if (!clientId || !redirectUri) {
      setConnectionsError('Spotify Client ID and Redirect URI are required to connect.');
      return;
    }
    setSpotifyAuthLoading(true);
    setSpotifyAuthMessage(null);
    setConnectionsError(null);
    try {
      const saved = await saveSpotifyConnection({
        ...connections.spotify,
        client_id: clientId,
        redirect_uri: redirectUri,
      });
      if (!saved) {
        return;
      }
      const url = buildApiUrl(API_ENDPOINTS.SPOTIFY_CONNECT);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
        }),
      });
      if (!response.ok) {
        throw new Error(`Spotify connect failed: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data.auth_url) {
        throw new Error('Spotify connect failed: missing auth URL.');
      }
      window.location.assign(data.auth_url);
    } catch (err) {
      setConnectionsError(err.message);
      setSpotifyAuthLoading(false);
    }
  };

  const handleSpotifyDisconnect = async () => {
    setSpotifyAuthLoading(true);
    setSpotifyAuthMessage(null);
    setConnectionsError(null);
    try {
      const url = buildApiUrl(API_ENDPOINTS.SPOTIFY_DISCONNECT);
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) {
        throw new Error(`Spotify disconnect failed: ${response.statusText}`);
      }
      await response.json();
      await fetchConnections();
      setSpotifyAuthMessage('Spotify disconnected.');
    } catch (err) {
      setConnectionsError(err.message);
    } finally {
      setSpotifyAuthLoading(false);
    }
  };

  const startEditMemory = (memory) => {
    setEditingMemoryId(memory.id);
    setEditingMemory({
      category: memory.category || '',
      content: memory.content || '',
    });
  };

  const cancelEditMemory = () => {
    setEditingMemoryId(null);
    setEditingMemory({ category: '', content: '' });
  };

  const handleCreateMemory = async () => {
    if (!newMemory.content.trim()) {
      return;
    }
    try {
      const url = buildApiUrl(API_ENDPOINTS.SETTINGS_MEMORIES);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: newMemory.category.trim() || null,
          content: newMemory.content.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to create memory: ${response.statusText}`);
      }
      const created = await response.json();
      setMemories((prev) => [created, ...prev]);
      setNewMemory({ category: '', content: '' });
    } catch (err) {
      setMemoriesError(err.message);
    }
  };

  const handleUpdateMemory = async () => {
    if (!editingMemoryId || !editingMemory.content.trim()) {
      return;
    }
    try {
      const url = buildApiUrl(`${API_ENDPOINTS.SETTINGS_MEMORIES}/${editingMemoryId}`);
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: editingMemory.category.trim() || null,
          content: editingMemory.content.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to update memory: ${response.statusText}`);
      }
      const updated = await response.json();
      setMemories((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      cancelEditMemory();
    } catch (err) {
      setMemoriesError(err.message);
    }
  };

  const handleDeleteMemory = async (memoryId) => {
    try {
      const url = buildApiUrl(`${API_ENDPOINTS.SETTINGS_MEMORIES}/${memoryId}`);
      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(`Failed to delete memory: ${response.statusText}`);
      }
      setMemories((prev) => prev.filter((item) => item.id !== memoryId));
    } catch (err) {
      setMemoriesError(err.message);
    }
  };

  const groupedMemories = memories.reduce((groups, memory) => {
    const category = (memory.category || 'General').trim() || 'General';
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(memory);
    return groups;
  }, {});
  Object.values(groupedMemories).forEach((items) => {
    items.sort((a, b) => {
      if (a.created_at && b.created_at) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return (a.id || 0) - (b.id || 0);
    });
  });
  const memoryCategories = Object.keys(groupedMemories).sort((a, b) => a.localeCompare(b));

  return (
    <div className="h-full w-full flex flex-col bg-surface overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-4 max-w-6xl mx-auto">
          <div className="text-left bg-surface-elevated/40 rounded-2xl mb-2">
            <button
              type="button"
              onClick={() => toggleSection('openai')}
              aria-expanded={sectionOpen.openai}
              aria-controls="settings-openai"
              className="w-full text-left px-5 py-4 flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-1 rounded-full bg-green-500/60" />
                <div>
                  <h2 className="text-lg font-semibold text-white">OpenAI API Key</h2>
                  <p className="text-sm text-gray-400">
                    Add your OpenAI API key to enable chat features.
                  </p>
                </div>
              </div>
              {sectionOpen.openai ? (
                <ChevronDown className="text-gray-400" size={18} />
              ) : (
                <ChevronRight className="text-gray-400" size={18} />
              )}
            </button>
            {sectionOpen.openai ? (
              <div id="settings-openai" className="px-5 pb-5 space-y-3">
                {openaiKeyLoading ? (
                  <p className="text-sm text-gray-500 italic">Loading OpenAI key status...</p>
                ) : null}
                {openaiKeyError ? <p className="text-sm text-red-400">{openaiKeyError}</p> : null}
                <div className="bg-surface rounded-xl p-4 space-y-3">
                  <p className="text-sm text-gray-400">
                    Status:{' '}
                    <span className="text-white">
                      {openaiKeyStatus.hasKey
                        ? `Saved ${openaiKeyStatus.maskedKey ? `(${openaiKeyStatus.maskedKey})` : ''}`
                        : 'Not set'}
                    </span>
                  </p>
                  <div className="">
                    {renderSensitiveInput({
                      id: 'openai_api_key',
                      placeholder: 'Enter OpenAI API key',
                      value: openaiKey,
                      onChange: (e) => setOpenaiKey(e.target.value),
                    })}
                  </div>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <button
                      onClick={handleSaveOpenAIKey}
                      disabled={openaiKeySaving}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                    >
                      {openaiKeySaving ? 'Saving...' : 'Save Key'}
                    </button>
                    <button
                      onClick={handleClearOpenAIKey}
                      disabled={openaiKeyClearing || !openaiKeyStatus.hasKey}
                      className="px-4 py-2 bg-surface border border-divider text-gray-200 text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                    >
                      {openaiKeyClearing ? 'Clearing...' : 'Clear Key'}
                    </button>
                    <p className="text-xs text-gray-500">
                      Your key is stored securely in the local database and is not displayed in full.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="text-left bg-surface-elevated/40 rounded-2xl mb-2">
            <button
              type="button"
              onClick={() => toggleSection('connections')}
              aria-expanded={sectionOpen.connections}
              aria-controls="settings-connections"
              className="w-full text-left px-5 py-4 flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-1 rounded-full bg-green-500/60" />
                <div>
                  <h2 className="text-lg font-semibold text-white">Connections</h2>
                  <p className="text-sm text-gray-400">
                    Enable services and provide credentials for the assistant.
                  </p>
                </div>
              </div>
              {sectionOpen.connections ? (
                <ChevronDown className="text-gray-400" size={18} />
              ) : (
                <ChevronRight className="text-gray-400" size={18} />
              )}
            </button>
            {sectionOpen.connections ? (
              <div id="settings-connections" className="px-5 pb-5 space-y-4">
                {connectionsLoading ? (
                  <p className="text-sm text-gray-500 italic">Loading connections...</p>
                ) : null}
                {connectionsError ? (
                  <p className="text-sm text-red-400">{connectionsError}</p>
                ) : null}

                  <div className="bg-surface rounded-xl">
                    <button
                      type="button"
                      onClick={() => toggleConnection('gmail')}
                      aria-expanded={connectionOpen.gmail}
                      aria-controls="connection-gmail"
                      className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src="/gmail.png"
                          alt="Gmail"
                          className="w-8 h-8 object-contain rounded-md"
                        />
                        <div>
                          <h3 className="text-white font-medium">Gmail</h3>
                          <p className="text-xs text-gray-400">OAuth credentials</p>
                        </div>
                      </div>
                      <span className="text-gray-400">
                        {connectionOpen.gmail ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </span>
                    </button>
                    {connectionOpen.gmail ? (
                      <div id="connection-gmail" className="px-4 pb-4 space-y-3">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={connections.gmail.enabled}
                            onChange={(e) => updateConnectionField('gmail', 'enabled', e.target.checked)}
                            disabled={!isConnectionComplete('gmail')}
                            className="h-4 w-4 rounded border border-divider bg-surface text-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                          />
                          Enabled
                        </label>
                        <div className="space-y-3">
                          <input
                            type="text"
                            className="w-full px-3 py-2 bg-surface border border-divider rounded-lg text-white text-sm"
                            placeholder="Client ID"
                            value={connections.gmail.client_id}
                            onChange={(e) => updateConnectionField('gmail', 'client_id', e.target.value)}
                          />
                          {renderSensitiveInput({
                            id: 'gmail_client_secret',
                            placeholder: 'Client secret',
                            value: connections.gmail.client_secret,
                            onChange: (e) =>
                              updateConnectionField('gmail', 'client_secret', e.target.value),
                          })}
                          {renderSensitiveInput({
                            id: 'gmail_refresh_token',
                            placeholder: 'Refresh token',
                            value: connections.gmail.refresh_token,
                            onChange: (e) =>
                              updateConnectionField('gmail', 'refresh_token', e.target.value),
                          })}
                        </div>
                        <div>
                          <button
                            onClick={() => handleSaveConnection('gmail')}
                            disabled={connectionsSaving.gmail}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                          >
                            {connectionsSaving.gmail ? 'Saving...' : 'Save Gmail'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-4">
                  <div className="bg-surface rounded-xl">
                    <button
                      type="button"
                      onClick={() => toggleConnection('jira')}
                      aria-expanded={connectionOpen.jira}
                      aria-controls="connection-jira"
                      className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src="/jira.png"
                          alt="Jira"
                          className="w-8 h-8 object-contain rounded-md"
                        />
                        <div>
                          <h3 className="text-white font-medium">Jira</h3>
                          <p className="text-xs text-gray-400">API token authentication</p>
                        </div>
                      </div>
                      <span className="text-gray-400">
                        {connectionOpen.jira ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </span>
                    </button>
                    {connectionOpen.jira ? (
                      <div id="connection-jira" className="px-4 pb-4 space-y-3">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={connections.jira.enabled}
                            onChange={(e) => updateConnectionField('jira', 'enabled', e.target.checked)}
                            disabled={!isConnectionComplete('jira')}
                            className="h-4 w-4 rounded border border-divider bg-surface text-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                          />
                          Enabled
                        </label>
                        <div className="space-y-3">
                          <input
                            type="text"
                            className="w-full px-3 py-2 bg-surface border border-divider rounded-lg text-white text-sm"
                            placeholder="Base URL"
                            value={connections.jira.base_url}
                            onChange={(e) => updateConnectionField('jira', 'base_url', e.target.value)}
                          />
                          <input
                            type="email"
                            className="w-full px-3 py-2 bg-surface border border-divider rounded-lg text-white text-sm"
                            placeholder="Email"
                            value={connections.jira.email}
                            onChange={(e) => updateConnectionField('jira', 'email', e.target.value)}
                          />
                          {renderSensitiveInput({
                            id: 'jira_api_token',
                            placeholder: 'API token',
                            value: connections.jira.api_token,
                            onChange: (e) => updateConnectionField('jira', 'api_token', e.target.value),
                          })}
                        </div>
                        <div>
                          <button
                            onClick={() => handleSaveConnection('jira')}
                            disabled={connectionsSaving.jira}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                          >
                            {connectionsSaving.jira ? 'Saving...' : 'Save Jira'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="bg-surface rounded-xl">
                    <button
                      type="button"
                      onClick={() => toggleConnection('outlook')}
                      aria-expanded={connectionOpen.outlook}
                      aria-controls="connection-outlook"
                      className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src="/outlook.png"
                          alt="Outlook"
                          className="w-8 h-8 object-contain rounded-md"
                        />
                        <div>
                          <h3 className="text-white font-medium">Outlook</h3>
                          <p className="text-xs text-gray-400">OAuth credentials</p>
                        </div>
                      </div>
                      <span className="text-gray-400">
                        {connectionOpen.outlook ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </span>
                    </button>
                    {connectionOpen.outlook ? (
                      <div id="connection-outlook" className="px-4 pb-4 space-y-3">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={connections.outlook.enabled}
                            onChange={(e) => updateConnectionField('outlook', 'enabled', e.target.checked)}
                            disabled={!isConnectionComplete('outlook')}
                            className="h-4 w-4 rounded border border-divider bg-surface text-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                          />
                          Enabled
                        </label>
                        <div className="space-y-3">
                          <input
                            type="text"
                            className="w-full px-3 py-2 bg-surface border border-divider rounded-lg text-white text-sm"
                            placeholder="Client ID"
                            value={connections.outlook.client_id}
                            onChange={(e) => updateConnectionField('outlook', 'client_id', e.target.value)}
                          />
                          {renderSensitiveInput({
                            id: 'outlook_client_secret',
                            placeholder: 'Client secret',
                            value: connections.outlook.client_secret,
                            onChange: (e) =>
                              updateConnectionField('outlook', 'client_secret', e.target.value),
                          })}
                          {renderSensitiveInput({
                            id: 'outlook_refresh_token',
                            placeholder: 'Refresh token',
                            value: connections.outlook.refresh_token,
                            onChange: (e) =>
                              updateConnectionField('outlook', 'refresh_token', e.target.value),
                          })}
                          <input
                            type="text"
                            className="w-full px-3 py-2 bg-surface border border-divider rounded-lg text-white text-sm"
                            placeholder="Tenant ID"
                            value={connections.outlook.tenant_id}
                            onChange={(e) => updateConnectionField('outlook', 'tenant_id', e.target.value)}
                          />
                        </div>
                        <div>
                          <button
                            onClick={() => handleSaveConnection('outlook')}
                            disabled={connectionsSaving.outlook}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                          >
                            {connectionsSaving.outlook ? 'Saving...' : 'Save Outlook'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="bg-surface rounded-xl">
                    <button
                      type="button"
                      onClick={() => toggleConnection('spotify')}
                      aria-expanded={connectionOpen.spotify}
                      aria-controls="connection-spotify"
                      className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                      <img
                          src="/spotify.png"
                          alt="Spotify"
                          className="w-8 h-8 object-contain rounded-md"
                        />
                        <div>
                          <h3 className="text-white font-medium">Spotify</h3>
                          <p className="text-xs text-gray-400">OAuth PKCE</p>
                        </div>
                      </div>
                      <span className="text-gray-400">
                        {connectionOpen.spotify ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </span>
                    </button>
                    {connectionOpen.spotify ? (
                      <div id="connection-spotify" className="px-4 pb-4 space-y-3">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={connections.spotify.enabled}
                            onChange={(e) => handleSpotifyEnabledChange(e.target.checked)}
                            disabled={!isConnectionComplete('spotify')}
                            className="h-4 w-4 rounded border border-divider bg-surface text-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                          />
                          Enabled
                        </label>
                        <div className="text-xs text-gray-400">
                          Status:{' '}
                          <span className="text-white">
                            {isSpotifyConnected ? 'Connected' : 'Not connected'}
                          </span>
                        </div>
                        {spotifyAuthMessage ? (
                          <p className="text-xs text-green-400">{spotifyAuthMessage}</p>
                        ) : null}
                        <div className="space-y-3">
                          <input
                            type="text"
                            className="w-full px-3 py-2 bg-surface border border-divider rounded-lg text-white text-sm"
                            placeholder="Client ID"
                            value={connections.spotify.client_id}
                            onChange={(e) => updateConnectionField('spotify', 'client_id', e.target.value)}
                          />
                          <input
                            type="text"
                            className="w-full px-3 py-2 bg-surface border border-divider rounded-lg text-white text-sm"
                            placeholder="Redirect URI"
                            value={connections.spotify.redirect_uri}
                            onChange={(e) => updateConnectionField('spotify', 'redirect_uri', e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center">
                          <button
                            onClick={handleSpotifyConnect}
                            disabled={spotifyAuthLoading}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                          >
                            {spotifyAuthLoading ? 'Connecting...' : 'Connect Spotify'}
                          </button>
                          {isSpotifyConnected ? (
                            <button
                              onClick={handleSpotifyDisconnect}
                              disabled={spotifyAuthLoading}
                              className="px-4 py-2 bg-surface border border-divider text-gray-200 text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                            >
                              Disconnect
                            </button>
                          ) : null}
                        </div>
                        {connectionsSaving.spotify ? (
                          <p className="text-xs text-gray-500">Saving...</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="text-left bg-surface-elevated/40 rounded-2xl mb-2">
            <button
              type="button"
              onClick={() => toggleSection('memories')}
              aria-expanded={sectionOpen.memories}
              aria-controls="settings-memories"
              className="w-full text-left px-5 py-4 flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-1 rounded-full bg-green-500/60" />
                <div>
                  <h2 className="text-lg font-semibold text-white">Memories</h2>
                  <p className="text-sm text-gray-400">
                    Store long-term facts, contacts, and preferences.
                  </p>
                </div>
              </div>
              {sectionOpen.memories ? (
                <ChevronDown className="text-gray-400" size={18} />
              ) : (
                <ChevronRight className="text-gray-400" size={18} />
              )}
            </button>
            {sectionOpen.memories ? (
              <div id="settings-memories" className="px-5 pb-5 space-y-4">
                {memoriesLoading ? (
                  <p className="text-sm text-gray-500 italic">Loading memories...</p>
                ) : null}
                {memoriesError ? <p className="text-sm text-red-400">{memoriesError}</p> : null}

                <div className="bg-surface rounded-xl p-4 mb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCreateMemory}
                        aria-label="Add memory"
                        className="h-10 aspect-square flex items-center justify-center rounded-lg bg-green-600 hover:bg-green-700 border border-divider text-white transition-colors duration-200 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <input
                        type="text"
                        className="w-full px-3 py-2 bg-surface border border-divider rounded-lg text-white text-sm"
                        placeholder="Category (optional)"
                        value={newMemory.category}
                        onChange={(e) => setNewMemory((prev) => ({ ...prev, category: e.target.value }))}
                      />
                    </div>
                    <input
                      type="text"
                      className="w-full px-3 py-2 bg-surface border border-divider rounded-lg text-white text-sm"
                      placeholder="Memory content"
                      value={newMemory.content}
                      onChange={(e) => setNewMemory((prev) => ({ ...prev, content: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  {memories.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">No memories saved yet.</p>
                  ) : null}
                  {memoryCategories.map((category) => (
                    <div key={category} className="space-y-2">
                      <h4 className="text-xs uppercase tracking-wide text-gray-500">{category}</h4>
                      <div className="rounded-xl py-2 bg-surface overflow-hiddenborder-divider">
                        {groupedMemories[category].map((memory, index) => (
                          <div
                            key={memory.id}
                            className="px-4 py-2 text-sm border-divider last:border-b-0"
                          >
                          {editingMemoryId === memory.id ? (
                            <div className="space-y-3">
                              <input
                                type="text"
                                className="w-full px-3 py-2 bg-surface border border-divider rounded-lg text-white text-sm"
                                placeholder="Category (optional)"
                                value={editingMemory.category}
                                onChange={(e) =>
                                  setEditingMemory((prev) => ({ ...prev, category: e.target.value }))
                                }
                              />
                              <input
                                type="text"
                                className="w-full px-3 py-2 bg-surface border border-divider rounded-lg text-white text-sm"
                                placeholder="Memory content"
                                value={editingMemory.content}
                                onChange={(e) =>
                                  setEditingMemory((prev) => ({ ...prev, content: e.target.value }))
                                }
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={handleUpdateMemory}
                                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors duration-200 cursor-pointer"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={cancelEditMemory}
                                  className="px-4 py-2 bg-surface border border-divider text-gray-300 text-sm font-medium rounded-lg transition-colors duration-200 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                              <div>
                                <p className="text-white">{memory.content}</p>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEditMemory(memory)}
                                  aria-label="Edit memory"
                                  className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-surface/70 transition-colors duration-200 cursor-pointer"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMemory(memory.id)}
                                  aria-label="Delete memory"
                                  className="p-1 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors duration-200 cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

