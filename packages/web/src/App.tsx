import { Chat } from "./components/Chat";
import { ExtensionPrompt } from "./components/ExtensionPrompt";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { useAgent } from "./hooks/useAgent";
import { useChatStore } from "./stores/chatStore";
import { useState } from "react";

export function App() {
  const agent = useAgent();
  const connected = useChatStore((s) => s.connected);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950">
      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        agent={agent}
      />

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        <Header
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
          agent={agent}
        />

        {!connected && (
          <div className="flex items-center justify-center gap-2 bg-amber-900/30 px-4 py-2 text-sm text-amber-200">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            Connecting to server...
          </div>
        )}

        <Chat agent={agent} />
      </div>

      <ExtensionPrompt agent={agent} />
    </div>
  );
}
