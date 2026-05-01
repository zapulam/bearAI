import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Lock, Unlock, Pencil, Trash2, Plus } from 'lucide-react';
import { API_ENDPOINTS, buildApiUrl } from '../config/api';

const DEFAULT_CONNECTIONS = {
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
  bandsintown: {
    connection_type: 'bandsintown',
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

export default function Settings({ onClose }) {
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
    spotify: true,
    bandsintown: false,
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
        className="w-full px-3 py-2 pr-12 bg-[#171217]/75 border border-white/10 rounded-lg text-[#fff7eb] text-sm placeholder:text-[#cbb8ae]/60 focus:border-groove-teal focus:outline-none"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        onClick={() => toggleSensitiveVisibility(id)}
        aria-pressed={Boolean(sensitiveVisibility[id])}
        aria-label={sensitiveVisibility[id] ? 'Hide value' : 'Show value'}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#cbb8ae] hover:text-[#fff7eb] p-1.5"
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
      spotify: ['client_id', 'redirect_uri', 'refresh_token'],
      bandsintown: ['client_id'],
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

  const saveBandsintownConnection = async (nextConnection) => {
    setConnectionsSaving((prev) => ({ ...prev, bandsintown: true }));
    setConnectionsError(null);
    try {
      const url = buildApiUrl(`${API_ENDPOINTS.SETTINGS_CONNECTIONS}/bandsintown`);
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...nextConnection, connection_type: 'bandsintown' }),
      });
      if (!response.ok) {
        throw new Error(`Failed to save Bands in Town: ${response.statusText}`);
      }
      const saved = await response.json();
      setConnections((prev) => ({
        ...prev,
        bandsintown: { ...prev.bandsintown, ...saved },
      }));
      return true;
    } catch (err) {
      setConnectionsError(err.message);
      return false;
    } finally {
      setConnectionsSaving((prev) => ({ ...prev, bandsintown: false }));
    }
  };

  const handleBandsintownEnabledChange = async (enabled) => {
    const nextConnection = { ...connections.bandsintown, connection_type: 'bandsintown', enabled };
    setConnections((prev) => ({
      ...prev,
      bandsintown: nextConnection,
    }));
    await saveBandsintownConnection(nextConnection);
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
    <div className="chat-stage h-full w-full flex flex-col overflow-hidden">
      {typeof onClose === 'function' ? (
        <div className="shrink-0 border-b border-white/10 bg-[#211922]/65 px-4 py-3 flex items-center justify-between">
          <h1 className="font-display text-lg font-semibold text-[#fff7eb]">Settings</h1>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-[#eaded1] bg-[#2b2029] border border-white/10 rounded-lg hover:border-groove-gold/50 cursor-pointer"
          >
            Back to chat
          </button>
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-4 max-w-6xl mx-auto">
          <div className="settings-panel text-left rounded-lg mb-2">
            <button
              type="button"
              onClick={() => toggleSection('openai')}
              aria-expanded={sectionOpen.openai}
              aria-controls="settings-openai"
              className="w-full text-left px-5 py-4 flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-1 rounded-full bg-gradient-to-b from-groove-coral via-groove-gold to-groove-teal" />
                <div>
                  <h2 className="text-lg font-semibold text-[#fff7eb]">OpenAI API Key</h2>
                  <p className="text-sm text-[#cbb8ae]">
                    Add your OpenAI API key to enable chat features.
                  </p>
                </div>
              </div>
              {sectionOpen.openai ? (
                <ChevronDown className="text-[#cbb8ae]" size={18} />
              ) : (
                <ChevronRight className="text-[#cbb8ae]" size={18} />
              )}
            </button>
            {sectionOpen.openai ? (
              <div id="settings-openai" className="px-5 pb-5 space-y-3">
                {openaiKeyLoading ? (
                  <p className="text-sm text-[#9d8d86] italic">Loading OpenAI key status...</p>
                ) : null}
                {openaiKeyError ? <p className="text-sm text-red-300">{openaiKeyError}</p> : null}
                <div className="bg-[#211922]/80 rounded-lg border border-white/10 p-4 space-y-3">
                  <p className="text-sm text-[#cbb8ae]">
                    Status:{' '}
                    <span className="text-[#fff7eb]">
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
                      className="px-4 py-2 bg-groove-teal hover:bg-groove-mint text-[#171217] text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 cursor-pointer"
                    >
                      {openaiKeySaving ? 'Saving...' : 'Save Key'}
                    </button>
                    <button
                      onClick={handleClearOpenAIKey}
                      disabled={openaiKeyClearing || !openaiKeyStatus.hasKey}
                      className="px-4 py-2 bg-[#171217] border border-white/10 text-[#eaded1] text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 cursor-pointer"
                    >
                      {openaiKeyClearing ? 'Clearing...' : 'Clear Key'}
                    </button>
                    <p className="text-xs text-[#9d8d86]">
                      Your key is stored securely in the local database and is not displayed in full.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="settings-panel text-left rounded-lg mb-2">
            <button
              type="button"
              onClick={() => toggleSection('connections')}
              aria-expanded={sectionOpen.connections}
              aria-controls="settings-connections"
              className="w-full text-left px-5 py-4 flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-1 rounded-full bg-gradient-to-b from-groove-coral via-groove-gold to-groove-teal" />
                <div>
                  <h2 className="text-lg font-semibold text-[#fff7eb]">Connections</h2>
                  <p className="text-sm text-[#cbb8ae]">
                    Connect Spotify and Bands in Town for music taste, playlists, and live events.
                  </p>
                </div>
              </div>
              {sectionOpen.connections ? (
                <ChevronDown className="text-[#cbb8ae]" size={18} />
              ) : (
                <ChevronRight className="text-[#cbb8ae]" size={18} />
              )}
            </button>
            {sectionOpen.connections ? (
              <div id="settings-connections" className="px-5 pb-5 space-y-4">
                {connectionsLoading ? (
                  <p className="text-sm text-[#9d8d86] italic">Loading connections...</p>
                ) : null}
                {connectionsError ? (
                  <p className="text-sm text-red-300">{connectionsError}</p>
                ) : null}

                  <div className="bg-[#211922]/80 rounded-lg border border-white/10">
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
                          <h3 className="text-[#fff7eb] font-medium">Spotify</h3>
                          <p className="text-xs text-[#cbb8ae]">OAuth PKCE</p>
                        </div>
                      </div>
                      <span className="text-[#cbb8ae]">
                        {connectionOpen.spotify ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </span>
                    </button>
                    {connectionOpen.spotify ? (
                      <div id="connection-spotify" className="px-4 pb-4 space-y-3">
                        <label className="flex items-center gap-2 text-sm text-[#eaded1]">
                          <input
                            type="checkbox"
                            checked={connections.spotify.enabled}
                            onChange={(e) => handleSpotifyEnabledChange(e.target.checked)}
                            disabled={!isConnectionComplete('spotify')}
                            className="h-4 w-4 rounded border border-white/15 bg-[#171217] text-groove-teal focus:ring-2 focus:ring-groove-teal disabled:opacity-50"
                          />
                          Enabled
                        </label>
                        <div className="text-xs text-[#cbb8ae]">
                          Status:{' '}
                          <span className="text-[#fff7eb]">
                            {isSpotifyConnected ? 'Connected' : 'Not connected'}
                          </span>
                        </div>
                        {spotifyAuthMessage ? (
                          <p className="text-xs text-groove-teal">{spotifyAuthMessage}</p>
                        ) : null}
                        <div className="space-y-3">
                          <input
                            type="text"
                            className="w-full px-3 py-2 bg-[#171217]/75 border border-white/10 rounded-lg text-[#fff7eb] text-sm placeholder:text-[#cbb8ae]/60 focus:border-groove-teal focus:outline-none"
                            placeholder="Client ID"
                            value={connections.spotify.client_id}
                            onChange={(e) => updateConnectionField('spotify', 'client_id', e.target.value)}
                          />
                          <input
                            type="text"
                            className="w-full px-3 py-2 bg-[#171217]/75 border border-white/10 rounded-lg text-[#fff7eb] text-sm placeholder:text-[#cbb8ae]/60 focus:border-groove-teal focus:outline-none"
                            placeholder="Redirect URI"
                            value={connections.spotify.redirect_uri}
                            onChange={(e) => updateConnectionField('spotify', 'redirect_uri', e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center">
                          <button
                            onClick={handleSpotifyConnect}
                            disabled={spotifyAuthLoading}
                            className="px-4 py-2 bg-groove-teal hover:bg-groove-mint text-[#171217] text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 cursor-pointer"
                          >
                            {spotifyAuthLoading ? 'Connecting...' : 'Connect Spotify'}
                          </button>
                          {isSpotifyConnected ? (
                            <button
                              onClick={handleSpotifyDisconnect}
                              disabled={spotifyAuthLoading}
                              className="px-4 py-2 bg-[#171217] border border-white/10 text-[#eaded1] text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 cursor-pointer"
                            >
                              Disconnect
                            </button>
                          ) : null}
                        </div>
                        {connectionsSaving.spotify ? (
                          <p className="text-xs text-[#9d8d86]">Saving...</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="bg-[#211922]/80 rounded-lg border border-white/10">
                    <button
                      type="button"
                      onClick={() => toggleConnection('bandsintown')}
                      aria-expanded={connectionOpen.bandsintown}
                      aria-controls="connection-bandsintown"
                      className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-[#352735] border border-white/10 text-xs font-bold text-groove-gold flex items-center justify-center">
                          BIT
                        </div>
                        <div>
                          <h3 className="text-[#fff7eb] font-medium">Bands in Town</h3>
                          <p className="text-xs text-[#cbb8ae]">Public API (app_id)</p>
                        </div>
                      </div>
                      <span className="text-[#cbb8ae]">
                        {connectionOpen.bandsintown ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>
                    </button>
                    {connectionOpen.bandsintown ? (
                      <div id="connection-bandsintown" className="px-4 pb-4 space-y-3">
                        <p className="text-xs text-[#9d8d86]">
                          Request an application id from Bands in Town and read their terms. The id is sent as
                          the <code className="text-[#eaded1]">app_id</code> query parameter on every request.{' '}
                          <a
                            href="https://help.artists.bandsintown.com/en/articles/9186477-api-documentation"
                            className="text-groove-teal hover:text-groove-mint hover:underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            API documentation
                          </a>
                        </p>
                        <label className="flex items-center gap-2 text-sm text-[#eaded1]">
                          <input
                            type="checkbox"
                            checked={connections.bandsintown?.enabled}
                            onChange={(e) => handleBandsintownEnabledChange(e.target.checked)}
                            disabled={!isConnectionComplete('bandsintown')}
                            className="h-4 w-4 rounded border border-white/15 bg-[#171217] text-groove-teal focus:ring-2 focus:ring-groove-teal disabled:opacity-50"
                          />
                          Enabled
                        </label>
                        <div className="space-y-3">
                          <input
                            type="text"
                            className="w-full px-3 py-2 bg-[#171217]/75 border border-white/10 rounded-lg text-[#fff7eb] text-sm placeholder:text-[#cbb8ae]/60 focus:border-groove-teal focus:outline-none"
                            placeholder="App ID (Bands in Town application id)"
                            value={connections.bandsintown?.client_id || ''}
                            onChange={(e) => updateConnectionField('bandsintown', 'client_id', e.target.value)}
                          />
                        </div>
                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              saveBandsintownConnection(
                                connections.bandsintown || { ...DEFAULT_CONNECTIONS.bandsintown }
                              )
                            }
                            disabled={connectionsSaving.bandsintown}
                            className="px-4 py-2 bg-groove-teal hover:bg-groove-mint text-[#171217] text-sm font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 cursor-pointer"
                          >
                            {connectionsSaving.bandsintown ? 'Saving...' : 'Save Bands in Town'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
              </div>
            ) : null}
          </div>

          <div className="settings-panel text-left rounded-lg mb-2">
            <button
              type="button"
              onClick={() => toggleSection('memories')}
              aria-expanded={sectionOpen.memories}
              aria-controls="settings-memories"
              className="w-full text-left px-5 py-4 flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-1 rounded-full bg-gradient-to-b from-groove-coral via-groove-gold to-groove-teal" />
                <div>
                  <h2 className="text-lg font-semibold text-[#fff7eb]">Memories</h2>
                  <p className="text-sm text-[#cbb8ae]">
                    Long-term taste notes and preferences the assistant can remember.
                  </p>
                </div>
              </div>
              {sectionOpen.memories ? (
                <ChevronDown className="text-[#cbb8ae]" size={18} />
              ) : (
                <ChevronRight className="text-[#cbb8ae]" size={18} />
              )}
            </button>
            {sectionOpen.memories ? (
              <div id="settings-memories" className="px-5 pb-5 space-y-4">
                {memoriesLoading ? (
                  <p className="text-sm text-[#9d8d86] italic">Loading memories...</p>
                ) : null}
                {memoriesError ? <p className="text-sm text-red-300">{memoriesError}</p> : null}

                <div className="bg-[#211922]/80 rounded-lg border border-white/10 p-4 mb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCreateMemory}
                        aria-label="Add memory"
                        className="h-10 aspect-square flex items-center justify-center rounded-lg bg-groove-teal hover:bg-groove-mint border border-white/10 text-[#171217] transition-colors duration-200 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <input
                        type="text"
                        className="w-full px-3 py-2 bg-[#171217]/75 border border-white/10 rounded-lg text-[#fff7eb] text-sm placeholder:text-[#cbb8ae]/60 focus:border-groove-teal focus:outline-none"
                        placeholder="Category (optional)"
                        value={newMemory.category}
                        onChange={(e) => setNewMemory((prev) => ({ ...prev, category: e.target.value }))}
                      />
                    </div>
                    <input
                      type="text"
                      className="w-full px-3 py-2 bg-[#171217]/75 border border-white/10 rounded-lg text-[#fff7eb] text-sm placeholder:text-[#cbb8ae]/60 focus:border-groove-teal focus:outline-none"
                      placeholder="Memory content"
                      value={newMemory.content}
                      onChange={(e) => setNewMemory((prev) => ({ ...prev, content: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  {memories.length === 0 ? (
                    <p className="text-sm text-[#9d8d86] italic">No memories saved yet.</p>
                  ) : null}
                  {memoryCategories.map((category) => (
                    <div key={category} className="space-y-2">
                      <h4 className="text-xs uppercase tracking-wide text-[#9d8d86]">{category}</h4>
                      <div className="rounded-lg py-2 bg-[#211922]/80 border border-white/10 overflow-hidden">
                        {groupedMemories[category].map((memory, index) => (
                          <div
                            key={memory.id}
                            className="px-4 py-2 text-sm border-b border-white/10 last:border-b-0"
                          >
                          {editingMemoryId === memory.id ? (
                            <div className="space-y-3">
                              <input
                                type="text"
                                className="w-full px-3 py-2 bg-[#171217]/75 border border-white/10 rounded-lg text-[#fff7eb] text-sm placeholder:text-[#cbb8ae]/60 focus:border-groove-teal focus:outline-none"
                                placeholder="Category (optional)"
                                value={editingMemory.category}
                                onChange={(e) =>
                                  setEditingMemory((prev) => ({ ...prev, category: e.target.value }))
                                }
                              />
                              <input
                                type="text"
                                className="w-full px-3 py-2 bg-[#171217]/75 border border-white/10 rounded-lg text-[#fff7eb] text-sm placeholder:text-[#cbb8ae]/60 focus:border-groove-teal focus:outline-none"
                                placeholder="Memory content"
                                value={editingMemory.content}
                                onChange={(e) =>
                                  setEditingMemory((prev) => ({ ...prev, content: e.target.value }))
                                }
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={handleUpdateMemory}
                                  className="px-4 py-2 bg-groove-teal hover:bg-groove-mint text-[#171217] text-sm font-medium rounded-lg transition-colors duration-200 cursor-pointer"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={cancelEditMemory}
                                  className="px-4 py-2 bg-[#171217] border border-white/10 text-[#eaded1] text-sm font-medium rounded-lg transition-colors duration-200 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                              <div>
                                <p className="text-[#fff7eb]">{memory.content}</p>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEditMemory(memory)}
                                  aria-label="Edit memory"
                                  className="p-1 rounded-lg text-[#cbb8ae] hover:text-[#fff7eb] hover:bg-white/10 transition-colors duration-200 cursor-pointer"
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
