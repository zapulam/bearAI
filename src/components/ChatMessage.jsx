import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Format UTC timestamps from the backend into the user's local time.
// When isHistory is true, show date + time (MM/DD/YY, HH:MM); otherwise time only.
const formatTimeFromTimestamp = (rawTimestamp, isHistory = false) => {
  if (!rawTimestamp) return null;

  let timestampValue = rawTimestamp;

  // If timestamp is an array, use the first valid one
  if (Array.isArray(timestampValue)) {
    timestampValue = timestampValue.find(ts => ts);
    if (!timestampValue) return null;
  }

  // Normalize common SQLite UTC format "YYYY-MM-DD HH:MM:SS[.fractional]"
  // into an ISO-like UTC string so Date parses it as UTC.
  if (typeof timestampValue === 'string') {
    let normalized = timestampValue.trim();

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(normalized) && !normalized.includes('T')) {
      const [datePart, timePartWithFrac] = normalized.split(' ');
      const timePart = timePartWithFrac.split('.')[0];
      normalized = `${datePart}T${timePart}Z`;
    }

    timestampValue = normalized;
  }

  const date = new Date(timestampValue);
  if (Number.isNaN(date.getTime())) return null;

  // Let the browser convert from UTC to the user's local timezone.
  if (isHistory) {
    // Show date + time for messages loaded from history
    return date.toLocaleString([], {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // For live messages, show time only
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function UserMessage({ message }) {
  // Safely extract and format timestamp - ensure it's only rendered once
  const formatTimestamp = React.useMemo(() => {
    const rawTimestamp =
      message?.timestamp ?? message?.created_at ?? message?.time ?? null;
    const formatted = formatTimeFromTimestamp(rawTimestamp, message?.isHistory);
    if (!formatted) return null;

    // Don't show timestamp if it's already in the message content
    if (message?.content && message.content.includes(formatted)) {
      return null;
    }

    return formatted;
  }, [message?.timestamp, message?.created_at, message?.time, message?.isHistory, message?.content]);

  const timestamp = formatTimestamp;

  return (
    <div className="flex justify-end mb-4 animate-fade-in chat-font">
      <div className="flex items-start space-x-3 max-w-[85%] md:max-w-[78%]">
        <div className="flex-1">
          <div className="bg-gradient-to-br from-groove-coral via-[#ff8f5f] to-groove-gold text-[#1a1010] rounded-lg rounded-tr-sm px-4 py-3 shadow-[0_12px_30px_rgba(255,107,107,0.18)]">
            <p className="text-sm leading-normal whitespace-normal break-words">{message.content}</p>
            {timestamp && (
              <span key="timestamp" className="text-xs text-[#4b2418]/70 mt-1 block text-right">
                {timestamp}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AssistantMessage({ message, isLoading = false }) {
  const statusEvents = message.statusEvents || [];
  const [isStatusExpanded, setIsStatusExpanded] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState(new Set());
  const thought = message.thought || '';
  const hasResponse = !!message.content;
  const [isThoughtExpanded, setIsThoughtExpanded] = useState(!hasResponse);

  // Safely format timestamp for assistant messages
  const assistantTimestamp = React.useMemo(
    () => {
      const rawTimestamp =
        message?.timestamp ?? message?.created_at ?? message?.time ?? null;
      return formatTimeFromTimestamp(rawTimestamp, message?.isHistory);
    },
    [message?.timestamp, message?.created_at, message?.time, message?.isHistory]
  );

  // Automatically collapse thought once a response starts streaming
  useEffect(() => {
    if (hasResponse) {
      setIsThoughtExpanded(false);
    }
  }, [hasResponse]);
  
  const truncateText = (text, maxLength = 50) => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  // Truncate content to first 5 lines
  const truncateToLines = (content, maxLines = 5) => {
    if (!content) return { truncated: '', full: '', lineCount: 0 };
    const lines = content.split('\n');
    const lineCount = lines.length;
    if (lineCount <= maxLines) {
      return { truncated: content, full: content, lineCount };
    }
    const truncated = lines.slice(0, maxLines).join('\n');
    return { truncated, full: content, lineCount };
  };

  const toggleEventExpansion = (index) => {
    setExpandedEvents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  // Recursively unescape and format nested JSON strings
  const unescapeAndFormatJSON = (obj) => {
    if (typeof obj === 'string') {
      // Try to parse as JSON and recursively format
      try {
        const parsed = JSON.parse(obj);
        return unescapeAndFormatJSON(parsed);
      } catch (e) {
        // Not JSON, return as-is
        return obj;
      }
    } else if (Array.isArray(obj)) {
      return obj.map(item => unescapeAndFormatJSON(item));
    } else if (typeof obj === 'object' && obj !== null) {
      const formatted = {};
      for (const [key, value] of Object.entries(obj)) {
        formatted[key] = unescapeAndFormatJSON(value);
      }
      return formatted;
    }
    return obj;
  };

  // Format JSON content for display
  const formatContent = (content, eventType) => {
    if (eventType !== 'tool_output') {
      return content;
    }

    let contentToFormat = content;
    
    // Handle string content
    if (typeof content === 'string') {
      // Remove "Tool output: " prefix if present
      if (content.startsWith('Tool output: ')) {
        contentToFormat = content.substring('Tool output: '.length);
      }
      
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(contentToFormat);
        // Recursively unescape nested JSON strings
        const unescaped = unescapeAndFormatJSON(parsed);
        return JSON.stringify(unescaped, null, 2);
      } catch (e) {
        // If parsing fails, check if it's already an object stringified
        // Try to parse the original content
        try {
          const parsed = JSON.parse(content);
          const unescaped = unescapeAndFormatJSON(parsed);
          return JSON.stringify(unescaped, null, 2);
        } catch (e2) {
          // Not JSON, return original
          return content;
        }
      }
    }
    
    // Handle object content
    if (typeof content === 'object' && content !== null) {
      try {
        // Recursively unescape nested JSON strings
        const unescaped = unescapeAndFormatJSON(content);
        return JSON.stringify(unescaped, null, 2);
      } catch (e) {
        return String(content);
      }
    }
    
    return content;
  };
  
  const getStatusIcon = (type) => {
    switch (type) {
      case 'tool_call':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        );
      case 'tool_output':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'agent_update':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getStatusColor = (type) => {
    switch (type) {
      case 'tool_call':
        return 'text-groove-gold bg-groove-gold/10 border-groove-gold/25';
      case 'tool_output':
        return 'text-groove-teal bg-groove-teal/10 border-groove-teal/25';
      case 'agent_update':
        return 'text-groove-coral bg-groove-coral/10 border-groove-coral/25';
      default:
        return 'text-[#cbb8ae] bg-white/5 border-white/10';
    }
  };

  return (
    <div className="flex justify-start mb-4 animate-fade-in chat-font">
      <div className="flex items-start space-x-3 max-w-[88%] md:max-w-[78%]">
        <img src="/bear.png" alt="bearAI" className="flex-shrink-0 w-9 h-9 rounded-full object-contain p-1 bg-[#fff7eb]/90 ring-2 ring-groove-gold/30 shadow-[0_8px_22px_rgba(0,0,0,0.24)]" />
        <div className="flex-1 flex flex-col">
          <div className="rounded-lg border border-white/10 bg-[#2b2029]/78 px-4 py-3 text-[#fff7eb] shadow-[0_14px_35px_rgba(0,0,0,0.2)]">
            {isLoading && !message.content ? (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-groove-coral rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-groove-gold rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-groove-teal rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                  <span className="text-sm text-[#cbb8ae]">Tuning up</span>
                </div>
                {statusEvents.length > 0 && (
                  <div className="mt-3 space-y-1.5 flex flex-col">
                    {statusEvents.map((event, index) => (
                      <div
                        key={index}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs w-fit ${getStatusColor(event.type)} animate-fade-in`}
                      >
                        {getStatusIcon(event.type)}
                        <span className="text-left">{truncateText(event.content)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Streamed model reasoning (thought), left-aligned and collapsible once response appears */}
                {thought && (
                  <div className="mb-2 text-xs text-[#cbb8ae] whitespace-normal break-words text-left">
                    <button
                      type="button"
                      onClick={() => hasResponse && setIsThoughtExpanded(prev => !prev)}
                      className="flex items-center gap-1 mb-1 text-[#b9a69c] hover:text-[#fff7eb] transition-colors cursor-pointer disabled:cursor-default"
                      disabled={!hasResponse}
                    >
                      <svg
                        className={`w-3 h-3 transition-transform ${!hasResponse || isThoughtExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      <span className="font-semibold">Thought</span>
                    </button>
                    {(!hasResponse || isThoughtExpanded) && <p>{thought}</p>}
                  </div>
                )}

                {statusEvents.length > 0 && isLoading && (
                  <div className="mb-3 space-y-1.5 flex flex-col">
                    {statusEvents.map((event, index) => (
                      <div
                        key={index}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs w-fit ${getStatusColor(event.type)} animate-fade-in`}
                      >
                        {getStatusIcon(event.type)}
                        <span className="text-left">{truncateText(event.content)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-sm leading-normal break-words prose prose-invert prose-sm w-full text-left [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // Headings
                      h1: ({ node, ...props }) => <h1 className="text-2xl font-bold mt-4 mb-2 text-[#fff7eb]" {...props} />,
                      h2: ({ node, ...props }) => <h2 className="text-xl font-bold mt-3 mb-2 text-[#fff7eb]" {...props} />,
                      h3: ({ node, ...props }) => <h3 className="text-lg font-semibold mt-3 mb-2 text-[#fff7eb]" {...props} />,
                      h4: ({ node, ...props }) => <h4 className="text-base font-semibold mt-2 mb-1 text-[#fff7eb]" {...props} />,
                      h5: ({ node, ...props }) => <h5 className="text-sm font-semibold mt-2 mb-1 text-[#fff7eb]" {...props} />,
                      h6: ({ node, ...props }) => <h6 className="text-sm font-medium mt-2 mb-1 text-[#eaded1]" {...props} />,
                      // Paragraphs
                      p: ({ node, ...props }) => <p className="mb-1 text-[#fff7eb]" {...props} />,
                      // Lists
                      ul: ({ node, ...props }) => <ul className="list-disc list-outside mb-3 space-y-1 text-[#fff7eb] pl-5" {...props} />,
                      ol: ({ node, ...props }) => <ol className="list-decimal list-outside mb-3 space-y-1 text-[#fff7eb] pl-5" {...props} />,
                      li: ({ node, ...props }) => <li className="text-[#fff7eb]" {...props} />,
                      // Code blocks
                      code: ({ node, inline, className, children, ...props }) => {
                        if (inline) {
                          return (
                            <code className="bg-[#171217] text-groove-mint px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                              {children}
                            </code>
                          );
                        }
                        return (
                          <code className={`${className || ''} font-mono`} {...props}>
                            {children}
                          </code>
                        );
                      },
                      pre: ({ node, children, ...props }) => {
                        return (
                          <pre className="bg-[#171217] rounded-lg p-4 my-3 overflow-x-auto text-sm text-[#fff7eb] border border-white/10 whitespace-pre-wrap" {...props}>
                            {children}
                          </pre>
                        );
                      },
                      // Links
                      a: ({ node, ...props }) => <a className="text-groove-teal hover:text-groove-mint underline" target="_blank" rel="noopener noreferrer" {...props} />,
                      // Blockquotes
                      blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-groove-gold/40 pl-4 my-3 italic text-[#eaded1]" {...props} />,
                      // Horizontal rule
                      hr: ({ node, ...props }) => <hr className="my-4 border-white/10" {...props} />,
                      // Tables
                      table: ({ node, ...props }) => <table className="border-collapse border border-white/10 my-3 w-full" {...props} />,
                      thead: ({ node, ...props }) => <thead className="bg-[#171217]" {...props} />,
                      tbody: ({ node, ...props }) => <tbody {...props} />,
                      tr: ({ node, ...props }) => <tr className="border-b border-white/10" {...props} />,
                      th: ({ node, ...props }) => <th className="border border-white/10 px-3 py-2 text-left font-semibold text-[#fff7eb]" {...props} />,
                      td: ({ node, ...props }) => <td className="border border-white/10 px-3 py-2 text-[#fff7eb]" {...props} />,
                      // Strong and emphasis
                      strong: ({ node, ...props }) => <strong className="font-bold text-[#fff7eb]" {...props} />,
                      em: ({ node, ...props }) => <em className="italic" {...props} />,
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              </>
            )}
          </div>
          {message.content && assistantTimestamp && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-[#b9a69c]">
                {assistantTimestamp}
              </span>
              {statusEvents.length > 0 && (
                <button
                  onClick={() => setIsStatusExpanded(!isStatusExpanded)}
                  className="text-xs text-[#b9a69c] hover:text-[#fff7eb] transition-colors flex items-center gap-1 cursor-pointer"
                  title={isStatusExpanded ? 'Hide details' : 'Show details'}
                >
                  <svg 
                    className={`w-3 h-3 transition-transform ${isStatusExpanded ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  <span>{statusEvents.length} {statusEvents.length === 1 ? 'action' : 'actions'}</span>
                </button>
              )}
            </div>
          )}
          {isStatusExpanded && statusEvents.length > 0 && message.content && (
            <div className="mt-2 space-y-1.5 animate-fade-in flex flex-col">
              {statusEvents.map((event, index) => {
                const formattedContent = formatContent(event.content, event.type);
                // Check if content is JSON: either it's an object, or it's a formatted string that looks like JSON
                const isJSON = event.type === 'tool_output' && (
                  (typeof event.content === 'object' && event.content !== null) ||
                  (typeof formattedContent === 'string' && 
                   (formattedContent.trim().startsWith('{') || formattedContent.trim().startsWith('[')))
                );
                
                const { truncated, full, lineCount } = truncateToLines(formattedContent);
                const isExpanded = expandedEvents.has(index);
                const shouldTruncate = lineCount > 5;
                const displayContent = shouldTruncate && !isExpanded ? truncated : full;
                
                return (
                  <div
                    key={index}
                    className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs w-fit ${getStatusColor(event.type)}`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {getStatusIcon(event.type)}
                    </div>
                    <div className="flex flex-col">
                      {isJSON ? (
                        <pre className="overflow-x-auto text-xs font-mono whitespace-pre-wrap break-words text-left">
                          <code className="text-[#fff7eb]">{displayContent}</code>
                        </pre>
                      ) : (
                        <span className="break-words text-left">{displayContent}</span>
                      )}
                      {shouldTruncate && (
                        <button
                          onClick={() => toggleEventExpansion(index)}
                          className="mt-2 text-xs text-[#cbb8ae] hover:text-[#fff7eb] transition-colors flex items-center gap-1 self-start"
                        >
                          <svg 
                            className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                          <span>{isExpanded ? 'Show less' : `Show ${lineCount - 5} more line${lineCount - 5 === 1 ? '' : 's'}`}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SystemMessage({ message }) {
  return (
    <div className="flex justify-center mb-4">
      <div className="bg-[#2b2029]/70 text-[#cbb8ae] rounded-full px-4 py-2 text-xs border border-white/10">
        {message.content}
      </div>
    </div>
  );
}

export function ErrorMessage({ message, onRetry }) {
  return (
    <div className="flex justify-center mb-4">
      <div className="bg-red-500/10 border border-red-400/30 text-red-200 rounded-lg px-4 py-3 max-w-md">
        <div className="flex items-start space-x-2">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <p className="text-sm">{message.content}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-2 text-xs text-red-200 hover:text-white underline cursor-pointer"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

