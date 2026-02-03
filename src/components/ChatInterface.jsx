import React, { useState, useRef, useEffect } from 'react';
import { UserMessage, AssistantMessage, SystemMessage, ErrorMessage } from './ChatMessage';
import { useChat } from '../hooks/useChat';
import { API_ENDPOINTS, buildApiUrl } from '../config/api';
import { HelpCircle } from 'lucide-react';

const BEAR_IMAGES = [
  '/bear.png',
  '/bear_blink.png',
  '/bear_ears.png'
];

const SETTINGS_CONNECTION_META = {
  gmail: { label: 'Gmail', icon: '/gmail.png' },
  jira: { label: 'Jira', icon: '/jira.png' },
  outlook: { label: 'Outlook', icon: '/outlook.png' },
  spotify: { label: 'Spotify', icon: '/spotify.png' },
};

const TOOL_COMMANDS_BY_CONNECTION = {
  gmail: [
    { command: 'gmail_search_messages', description: 'Search Gmail messages' },
    { command: 'gmail_get_recent_emails', description: 'Fetch recent Gmail emails' },
    { command: 'gmail_send_email', description: 'Send a Gmail email' },
  ],
  jira: [
    { command: 'JiraTool', description: 'Search Jira via MCP' },
    { command: 'search', description: 'Search Jira/Confluence via MCP' },
  ],
  intercom: [
    { command: 'search', description: 'Search Intercom' },
    { command: 'fetch', description: 'Fetch Intercom resource details' },
    { command: 'search_conversations', description: 'Search Intercom conversations' },
    { command: 'get_conversation', description: 'Get Intercom conversation by ID' },
    { command: 'search_contacts', description: 'Search Intercom contacts' },
    { command: 'get_contact', description: 'Get Intercom contact by ID' },
  ],
  outlook: [
    { command: 'outlook_search_messages', description: 'Search Outlook messages' },
    { command: 'outlook_get_recent_emails', description: 'Fetch recent Outlook emails' },
    { command: 'outlook_send_email', description: 'Send an Outlook email' },
  ],
  spotify: [
    { command: 'spotify_get_profile', description: 'Get Spotify profile' },
    { command: 'spotify_get_top_items', description: 'Get top Spotify items' },
    { command: 'spotify_get_recommendations', description: 'Get Spotify recommendations' },
    { command: 'spotify_get_audio_analysis', description: 'Get Spotify audio analysis' },
    { command: 'spotify_get_new_releases', description: 'Get new releases from top artists' },
    { command: 'spotify_get_genre_seeds', description: 'Get Spotify genre seeds' },
  ],
};

const TOOL_COMMANDS_ALWAYS_AVAILABLE = [
  { command: 'search_help_docs', description: 'Search bearAI help documentation', key: 'bearAiHelp' },
];

export default function ChatInterface({ initialSessionId, isSideNavOpen, onToggleSideNav, onSessionUpdate }) {
  const [inputValue, setInputValue] = useState('');
  const [bearImage, setBearImage] = useState(BEAR_IMAGES[0]);
  const [isConnectionsPopupOpen, setIsConnectionsPopupOpen] = useState(false);
  const [showCommandsPopup, setShowCommandsPopup] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [selectedConnections, setSelectedConnections] = useState({
    bearAiHelp: true,
  });
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
  const { messages, isLoading, sendMessage, cancelRequest, clearChat, retryLastMessage, sessionId } = useChat(initialSessionId);

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
    <div className="flex flex-col h-full bg-surface shadow-[inset_0_0_30px_rgba(34,197,94,0.1)]">
      {/* Chat Header */}
      <div className="px-4 py-3 flex items-center justify-end">
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsHelpOpen((prev) => !prev)}
            className="p-1 text-gray-300 hover:text-white hover:bg-surface-hover rounded-lg transition-colors duration-200 cursor-pointer"
            title="What can bearAI do?"
            aria-label="Open bearAI help"
          >
            <HelpCircle className="w-5.5 h-5.5" />
          </button>
          {isHelpOpen && (
            <div className="absolute right-0 mt-2 w-72 bg-surface-elevated border border-divider rounded-xl shadow-2xl p-3 z-50 text-left">
              <p className="text-sm text-gray-200 mb-2">
                bearAI can search Intercom, Jira, DevOps, Slack, Tettra, and bearAI Help,
                help explain how data is stored in your database, how features work in your codebase,
                and help troubleshoot issues.
              </p>
              <p className="text-xs text-gray-400">
                Use natural language or type <span className="font-mono text-gray-200">/</span> to see focused commands which will help direct your requests.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-none">
        <div className={`max-w-7xl mx-auto ${isWelcomeScreen ? 'flex items-center min-h-full' : ''}`}>
          {isWelcomeScreen && (
            <div className="flex flex-col items-center justify-center w-full text-center animate-slide-up">
              <div className="mb-6 relative flex items-center justify-center">
                <div className="absolute w-70 h-70 rounded-full bg-orange-400/20 blur-3xl" />
                <img
                  src={bearImage}
                  alt="bearAI"
                  className="w-36 h-36 object-contain z-10 drop-shadow-[0_0_12px_rgba(255,140,64,0.35)]"
                />
              </div>
              <h1 className="text-4xl font-bold mb-4 animate-slide-up animate-delay-100 bg-gradient-to-r from-orange-400 to-green-400 text-transparent bg-clip-text drop-shadow-[0_0_12px_rgba(255,140,64,0.35)]">
                Welcome to bearAI
              </h1>
              <p className="text-lg text-gray-300 mb-2 max-w-2xl animate-slide-up animate-delay-200">
                Your cozy AI helper for late-night ideas and steady guidance.
              </p>
              <p className="text-base text-gray-400 mb-8 max-w-2xl animate-slide-up animate-delay-300">
                I'm here to help. Ask away and I'll walk with you step by step.
              </p>
              {!isApiKeyLoading && !hasApiKey && (
                <p className="text-sm text-orange-300 mb-6 max-w-2xl animate-slide-up animate-delay-300">
                  Set your OpenAI API key in Settings to start chatting.
                </p>
              )}
              <div className="flex items-center gap-2 text-sm text-gray-500 animate-slide-up animate-delay-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Start a conversation below to get started</span>
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
      <div className="px-6 pb-4">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
            <div className="relative">
              <button
                ref={plusButtonRef}
                type="button"
                onClick={() => setIsConnectionsPopupOpen(!isConnectionsPopupOpen)}
                className="bg-surface-elevated hover:bg-surface-elevated/80 text-white rounded-lg transition-colors duration-200 flex items-center justify-center flex-shrink-0 cursor-pointer border border-divider hover:border-green-500"
                style={{ height: '44px', width: '44px', padding: 0, boxSizing: 'border-box' }}
                title="Manage connections"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
              </button>
              
              {/* Connections Popup */}
              {isConnectionsPopupOpen && (
                <div
                  ref={popupRef}
                  className="absolute bottom-full left-0 mb-2 w-64 bg-surface-elevated border border-divider rounded-lg shadow-2xl p-4 z-50"
                >
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-gray-400 mb-1">Data Sources</h3>
                    <p className="text-xs text-gray-400">Select connections to enable</p>
                  </div>
                  
                  <div className="space-y-2">
                    {availableConnections.map((connection) => {
                      const meta = SETTINGS_CONNECTION_META[connection.connection_type];
                      const isChecked = Boolean(selectedConnections[connection.connection_type]);
                      return (
                        <label
                          key={connection.connection_type}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface/50 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleConnectionToggle(connection.connection_type)}
                            className="w-4 h-4 appearance-none bg-gray-800 border-2 border-gray-600 rounded focus:ring-2 focus:ring-green-500 focus:outline-none checked:bg-green-500 checked:border-green-500 relative"
                            style={{
                              backgroundImage: isChecked ? 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 20 20\' fill=\'white\'%3E%3Cpath fill-rule=\'evenodd\' d=\'M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z\' clip-rule=\'evenodd\'/%3E%3C/svg%3E")' : 'none',
                              backgroundSize: 'contain',
                              backgroundPosition: 'center',
                              backgroundRepeat: 'no-repeat'
                            }}
                          />
                          <img src={meta.icon} alt={meta.label} className="w-5 h-5 object-contain rounded" />
                          <span className="text-sm text-gray-400">{meta.label}</span>
                        </label>
                      );
                    })}

                    <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface/50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedConnections.bearAiHelp}
                        onChange={() => handleConnectionToggle('bearAiHelp')}
                        className="w-4 h-4 appearance-none bg-gray-800 border-2 border-gray-600 rounded focus:ring-2 focus:ring-green-500 focus:outline-none checked:bg-green-500 checked:border-green-500 relative"
                        style={{
                          backgroundImage: selectedConnections.bearAiHelp ? 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 20 20\' fill=\'white\'%3E%3Cpath fill-rule=\'evenodd\' d=\'M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z\' clip-rule=\'evenodd\'/%3E%3C/svg%3E")' : 'none',
                          backgroundSize: 'contain',
                          backgroundPosition: 'center',
                          backgroundRepeat: 'no-repeat'
                        }}
                      />
                      <img src="/bear.png" alt="bearAI Help" className="w-5 h-5 object-contain rounded" />
                      <span className="text-sm text-gray-400">bearAI Help</span>
                    </label>
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
                placeholder="Ask me anything... (type / for commands)"
                disabled={isLoading}
                rows={1}
                className="w-full align-middle bg-surface-elevated text-white rounded-lg px-4 py-3 border border-divider focus:border-green-500 focus:outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                style={{ minHeight: '44px', maxHeight: '200px', boxSizing: 'border-box' }}
              />
              
              {/* Commands Popup */}
              {showCommandsPopup && filteredCommands.length > 0 && (
                <div
                  ref={commandsPopupRef}
                  className="absolute bottom-full left-0 mb-2 w-80 bg-surface-elevated border border-divider rounded-lg shadow-2xl p-2 z-50 max-h-64 overflow-y-auto"
                >
                  <div className="mb-2 px-2">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase">Commands</h3>
                  </div>
                  <div className="space-y-1">
                    {filteredCommands.map((cmd, index) => (
                      <button
                        key={cmd.command}
                        type="button"
                        onClick={() => handleCommandSelect(cmd)}
                        className={`w-full text-left px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                          index === selectedCommandIndex
                            ? 'bg-green-600/20 border border-green-500/50'
                            : 'hover:bg-surface/50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-green-400 font-mono text-sm">/{cmd.command}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{cmd.description}</p>
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
                className="bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors duration-200 flex items-center justify-center flex-shrink-0 cursor-pointer"
                style={{ height: '44px', width: '44px', padding: 0, boxSizing: 'border-box' }}
                title="Stop generating"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading || isApiKeyLoading || !hasApiKey}
                className="bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 cursor-pointer"
                style={{ height: '44px', width: '44px', padding: 0, boxSizing: 'border-box' }}
                title="Send message"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            )}
          </form>
          <div className="mt-2 text-xs text-gray-500 text-center">
            Press Enter to send, Shift+Enter for new line
          </div>
        </div>
      </div>
    </div>
  );
}
