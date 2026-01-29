import { useState, useCallback, useRef, useEffect } from 'react';
import { API_ENDPOINTS, buildApiUrl } from '../config/api';

export const useChat = (initialSessionId = null) => {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const abortControllerRef = useRef(null);
  const loadedSessionRef = useRef(null);

  useEffect(() => {
    if (initialSessionId) {
      // Prevent multiple loads for the same session
      if (loadedSessionRef.current === initialSessionId) {
        return;
      }
      
      loadedSessionRef.current = initialSessionId;
      setSessionId(initialSessionId);
      // Load chat history for this session
      setLoadingHistory(true);
      const url = buildApiUrl(`${API_ENDPOINTS.CHAT_HISTORY}?conversation_id=${encodeURIComponent(initialSessionId)}`);
      
      fetch(url)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          if (!data || !data.messages) {
            setMessages([]);
            setLoadingHistory(false);
            return; // Early return to prevent further processing
          }
          
          // Convert backend messages to frontend format
          // Filter out messages without content (these are tool calls, not actual messages)
          const messagesWithContent = data.messages.filter((msg) => {
            // Exclude messages that don't have a content field or have empty/null/undefined content
            // Tool calls don't have content, so they should be filtered out
            if (!msg.hasOwnProperty('content')) {
              return false;
            }
            if (msg.content === null || msg.content === undefined) {
              return false;
            }
            // Also filter out empty strings - tool calls might have content: ""
            if (typeof msg.content === 'string' && msg.content.trim() === '') {
              return false;
            }
            return true;
          });
          
          // Deduplicate messages by content and role to prevent duplicates
          const seenMessages = new Set();
          const uniqueMessages = messagesWithContent.filter((msg) => {
            // Normalize content for comparison
            const contentStr = typeof msg.content === 'string' 
              ? msg.content 
              : JSON.stringify(msg.content);
            const key = `${msg.role}-${contentStr}`;
            if (seenMessages.has(key)) {
              return false;
            }
            seenMessages.add(key);
            return true;
          });
          
          const formattedMessages = uniqueMessages
            .map((msg, index) => {
              // Handle assistant messages where content might be a dict,
              // list of dicts, or a JSON string with thought/response/status.
              let content = msg.content;
              let thought = null;

              if (msg.role === 'assistant') {
                // Preserve any thought field from backend history so UI can render it
                if (msg.thought !== undefined && msg.thought !== null) {
                  if (typeof msg.thought === 'string') {
                    thought = msg.thought;
                  } else {
                    try {
                      thought = JSON.stringify(msg.thought);
                    } catch {
                      thought = String(msg.thought);
                    }
                  }
                }

                // Fallback: if content is a JSON string that looks like structured
                // output, split it into thought/response so it matches live chats.
                if (!thought && typeof content === 'string') {
                  const trimmed = content.trim();
                  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    try {
                      const parsed = JSON.parse(trimmed);
                      if (parsed && (parsed.thought || parsed.response || parsed.status)) {
                        const parsedThought = parsed.thought;
                        const parsedResponse = parsed.response;

                        if (parsedThought !== undefined && parsedThought !== null) {
                          if (typeof parsedThought === 'string') {
                            thought = parsedThought;
                          } else {
                            try {
                              thought = JSON.stringify(parsedThought);
                            } catch {
                              thought = String(parsedThought);
                            }
                          }
                        }

                        if (parsedResponse !== undefined && parsedResponse !== null) {
                          if (typeof parsedResponse === 'string') {
                            content = parsedResponse;
                          } else {
                            try {
                              content = JSON.stringify(parsedResponse);
                            } catch {
                              content = String(parsedResponse);
                            }
                          }
                        }
                      }
                    } catch {
                      // Not valid JSON structured output; leave content as-is
                    }
                  }
                }

                if (Array.isArray(content) && content.length > 0) {
                  // Handle list of dicts like [{"text": "...", ...}]
                  const firstItem = content[0];
                  if (typeof firstItem === 'object' && firstItem !== null) {
                    content = firstItem.text || firstItem.content || '';
                  } else {
                    content = String(firstItem);
                  }
                } else if (typeof content === 'object' && content !== null) {
                  // Extract text from dict structure like {'text': '...', ...}
                  content = content.text || content.content || '';
                } else if (typeof content !== 'string') {
                  // Fallback: convert to string if it's not already a string
                  content = String(content);
                }
              } else if (typeof content !== 'string') {
                // For non-assistant messages, convert to string if needed
                content = String(content);
              }
              
              // Use timestamp from backend if available; for historical messages
              // we should not fall back to "now" because that misrepresents when
              // the message was actually created.
              const timestamp = msg.timestamp || msg.created_at || msg.time || null;
              
              return {
                id: `${msg.role}-${initialSessionId}-${index}`,
                role: msg.role,
                content: content,
                // Ensure historical assistant messages match the live chat shape
                ...(msg.role === 'assistant' && thought ? { thought } : {}),
                // Mark history messages so the UI can show date+time formatting
                isHistory: true,
                timestamp: timestamp,
                statusEvents: [], // Initialize statusEvents for loaded messages
              };
            })
            .filter((msg) => {
              // Final filter: exclude messages with empty content after processing
              // This catches cases where content becomes empty during processing
              return msg.content && typeof msg.content === 'string' && msg.content.trim().length > 0;
            });
          setMessages(formattedMessages);
        })
        .catch(err => {
          setMessages([]);
        })
        .finally(() => {
          setLoadingHistory(false);
        });
    } else {
      loadedSessionRef.current = null;
      const id = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      setSessionId(id);
      setMessages([]);
    }
  }, [initialSessionId]);

  const sendMessage = useCallback(async (content) => {
    const trimmedContent = content.trim();
    
    // Validate that content is not empty and not just a timestamp
    if (!trimmedContent || isLoading) return;
    
    // Prevent sending messages that are just timestamps
    const timestampPattern = /^\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?$/i;
    if (timestampPattern.test(trimmedContent)) {
      console.warn('Attempted to send a message with timestamp-only content, ignoring.');
      return;
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedContent,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    abortControllerRef.current = new AbortController();

    // Create a placeholder assistant message that we'll update as chunks arrive
    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      statusEvents: [], // Track status events like tool calls, agent updates, etc.
    };

    setMessages(prev => [...prev, assistantMessage]);

    try {
      // Build conversation history in the format expected by the backend
      const conversationHistory = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role,
          content: m.content,
        }));

      const url = buildApiUrl(API_ENDPOINTS.CHAT);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversation_id: sessionId,
          user_input: content.trim(),
          conversation_history: conversationHistory,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';
      let accumulatedThought = '';
      let accumulatedResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'thought') {
                // Stream model reasoning into a separate thought field
                accumulatedThought += data.content;
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, thought: accumulatedThought }
                    : msg
                ));
              } else if (data.type === 'response') {
                // Stream user-facing response into main content
                accumulatedResponse += data.content;
                accumulatedContent = accumulatedResponse;
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: accumulatedResponse }
                    : msg
                ));
              } else if (data.type === 'chunk') {
                // Backwards compatibility: treat generic chunks as response text
                accumulatedResponse += data.content;
                accumulatedContent = accumulatedResponse;
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: accumulatedResponse }
                    : msg
                ));
              } else if (data.type === 'complete') {
                // Final update with complete thought/response content
                const finalThought = data.thought || accumulatedThought;
                const finalResponse = data.response || data.content || accumulatedResponse || accumulatedContent;
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, thought: finalThought, content: finalResponse }
                    : msg
                ));
              } else if (data.type === 'error') {
                throw new Error(data.content || 'Unknown error occurred');
              } else if (data.type === 'tool_call' || data.type === 'tool_output' || data.type === 'agent_update') {
                // Capture status events for display
                setMessages(prev => prev.map(msg => 
                  msg.id === assistantMessageId 
                    ? { 
                        ...msg, 
                        statusEvents: [...(msg.statusEvents || []), {
                          type: data.type,
                          content: data.content,
                          timestamp: new Date().toISOString(),
                        }]
                      }
                    : msg
                ));
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError);
            }
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Request was cancelled');
        // Remove the incomplete assistant message
        setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
        return;
      }

      console.error('Error sending message:', err);
      setError(err.message);
      
      // Replace the incomplete message with an error message
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessageId 
          ? {
              id: `error-${Date.now()}`,
              role: 'error',
              content: `Failed to get response: ${err.message}`,
              timestamp: new Date().toISOString(),
            }
          : msg
      ));
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [isLoading, messages, sessionId]);

  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
    const id = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    setSessionId(id);
  }, []);

  const retryLastMessage = useCallback(() => {
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMessage) {
      setMessages(prev => prev.filter(m => 
        m.timestamp <= lastUserMessage.timestamp
      ).slice(0, -1));
      sendMessage(lastUserMessage.content);
    }
  }, [messages, sendMessage]);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    cancelRequest,
    clearChat,
    retryLastMessage,
    sessionId,
  };
};

