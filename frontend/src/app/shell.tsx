import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";

function SidebarNav() {
  return (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className="flex items-baseline gap-2 px-2 pt-1 pb-4">
        <span className="text-sm font-bold tracking-tight">Knowledge Assistant</span>
        <span className="font-mono text-[10px] text-sidebar-foreground/50">v0</span>
      </div>
      <nav aria-label="Sections" className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return item.planned ? (
            <span
              key={item.id}
              aria-disabled="true"
              className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/40"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
              <em className="ml-auto rounded border border-sidebar-border px-1.5 py-px font-mono text-[9px] tracking-wide uppercase not-italic">
                planned
              </em>
            </span>
          ) : (
            <a
              key={item.id}
              href="#"
              aria-current="page"
              className="flex items-center gap-2.5 rounded-md bg-sidebar-accent px-2.5 py-2 text-sm font-medium text-sidebar-accent-foreground shadow-[inset_2px_0_0] shadow-sidebar-primary"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </a>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-sidebar-border px-2 pt-3 text-[11px] text-sidebar-foreground/50">
        grounded chat · $0 stack
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside
        className={cn(
          "w-60 shrink-0 bg-sidebar text-sidebar-foreground",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:transition-transform max-md:duration-200 motion-reduce:max-md:transition-none",
          open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        )}
      >
        <SidebarNav />
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
          <span className="ml-auto rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            demo mode
          </span>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
