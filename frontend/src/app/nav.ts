import {
  BarChart3,
  BookOpen,
  FileText,
  MessageSquare,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  planned: boolean;
};

// Naming (Dillon's convention): "Wiki" = the living docs the assistant maintains;
// "Documents" = the user's uploaded source files.
export const NAV_ITEMS: NavItem[] = [
  { id: "chat", label: "Chat", icon: MessageSquare, planned: false },
  { id: "wiki", label: "Wiki", icon: BookOpen, planned: false },
  { id: "documents", label: "Documents", icon: FileText, planned: false },
  // Navigable, but every panel inside is marked unavailable. A section the
  // user can open and read the plan for beats a disabled item that says
  // nothing about what is coming.
  { id: "analytics", label: "Analytics", icon: BarChart3, planned: false },
  { id: "skills", label: "Skills", icon: Sparkles, planned: false },
  { id: "settings", label: "Settings", icon: Settings, planned: false },
];
