import { useEffect, useState } from "react";
import { AppShell } from "@/app/shell";
import { onChatViewRequest } from "@/app/chat-navigation";
import {
  onWikiNavigationRequest,
  onWikiProposalsRequest,
} from "@/app/wiki-navigation";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatPage } from "@/features/chat/chat-page";
import { ComposerCreateDialogs } from "@/features/chat/composer-create-dialogs";
import { ChatProvider } from "@/features/chat/chat-provider";
import { TopbarStatus } from "@/features/chat/topbar-status";
import { DocumentsPage } from "@/features/knowledge/documents-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { SettingsProvider } from "@/features/settings/settings-provider";
import { SkillsPage } from "@/features/skills/skills-page";
import { WikiPage } from "@/features/wiki/wiki-page";

type View = "chat" | "settings" | "documents" | "wiki" | "skills";
const TITLES: Record<View, string> = {
  chat: "Chat",
  settings: "Settings",
  documents: "Documents",
  wiki: "Wiki",
  skills: "Skills",
};

const VIEW_KEY = "knowledge-assistant:active-view";
const VIEWS: View[] = ["chat", "settings", "documents", "wiki", "skills"];

function loadView(): View {
  const stored = localStorage.getItem(VIEW_KEY);
  return VIEWS.includes(stored as View) ? (stored as View) : "chat";
}

function App() {
  // Persist the active section so a page reload returns to where you were,
  // rather than always snapping back to a blank chat.
  const [view, setViewState] = useState<View>(loadView);
  const [wikiOpenSlug, setWikiOpenSlug] = useState<string | null>(null);
  // Bumped when the Wiki nav item is clicked, so `WikiPage` resets to its top
  // level even when it's already the active view (a nested page/folder).
  const [wikiHomeToken, setWikiHomeToken] = useState(0);
  // Bumped when a finished skill run asks to open the proposals inbox.
  const [wikiProposalsToken, setWikiProposalsToken] = useState(0);

  const setView = (next: View) => {
    localStorage.setItem(VIEW_KEY, next);
    setViewState(next);
  };

  useEffect(
    () =>
      onWikiNavigationRequest(({ slug }) => {
        setView("wiki");
        setWikiOpenSlug(slug);
      }),
    [],
  );

  useEffect(() => onChatViewRequest(() => setView("chat")), []);

  useEffect(
    () =>
      onWikiProposalsRequest(() => {
        setView("wiki");
        setWikiProposalsToken((t) => t + 1);
      }),
    [],
  );

  return (
    <SettingsProvider>
      {/* assistant-ui's attachment tiles render a raw Radix Tooltip, so the app
          must mount a TooltipProvider at the root. */}
      <TooltipProvider>
        <ChatProvider>
          <AppShell
            threads={<ThreadList />}
            topbar={<TopbarStatus />}
            title={TITLES[view]}
            active={view}
            onNavigate={(id) => {
              if (
                id === "chat" ||
                id === "settings" ||
                id === "documents" ||
                id === "wiki" ||
                id === "skills"
              ) {
                // Re-clicking Wiki jumps back to its top level (clears any open
                // page/folder), matching the expectation that a nav item is
                // "home" for its section.
                if (id === "wiki") {
                  setWikiOpenSlug(null);
                  setWikiHomeToken((t) => t + 1);
                }
                setView(id);
              }
            }}
          >
            {/* chat stays mounted so runtime and thread state survive view switches */}
            <div className="h-full" hidden={view !== "chat"}>
              <ChatPage />
            </div>
            {view === "settings" && <SettingsPage />}
            {view === "documents" && <DocumentsPage />}
            {view === "skills" && <SkillsPage />}
            {view === "wiki" && (
              <WikiPage
                openSlug={wikiOpenSlug}
                onOpened={() => setWikiOpenSlug(null)}
                homeToken={wikiHomeToken}
                openProposalsToken={wikiProposalsToken}
              />
            )}
          </AppShell>
          {/* Create-page/collection dialogs triggered by chat `/` commands —
              mounted here so they overlay the active view without navigating. */}
          <ComposerCreateDialogs />
        </ChatProvider>
      </TooltipProvider>
    </SettingsProvider>
  );
}

export default App;
