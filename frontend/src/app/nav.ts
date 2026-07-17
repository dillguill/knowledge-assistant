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
  { id: "wiki", label: "Wiki", icon: BookOpen, planned: true },
  { id: "documents", label: "Documents", icon: FileText, planned: true },
  { id: "analytics", label: "Analytics", icon: BarChart3, planned: true },
  { id: "skills", label: "Skills", icon: Sparkles, planned: true },
  { id: "settings", label: "Settings", icon: Settings, planned: false },
];
