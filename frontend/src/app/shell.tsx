import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

const COLLAPSE_KEY = "knowledge-assistant:sidebar-collapsed";

function AppSidebarTrigger() {
  const { state, isMobile, openMobile } = useSidebar();
  const label = isMobile
    ? openMobile
      ? "Close menu"
      : "Open menu"
    : state === "collapsed"
      ? "Expand sidebar"
      : "Collapse sidebar";
  return <SidebarTrigger aria-label={label} />;
}

function AppSidebar({
  threads,
  active,
  onNavigate,
}: {
  threads?: ReactNode;
  active: string;
  onNavigate: (id: string) => void;
}) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 pt-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="text-sm font-bold tracking-tight group-data-[collapsible=icon]:hidden">
            Knowledge Assistant
          </span>
          <span className="font-mono text-[10px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
            v0
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Sections" data-collapsed={collapsed}>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  if (item.planned) {
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          disabled
                          tooltip={`${item.label} (planned)`}
                        >
                          <Icon className="size-[18px]" aria-hidden />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        <SidebarMenuBadge className="rounded border border-sidebar-border bg-transparent px-1.5 font-mono text-[9px] tracking-wide text-sidebar-foreground/40 uppercase group-data-[collapsible=icon]:hidden">
                          planned
                        </SidebarMenuBadge>
                      </SidebarMenuItem>
                    );
                  }
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={item.id === active}
                        aria-current={item.id === active ? "page" : undefined}
                        tooltip={item.label}
                        onClick={() => {
                          onNavigate(item.id);
                          setOpenMobile(false);
                        }}
                      >
                        <Icon className="size-[18px]" aria-hidden />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
        {threads ? (
          <SidebarGroup className="min-h-0 flex-1 group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Recent chats</SidebarGroupLabel>
            <SidebarGroupContent className="min-h-0 flex-1 overflow-y-auto">
              {threads}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter className="group-data-[collapsible=icon]:hidden">
        <div className="px-2 text-[11px] text-sidebar-foreground/50">
          grounded chat · $0 stack
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export function AppShell({
  children,
  threads,
  topbar,
  title,
  active,
  onNavigate,
}: {
  children: ReactNode;
  threads?: ReactNode;
  topbar?: ReactNode;
  title: string;
  active: string;
  onNavigate: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "true",
  );

  return (
    <SidebarProvider
      open={!collapsed}
      onOpenChange={(open) => {
        setCollapsed(!open);
        localStorage.setItem(COLLAPSE_KEY, String(!open));
      }}
      className={cn("h-dvh overflow-hidden bg-background text-foreground")}
    >
      <AppSidebar threads={threads} active={active} onNavigate={onNavigate} />
      <SidebarInset className="min-w-0">
        <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
          <AppSidebarTrigger />
          <span className="text-sm font-semibold">{title}</span>
          {topbar ?? (
            <span className="ml-auto rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
              demo mode
            </span>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
