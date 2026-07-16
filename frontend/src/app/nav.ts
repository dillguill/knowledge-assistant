import {
  BarChart3,
  Database,
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

export const NAV_ITEMS: NavItem[] = [
  { id: "chat", label: "Chat", icon: MessageSquare, planned: false },
  { id: "documents", label: "Documents", icon: FileText, planned: true },
  { id: "knowledge", label: "Knowledge bases", icon: Database, planned: true },
  { id: "analytics", label: "Analytics", icon: BarChart3, planned: true },
  { id: "skills", label: "Skills", icon: Sparkles, planned: true },
  { id: "settings", label: "Settings", icon: Settings, planned: true },
];
