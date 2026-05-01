import React, { useState, useRef, useEffect } from "react";
import SideNav from "./components/SideNav";
import ChatInterface from "./components/ChatInterface";
import Settings from "./components/Settings";

export default function App() {
  const [isSideNavOpen, setIsSideNavOpen] = useState(true);
  const [chatKey, setChatKey] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const refetchSessionsRef = useRef(null);

  useEffect(() => {
    if (window.location.pathname === "/spotify/callback") {
      setShowSettings(true);
    }
  }, []);

  const handleNewChat = () => {
    setSelectedSessionId(null);
    setChatKey(prev => prev + 1);
  };

  const handleSelectChat = (sessionId) => {
    setSelectedSessionId(sessionId);
    setChatKey(prev => prev + 1);
  };

  const handleRefetchReady = (refetchFn) => {
    refetchSessionsRef.current = refetchFn;
  };

  return (
    <div className="music-backdrop flex flex-row w-screen h-screen min-h-screen text-ink-soft">
      <SideNav 
        isOpen={isSideNavOpen} 
        onToggle={() => setIsSideNavOpen(!isSideNavOpen)}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onOpenSettings={() => setShowSettings(true)}
        onCloseSettings={() => setShowSettings(false)}
        onRefetchReady={handleRefetchReady}
      />
      <div className="h-full w-full flex flex-col overflow-hidden relative">
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {showSettings ? (
            <Settings onClose={() => setShowSettings(false)} />
          ) : (
            <ChatInterface 
              key={chatKey}
              initialSessionId={selectedSessionId}
              isSideNavOpen={isSideNavOpen}
              onToggleSideNav={() => setIsSideNavOpen(!isSideNavOpen)}
              onOpenSettings={() => setShowSettings(true)}
              onSessionUpdate={() => {
                if (refetchSessionsRef.current) {
                  refetchSessionsRef.current();
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
