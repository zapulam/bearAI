import React, { useEffect } from 'react';
import { useChatSessions } from '../hooks/useChatSessions';

export default function SideNav({ isOpen, onToggle, onNewChat, onSelectChat, onOpenSettings, onCloseSettings, onRefetchReady }) {
  const { sessions, loading, refetch } = useChatSessions();

  // Expose refetch function to parent component
  useEffect(() => {
    if (onRefetchReady && refetch) {
      onRefetchReady(refetch);
    }
  }, [onRefetchReady, refetch]);

  // Wrap onNewChat to also refetch sessions and close settings if open
  const handleNewChat = () => {
    if (onCloseSettings) {
      onCloseSettings();
    }
    onNewChat();
    // Refetch sessions after a short delay to allow backend to save
    setTimeout(() => {
      refetch();
    }, 1000);
  };

  // Handle logo click: expand sidebar if collapsed, or close settings if open
  const handleLogoClick = () => {
    if (!isOpen) {
      // If collapsed, only expand the sidebar
      onToggle();
    } else {
      // If open, only close settings (go to home)
      if (onCloseSettings) {
        onCloseSettings();
      }
    }
  };

  const handleSettingsClick = () => {
    if (onOpenSettings) {
      onOpenSettings();
    }
  };

  return (
    <div className={`${isOpen ? 'w-64' : 'w-14'} bg-surface-elevated border-r border-divider flex flex-col transition-all duration-300 flex-shrink-0 overflow-hidden overflow-x-hidden`}>
      {/* Logo and Toggle */}
      <div className="p-3 border-b border-divider flex items-center">
        <div className="flex items-center justify-between w-full">
          <button
            onClick={handleLogoClick}
            className="flex items-center cursor-pointer hover:bg-surface-hover/50 rounded-lg transition-colors duration-200"
            title={isOpen ? "Go to home" : "Expand sidebar"}
            aria-label={isOpen ? "Go to home" : "Expand sidebar"}
          >
            <img src="/bear.png" alt="bearAI" className="w-8 h-8 object-contain flex-shrink-0" />
          </button>
          {isOpen && (
            <button
              onClick={onToggle}
              className="p-2 text-gray-300 hover:text-white hover:bg-surface-hover rounded-lg transition-colors duration-200 flex-shrink-0 cursor-pointer"
              title="Collapse sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
      </div>
      
      {/* New Chat Button */}
      <div className="px-1.5 py-1">
        <button
          onClick={handleNewChat}
          className="flex items-center space-x-2 px-3 py-3 text-gray-300 hover:text-white hover:bg-surface-hover rounded-lg transition-colors duration-200 w-full cursor-pointer"
          title="New chat"
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className={`text-sm font-medium whitespace-nowrap transition-all duration-300 ${isOpen ? 'opacity-100 max-w-full' : 'opacity-0 max-w-0 overflow-hidden'}`}>New chat</span>
        </button>
      </div>
      
      {/* Search Chat Button */}
      <div className="px-1.5 py-1">
        <button
          onClick={() => {/* TODO: Implement search */}}
          className="flex items-center space-x-2 px-3 py-3 text-gray-300 hover:text-white hover:bg-surface-hover rounded-lg transition-colors duration-200 w-full cursor-pointer"
          title="Search chats"
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className={`text-sm font-medium whitespace-nowrap transition-all duration-300 ${isOpen ? 'opacity-100 max-w-full' : 'opacity-0 max-w-0 overflow-hidden'}`}>Search chats</span>
        </button>
      </div>
      
      {/* Chat History */}
      <div className="flex-1 px-3 py-3 overflow-y-auto overflow-x-hidden border-t border-divider scrollbar-none">
        {isOpen ? (
          <div className="min-w-0 max-w-full">
            <h3 className="text-xs font-semibold text-gray-400 mb-2 whitespace-nowrap text-left">
              Chats
            </h3>
            {loading ? (
              <p className="text-sm text-gray-500 italic px-2 whitespace-nowrap text-left">Loading...</p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-gray-500 italic px-2 whitespace-nowrap text-left">No previous chats</p>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => (
                  <button
                    key={session.conversation_id || session.session_id}
                    onClick={() => onSelectChat && onSelectChat(session.conversation_id || session.session_id)}
                    className="w-full text-left px-2 py-2 rounded-lg text-sm text-gray-300 hover:bg-surface-hover hover:text-white transition-colors duration-200 truncate cursor-pointer"
                    title={session.summary}
                  >
                    {session.summary}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
      
      <div className="px-1.5 py-1 border-t border-divider mt-auto">
        <button
          onClick={handleSettingsClick}
          className="flex items-center space-x-2 px-3 py-3 text-gray-300 hover:text-white hover:bg-surface-hover rounded-lg transition-colors duration-200 w-full cursor-pointer"
          title="Settings"
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className={`text-sm font-medium whitespace-nowrap transition-all duration-300 ${isOpen ? 'opacity-100 max-w-full' : 'opacity-0 max-w-0 overflow-hidden'}`}>Settings</span>
        </button>
      </div>
    </div>
  );
}
