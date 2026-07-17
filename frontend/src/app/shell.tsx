import { useState, type ReactNode } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";

const COLLAPSE_KEY = "knowledge-assistant:sidebar-collapsed";

function SidebarNav({
  threads,
  collapsed,
  onToggleCollapse,
}: {
  threads?: ReactNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-1 p-3">
      <div
        className={cn(
          "flex items-center gap-2 px-2 pt-1 pb-4",
          collapsed && "justify-center px-0",
        )}
      >
        {!collapsed && (
          <>
            <span className="text-sm font-bold tracking-tight">
              Knowledge Assistant
            </span>
            <span className="font-mono text-[10px] text-sidebar-foreground/50">
              v0
            </span>
          </>
        )}
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapse}
          className={cn(
            "rounded-md p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground max-md:hidden",
            !collapsed && "ml-auto",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </button>
      </div>
      <nav
        aria-label="Sections"
        data-collapsed={collapsed}
        className="flex flex-col gap-0.5"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return item.planned ? (
            <span
              key={item.id}
              aria-disabled="true"
              title={collapsed ? `${item.label} (planned)` : undefined}
              className={cn(
                "flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/40",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {!collapsed && (
                <>
                  {item.label}
                  <em className="ml-auto rounded border border-sidebar-border px-1.5 py-px font-mono text-[9px] tracking-wide uppercase not-italic">
                    planned
                  </em>
                </>
              )}
            </span>
          ) : (
            <a
              key={item.id}
              href="#"
              aria-current="page"
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md bg-sidebar-accent px-2.5 py-2 text-sm font-medium text-sidebar-accent-foreground shadow-[inset_2px_0_0] shadow-sidebar-primary",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {!collapsed && item.label}
            </a>
          );
        })}
      </nav>
      {threads && !collapsed ? (
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 border-t border-sidebar-border pt-3">
          <span className="px-2 font-mono text-[10px] tracking-widest text-sidebar-foreground/50 uppercase">
            Recent chats
          </span>
          <div className="min-h-0 flex-1 overflow-y-auto">{threads}</div>
        </div>
      ) : null}
      {!collapsed && (
        <div className="mt-auto border-t border-sidebar-border px-2 pt-3 text-[11px] text-sidebar-foreground/50">
          grounded chat · $0 stack
        </div>
      )}
    </div>
  );
}

export function AppShell({
  children,
  threads,
  topbar,
}: {
  children: ReactNode;
  threads?: ReactNode;
  topbar?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "true",
  );
  const toggleCollapse = () => {
    setCollapsed((v) => {
      localStorage.setItem(COLLAPSE_KEY, String(!v));
      return !v;
    });
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside
        className={cn(
          "shrink-0 bg-sidebar text-sidebar-foreground",
          collapsed ? "w-14" : "w-60",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:w-60 max-md:transition-transform max-md:duration-200 motion-reduce:max-md:transition-none",
          open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        )}
      >
        <SidebarNav
          threads={threads}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
        />
      </aside>
      {open && (
        <button
          aria-label="Close menu"
          className="fixed inset-0 z-20 bg-black/45 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
          <button
            aria-label={open ? "Close menu" : "Open menu"}
            className="rounded-md p-1.5 hover:bg-accent md:hidden"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
          <span className="text-sm font-semibold">Chat</span>
          {topbar ?? (
            <span className="ml-auto rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
              demo mode
            </span>
          )}
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
