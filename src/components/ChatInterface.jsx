import React, { useState, useRef, useEffect } from 'react';
import { UserMessage, AssistantMessage, SystemMessage, ErrorMessage } from './ChatMessage';
import { useChat } from '../hooks/useChat';
import { API_ENDPOINTS, buildApiUrl } from '../config/api';
import {
  CalendarDays,
  Disc3,
  HelpCircle,
  ListMusic,
  Music2,
  PanelLeftOpen,
  Plus,
  Radio,
  Send,
  Sparkles,
  Square,
} from 'lucide-react';

const BEAR_IMAGES = [
  '/bear.png',
  '/bear_blink.png',
  '/bear_ears.png'
];

const SETTINGS_CONNECTION_META = {
  spotify: { label: 'Spotify', icon: '/spotify.png' },
  bandsintown: { label: 'Bands in Town', icon: '/campfire.gif' },
};

const TOOL_COMMANDS_BY_CONNECTION = {
  spotify: [
    { command: 'spotify_get_profile', description: 'Get Spotify profile' },
    { command: 'spotify_get_top_items', description: 'Get top artists or tracks' },
    { command: 'spotify_search', description: 'Search tracks, artists, albums' },
    { command: 'spotify_get_recommendations', description: 'Get recommendations' },
    { command: 'spotify_get_tracks_audio_features', description: 'Audio features for tracks' },
    { command: 'spotify_get_recently_played', description: 'Recently played tracks' },
    { command: 'spotify_get_user_playlists', description: 'List your playlists' },
    { command: 'spotify_get_playlist_tracks', description: 'Read tracks from a playlist' },
    { command: 'spotify_get_artist_top_tracks', description: 'Popular tracks for an artist' },
    { command: 'propose_spotify_playlist', description: 'Stage a playlist (requires your approval to create)' },
  ],
  bandsintown: [
    { command: 'bit_get_artist', description: 'Bands in Town artist profile' },
    { command: 'bit_get_artist_events', description: 'Tour dates for an artist' },
    { command: 'bit_search_events', description: 'Events by location' },
  ],
};

const TOOL_COMMANDS_ALWAYS_AVAILABLE = [];

const STARTER_PROMPTS = [
  {
    label: 'Decode my taste',
    prompt: 'Use my Spotify listening to describe my current music taste in a few specific themes.',
    icon: Sparkles,
  },
  {
    label: 'Refresh my rotation',
    prompt: 'Look at my recently played songs and recommend what I should play next.',
    icon: Radio,
  },
  {
    label: 'Build a late-night mix',
    prompt: 'Make a 20-track private Spotify playlist proposal for a late-night drive from artists I like.',
    icon: ListMusic,
  },
  {
    label: 'Find live shows',
    prompt: 'Check upcoming shows for artists I listen to and suggest a short list.',
    icon: CalendarDays,
  },
];

export default function ChatInterface({ initialSessionId, isSideNavOpen, onToggleSideNav, onSessionUpdate, onOpenSettings }) {
  const [inputValue, setInputValue] = useState('');
  const [bearImage, setBearImage] = useState(BEAR_IMAGES[0]);
  const [isConnectionsPopupOpen, setIsConnectionsPopupOpen] = useState(false);
  const [showCommandsPopup, setShowCommandsPopup] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [selectedConnections, setSelectedConnections] = useState({});
  const [pendingActions, setPendingActions] = useState([]);
  const [pendingActionError, setPendingActionError] = useState(null);
  const [pendingActionBusy, setPendingActionBusy] = useState(null);
  const [availableConnections, setAvailableConnections] = useState([]);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isApiKeyLoading, setIsApiKeyLoading] = useState(true);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const popupRef = useRef(null);
  const plusButtonRef = useRef(null);
  const commandsPopupRef = useRef(null);
  const prevIsLoadingRef = useRef(false);
  const hasTriggeredRefetchRef = useRef(false);
  const { messages, isLoading, sendMessage, cancelRequest, retryLastMessage, sessionId } = useChat(initialSessionId);

  // Reset refetch trigger when session changes
  useEffect(() => {
    hasTriggeredRefetchRef.current = false;
  }, [sessionId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    const loadApiKeyStatus = async () => {
      setIsApiKeyLoading(true);
      try {
        const url = buildApiUrl(API_ENDPOINTS.SETTINGS_OPENAI_API_KEY);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load OpenAI key status: ${response.statusText}`);
        }
        const data = await response.json();
        setHasApiKey(Boolean(data.has_key));
      } catch (err) {
        setHasApiKey(false);
      } finally {
        setIsApiKeyLoading(false);
      }
    };

    loadApiKeyStatus();
  }, []);

  useEffect(() => {
    const loadConnections = async () => {
      try {
        const url = buildApiUrl(API_ENDPOINTS.SETTINGS_CONNECTIONS);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load connections: ${response.statusText}`);
        }
        const data = await response.json();
        const filtered = data.filter((item) => SETTINGS_CONNECTION_META[item.connection_type]);
        setAvailableConnections(filtered);
        setSelectedConnections((prev) => {
          const next = { ...prev };
          filtered.forEach((connection) => {
            next[connection.connection_type] = Boolean(connection.enabled);
          });
          return next;
        });
      } catch (err) {
        setAvailableConnections([]);
      }
    };

    loadConnections();
  }, []);

  useEffect(() => {
    const loadPending = async () => {
      if (!sessionId) {
        setPendingActions([]);
        return;
      }
      if (isLoading) {
        return;
      }
      try {
        const url = buildApiUrl(
          `${API_ENDPOINTS.ACTIONS_PENDING}?conversation_id=${encodeURIComponent(sessionId)}`
        );
        const res = await fetch(url);
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        if (Array.isArray(data)) {
          setPendingActions(data);
        }
      } catch {
        // ignore
      }
    };
    loadPending();
  }, [sessionId, isLoading]);

  const handleApprovePending = async (actionId) => {
    setPendingActionBusy(actionId);
    setPendingActionError(null);
    try {
      const url = buildApiUrl(API_ENDPOINTS.ACTIONS_APPROVE(actionId));
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPendingActionError(data.detail || res.statusText || 'Approval failed');
        return;
      }
      if (data.success) {
        setPendingActions((prev) => prev.filter((p) => p.id !== actionId));
      } else {
        setPendingActionError(data.message || 'Could not create playlist');
      }
    } catch (err) {
      setPendingActionError(err.message);
    } finally {
      setPendingActionBusy(null);
    }
  };

  const handleCancelPending = async (actionId) => {
    setPendingActionBusy(actionId);
    setPendingActionError(null);
    try {
      const url = buildApiUrl(API_ENDPOINTS.ACTIONS_CANCEL(actionId));
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPendingActionError(data.detail || res.statusText);
        return;
      }
      setPendingActions((prev) => prev.filter((p) => p.id !== actionId));
    } catch (err) {
      setPendingActionError(err.message);
    } finally {
      setPendingActionBusy(null);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputValue]);

  // Detect when message streaming completes and trigger session update for new sessions
  useEffect(() => {
    // Check if loading just completed (transitioned from true to false)
    if (prevIsLoadingRef.current && !isLoading) {
      // Check if this is the first message in a new session
      // A new session is when initialSessionId is null and we have exactly 2 messages (user + assistant)
      const isNewSession = initialSessionId === null;
      const hasFirstMessagePair = messages.length === 2 && 
        messages[0]?.role === 'user' && 
        messages[1]?.role === 'assistant';
      
      // Only trigger refetch once per new session, after the first message completes
      if (isNewSession && hasFirstMessagePair && onSessionUpdate && !hasTriggeredRefetchRef.current) {
        hasTriggeredRefetchRef.current = true;
        // Small delay to ensure backend has saved the session
        setTimeout(() => {
          onSessionUpdate();
        }, 500);
      }
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, messages, initialSessionId, onSessionUpdate]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target) &&
        plusButtonRef.current &&
        !plusButtonRef.current.contains(event.target)
      ) {
        setIsConnectionsPopupOpen(false);
      }
      if (
        commandsPopupRef.current &&
        !commandsPopupRef.current.contains(event.target) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target)
      ) {
        setShowCommandsPopup(false);
      }
    };

    if (isConnectionsPopupOpen || showCommandsPopup) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isConnectionsPopupOpen, showCommandsPopup]);

  useEffect(() => {
    const primaryImage = BEAR_IMAGES[0];
    const alternateImages = BEAR_IMAGES.slice(1);
    let timeoutId;

    const scheduleNext = () => {
      const holdDurationMs = 2500 + Math.floor(Math.random() * 2500);
      timeoutId = setTimeout(() => {
        if (alternateImages.length === 0) {
          setBearImage(primaryImage);
          scheduleNext();
          return;
        }

        const nextIndex = Math.floor(Math.random() * alternateImages.length);
        const nextImage = alternateImages[nextIndex] || primaryImage;
        setBearImage(nextImage);

        timeoutId = setTimeout(() => {
          setBearImage(primaryImage);
          scheduleNext();
        }, 500);
      }, holdDurationMs);
    };

    setBearImage(primaryImage);
    scheduleNext();

    return () => clearTimeout(timeoutId);
  }, []);

  const handleConnectionToggle = (service) => {
    setSelectedConnections(prev => ({
      ...prev,
      [service]: !prev[service],
    }));
  };

  const handleStarterPrompt = (prompt) => {
    setInputValue(prompt);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const availableCommands = React.useMemo(() => {
    const commands = [];
    TOOL_COMMANDS_ALWAYS_AVAILABLE.forEach((tool) => {
      if (!tool.key || selectedConnections[tool.key]) {
        commands.push({
          command: tool.command,
          description: tool.description,
          contextPrefix: `Use tool ${tool.command} with the following input: `,
        });
      }
    });
    Object.entries(TOOL_COMMANDS_BY_CONNECTION).forEach(([connectionKey, tools]) => {
      if (selectedConnections[connectionKey]) {
        tools.forEach((tool) => {
          commands.push({
            command: tool.command,
            description: tool.description,
            contextPrefix: `Use tool ${tool.command} with the following input: `,
          });
        });
      }
    });
    return commands;
  }, [selectedConnections]);

  // Get filtered commands based on input
  const getFilteredCommands = () => {
    // Always work from an alphabetically sorted list of commands
    const sortedCommands = [...availableCommands].sort((a, b) =>
      a.command.localeCompare(b.command)
    );

    if (!inputValue.startsWith('/')) {
      return [];
    }
    const query = inputValue.slice(1).toLowerCase();
    if (!query) {
      return sortedCommands;
    }
    return sortedCommands.filter(cmd => 
      cmd.command.toLowerCase().startsWith(query)
    );
  };

  const filteredCommands = getFilteredCommands();

  // Update commands popup visibility based on input
  useEffect(() => {
    if (inputValue.startsWith('/') && filteredCommands.length > 0) {
      setShowCommandsPopup(true);
      setSelectedCommandIndex(0);
    } else {
      setShowCommandsPopup(false);
    }
  }, [inputValue, filteredCommands.length]);

  const handleCommandSelect = (command) => {
    // Extract any text that was typed after the command
    // e.g., if user typed "/hel how do I login", extract "how do I login"
    const match = inputValue.match(/^\/\w+\s+(.+)$/);
    const remainingText = match ? ` ${match[1]}` : ' ';
    setInputValue(`/${command.command}${remainingText}`);
    setShowCommandsPopup(false);
    // Set cursor position after the command and space
    setTimeout(() => {
      if (textareaRef.current) {
        const cursorPos = `/${command.command} `.length;
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
        textareaRef.current.focus();
      }
    }, 0);
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInputValue(value);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isApiKeyLoading || !hasApiKey) {
      return;
    }
    if (inputValue.trim() && !isLoading) {
      let messageToSend = inputValue.trim();
      
      // Check if message starts with a command
      if (messageToSend.startsWith('/')) {
        const commandMatch = messageToSend.match(/^\/(\w+)(?:\s+(.+))?$/);
        if (commandMatch) {
          const [, commandName, userInput] = commandMatch;
          const command = availableCommands.find(cmd => cmd.command === commandName);
          if (command && userInput) {
            // Prepend context prefix to user input
            messageToSend = `${command.contextPrefix}${userInput}`;
          } else if (command && !userInput) {
            // If command is used without input, just send the command description as context
            messageToSend = `${command.contextPrefix}${command.description}`;
          }
        }
      }
      
      sendMessage(messageToSend);
      setInputValue('');
      setShowCommandsPopup(false);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e) => {
    if (showCommandsPopup && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex(prev => 
          prev < filteredCommands.length - 1 ? prev + 1 : prev
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex(prev => prev > 0 ? prev - 1 : 0);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const selectedCommand = filteredCommands[selectedCommandIndex];
        if (selectedCommand) {
          handleCommandSelect(selectedCommand);
          // After selecting, if there's already text after the command, submit
          const currentInput = inputValue;
          if (currentInput.includes(' ') && currentInput.substring(currentInput.indexOf(' ')).trim()) {
            setTimeout(() => handleSubmit(e), 0);
          }
        } else {
          handleSubmit(e);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCommandsPopup(false);
        return;
      }
    }
    
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const isWelcomeScreen = messages.length === 0;

  return (
    <div className="chat-stage flex flex-col h-full">
      {/* Chat Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/10 bg-[#211922]/65">
        <div className="flex items-center gap-3 min-w-0">
          {!isSideNavOpen ? (
            <button
              type="button"
              onClick={onToggleSideNav}
              className="p-2 text-[#fff7eb]/75 hover:text-[#fff7eb] hover:bg-white/10 rounded-lg transition-colors duration-200 cursor-pointer"
              title="Open sidebar"
              aria-label="Open sidebar"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
          ) : null}
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#352735] border border-white/10 text-groove-gold">
            <Disc3 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-base font-bold text-[#fff7eb] leading-tight">bearAI</p>
            <div className="flex items-center gap-2 text-xs text-[#d9c7bd]">
              <span>Music chat</span>
              <span className="equalizer" aria-hidden="true">
                <span style={{ '--bar-color': '#ff6b6b', '--delay': '0s' }} />
                <span style={{ '--bar-color': '#f7b955', '--delay': '0.12s' }} />
                <span style={{ '--bar-color': '#19c6a3', '--delay': '0.24s' }} />
                <span style={{ '--bar-color': '#9cf07d', '--delay': '0.36s' }} />
              </span>
            </div>
          </div>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsHelpOpen((prev) => !prev)}
            className="p-2 text-[#fff7eb]/75 hover:text-[#fff7eb] hover:bg-white/10 rounded-lg transition-colors duration-200 cursor-pointer"
            title="What can bearAI do?"
            aria-label="Open bearAI help"
          >
            <HelpCircle className="w-5.5 h-5.5" />
          </button>
          {isHelpOpen && (
            <div className="absolute right-0 mt-2 w-72 bg-[#2b2029]/95 border border-white/15 rounded-lg shadow-2xl p-3 z-50 text-left backdrop-blur">
              <p className="text-sm text-[#fff7eb] mb-2">
                Explore your Spotify taste, get recommendations, build playlists (with your approval), and
                look up live shows with Bands in Town.
              </p>
              <p className="text-xs text-[#d9c7bd]">
                Connect Spotify and optionally Bands in Town in the data sources menu or Settings.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 scrollbar-none">
        <div className={`max-w-6xl mx-auto ${isWelcomeScreen ? 'flex items-center min-h-full' : ''}`}>
          {isWelcomeScreen && (
            <div className="flex flex-col items-center justify-center w-full text-center animate-slide-up">
              <div className="mb-6 relative flex h-44 w-44 items-center justify-center">
                <div className="vinyl-disc" aria-hidden="true" />
                <img
                  src={bearImage}
                  alt="bearAI"
                  className="absolute w-24 h-24 object-contain rounded-full bg-[#fff7eb]/92 p-2 shadow-[0_12px_35px_rgba(0,0,0,0.28)]"
                />
              </div>
              <h1 className="font-display text-4xl md:text-5xl font-bold mb-4 animate-slide-up animate-delay-100 bg-gradient-to-r from-groove-coral via-groove-gold to-groove-teal text-transparent bg-clip-text">
                What are we listening to?
              </h1>
              <p className="text-lg text-[#eaded1] mb-2 max-w-2xl animate-slide-up animate-delay-200">
                Chat with an agent that knows your library, finds similar artists, and helps you go to more shows.
              </p>
              <p className="text-base text-[#cbb8ae] mb-6 max-w-2xl animate-slide-up animate-delay-300">
                Playlist ideas are staged for your approval before anything hits Spotify.
              </p>
              {!isApiKeyLoading && !hasApiKey && (
                <p className="text-sm text-groove-gold mb-4 max-w-2xl animate-slide-up animate-delay-300">
                  Set your OpenAI API key in Settings to start chatting.
                </p>
              )}
              {typeof onOpenSettings === 'function' && !isApiKeyLoading && hasApiKey ? (
                <p className="text-sm text-[#cbb8ae] mb-6 max-w-2xl">
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-groove-teal hover:text-groove-mint hover:underline cursor-pointer"
                  >
                    Open Settings
                  </button>{' '}
                  to connect Spotify (and optional Bands in Town) for the full experience.
                </p>
              ) : null}
              <div className="grid w-full max-w-3xl grid-cols-1 gap-3 text-left sm:grid-cols-2 animate-slide-up animate-delay-300">
                {STARTER_PROMPTS.map(({ label, prompt, icon: Icon }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => handleStarterPrompt(prompt)}
                    className="starter-card min-h-[76px] rounded-lg p-3 text-left transition-all duration-200 cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#171217]/70 border border-white/10 text-groove-gold">
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="font-semibold text-[#fff7eb]">{label}</span>
                    </div>
                    <p className="mt-2 text-xs leading-normal text-[#cbb8ae]">{prompt}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(() => {
            // Deduplicate messages by ID to prevent rendering the same message multiple times
            const seenIds = new Set();
            const uniqueMessages = messages.filter((message) => {
              if (seenIds.has(message.id)) {
                return false;
              }
              seenIds.add(message.id);
              return true;
            });

            return uniqueMessages.map((message) => {
              if (message.role === 'user') {
                return <UserMessage key={message.id} message={message} />;
              } else if (message.role === 'assistant') {
                // Show loading indicator only if this is the last message and it's empty and we're loading
                const isLastMessage = messages[messages.length - 1].id === message.id;
                const showLoading = isLoading && isLastMessage && !message.content;
                return <AssistantMessage key={message.id} message={message} isLoading={showLoading} />;
              } else if (message.role === 'system') {
                return <SystemMessage key={message.id} message={message} />;
              } else if (message.role === 'error') {
                return <ErrorMessage key={message.id} message={message} onRetry={retryLastMessage} />;
              }
              return null;
            });
          })()}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="px-4 md:px-6 pb-4 bg-gradient-to-t from-[#191218] via-[#191218]/92 to-transparent">
        <div className="max-w-4xl mx-auto space-y-3">
          {pendingActionError ? (
            <p className="text-sm text-red-300 text-center">{pendingActionError}</p>
          ) : null}
          {pendingActions.length > 0 ? (
            <div className="space-y-2">
              {pendingActions.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-groove-gold/40 bg-groove-gold/10 px-4 py-3 text-left shadow-[0_12px_30px_rgba(0,0,0,0.18)]"
                >
                  <p className="text-sm font-medium text-[#fff7eb]">Playlist ready for review</p>
                  <p className="text-xs text-[#eaded1] mt-1">
                    {p.payload?.name || 'Untitled'} - {Array.isArray(p.payload?.track_uris) ? p.payload.track_uris.length : 0}{' '}
                    tracks, {p.payload?.is_public ? 'public' : 'private'}
                  </p>
                  <p className="text-xs text-[#cbb8ae] mt-1 break-all">ID: {p.id}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleApprovePending(p.id)}
                      disabled={pendingActionBusy === p.id}
                      className="px-3 py-1.5 text-sm font-medium bg-groove-teal hover:bg-groove-mint text-[#171217] rounded-lg disabled:opacity-50 cursor-pointer"
                    >
                      {pendingActionBusy === p.id ? 'Working...' : 'Create on Spotify'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelPending(p.id)}
                      disabled={pendingActionBusy === p.id}
                      className="px-3 py-1.5 text-sm font-medium border border-white/15 text-[#eaded1] rounded-lg hover:border-groove-gold/50 disabled:opacity-50 cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <form onSubmit={handleSubmit} className="input-dock relative flex items-end gap-2 rounded-lg p-2">
            <div className="relative">
              <button
                ref={plusButtonRef}
                type="button"
                onClick={() => setIsConnectionsPopupOpen(!isConnectionsPopupOpen)}
                className="bg-[#362837] hover:bg-[#443142] text-groove-gold rounded-lg transition-colors duration-200 flex items-center justify-center flex-shrink-0 cursor-pointer border border-white/10 hover:border-groove-gold/60"
                style={{ height: '44px', width: '44px', padding: 0, boxSizing: 'border-box' }}
                title="Manage connections"
              >
                <Plus className="w-5 h-5" />
              </button>
              
              {/* Connections Popup */}
              {isConnectionsPopupOpen && (
                <div
                  ref={popupRef}
                  className="absolute bottom-full left-0 mb-2 w-64 bg-[#2b2029]/95 border border-white/15 rounded-lg shadow-2xl p-4 z-50 backdrop-blur"
                >
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-[#fff7eb] mb-1">Data Sources</h3>
                    <p className="text-xs text-[#cbb8ae]">Select connections to enable</p>
                  </div>
                  
                  <div className="space-y-2">
                    {availableConnections.map((connection) => {
                      const meta = SETTINGS_CONNECTION_META[connection.connection_type];
                      if (!meta) {
                        return null;
                      }
                      const isChecked = Boolean(selectedConnections[connection.connection_type]);
                      return (
                        <label
                          key={connection.connection_type}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleConnectionToggle(connection.connection_type)}
                            className="w-4 h-4 appearance-none bg-[#171217] border-2 border-white/20 rounded focus:ring-2 focus:ring-groove-teal focus:outline-none checked:bg-groove-teal checked:border-groove-teal relative"
                            style={{
                              backgroundImage: isChecked ? 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 20 20\' fill=\'white\'%3E%3Cpath fill-rule=\'evenodd\' d=\'M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z\' clip-rule=\'evenodd\'/%3E%3C/svg%3E")' : 'none',
                              backgroundSize: 'contain',
                              backgroundPosition: 'center',
                              backgroundRepeat: 'no-repeat'
                            }}
                          />
                          <img src={meta.icon} alt={meta.label} className="w-5 h-5 object-contain rounded" />
                          <span className="text-sm text-[#eaded1]">{meta.label}</span>
                        </label>
                      );
                    })}

                    {typeof onOpenSettings === 'function' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsConnectionsPopupOpen(false);
                          onOpenSettings();
                        }}
                        className="w-full mt-1 px-2 py-2 text-xs text-groove-teal hover:text-groove-mint hover:underline text-left cursor-pointer"
                      >
                        Open full settings...
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Ask about a song, scene, mood, or show..."
                disabled={isLoading}
                rows={1}
                className="w-full align-middle bg-[#171217]/82 text-[#fff7eb] placeholder:text-[#cbb8ae]/65 rounded-lg px-4 py-3 border border-white/10 focus:border-groove-teal focus:outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                style={{ minHeight: '44px', maxHeight: '200px', boxSizing: 'border-box' }}
              />
              
              {/* Commands Popup */}
              {showCommandsPopup && filteredCommands.length > 0 && (
                <div
                  ref={commandsPopupRef}
                  className="absolute bottom-full left-0 mb-2 w-80 bg-[#2b2029]/95 border border-white/15 rounded-lg shadow-2xl p-2 z-50 max-h-64 overflow-y-auto backdrop-blur"
                >
                  <div className="mb-2 px-2">
                    <h3 className="text-xs font-semibold text-[#cbb8ae] uppercase">Commands</h3>
                  </div>
                  <div className="space-y-1">
                    {filteredCommands.map((cmd, index) => (
                      <button
                        key={cmd.command}
                        type="button"
                        onClick={() => handleCommandSelect(cmd)}
                        className={`w-full text-left px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                          index === selectedCommandIndex
                            ? 'bg-groove-teal/15 border border-groove-teal/50'
                            : 'hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-groove-teal font-mono text-sm">/{cmd.command}</span>
                        </div>
                        <p className="text-xs text-[#cbb8ae] mt-0.5">{cmd.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {isLoading ? (
              <button
                type="button"
                onClick={cancelRequest}
                className="bg-red-500 hover:bg-red-400 text-white rounded-lg transition-colors duration-200 flex items-center justify-center flex-shrink-0 cursor-pointer"
                style={{ height: '44px', width: '44px', padding: 0, boxSizing: 'border-box' }}
                title="Stop generating"
              >
                <Square className="w-5 h-5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading || isApiKeyLoading || !hasApiKey}
                className="bg-gradient-to-br from-groove-coral via-groove-gold to-groove-teal text-[#171217] rounded-lg transition-all duration-200 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 cursor-pointer"
                style={{ height: '44px', width: '44px', padding: 0, boxSizing: 'border-box' }}
                title="Send message"
              >
                <Send className="w-5 h-5 fill-current" />
              </button>
            )}
          </form>
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-[#b9a69c]">
            <Music2 className="w-3.5 h-3.5 text-groove-gold" />
            <span>Ready for the next track, tangent, or playlist idea.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
