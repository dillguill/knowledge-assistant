import {
  FileDown,
  FilePlus,
  FileText,
  FolderInput,
  FolderPlus,
  History,
  Inbox,
  MoreHorizontal,
  Pencil,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { PageOrFolderTarget } from "./wiki-dialogs";

/**
 * Single source of truth for wiki action presentation. Every wiki view (the
 * folder grid rows, the folder toolbar, the page toolbar) pulls its icon and
 * label from here so the same action always looks the same.
 */
export type WikiActionKey =
  | "new-page"
  | "new-folder"
  | "proposals"
  | "edit"
  | "history"
  | "export-md"
  | "export-pdf"
  | "rename"
  | "move"
  | "delete";

export const WIKI_ACTIONS: Record<WikiActionKey, { icon: LucideIcon; label: string }> = {
  "new-page": { icon: FilePlus, label: "New page" },
  "new-folder": { icon: FolderPlus, label: "New folder" },
  proposals: { icon: Inbox, label: "Proposals" },
  edit: { icon: Pencil, label: "Edit" },
  history: { icon: History, label: "History" },
  "export-md": { icon: FileDown, label: "Export .md" },
  "export-pdf": { icon: FileText, label: "Export PDF" },
  rename: { icon: Type, label: "Rename" },
  move: { icon: FolderInput, label: "Move" },
  delete: { icon: Trash2, label: "Delete" },
};

type WikiIconButtonProps = React.ComponentProps<typeof Button> & {
  /** Pulls icon + tooltip from {@link WIKI_ACTIONS}. */
  action?: WikiActionKey;
  /** Overrides / provides the icon when not using `action`. */
  icon?: LucideIcon;
  /** Overrides / provides the tooltip label when not using `action`. */
  label?: string;
  tooltipSide?: "top" | "bottom" | "left" | "right";
};

/**
 * Icon-only action button with a tooltip — the universal wiki action control.
 * Defaults to the `outline` look the wiki used before (h-8 square).
 */
export function WikiIconButton({
  action,
  icon,
  label,
  tooltipSide = "bottom",
  variant = "outline",
  size = "icon-sm",
  className,
  ...rest
}: WikiIconButtonProps) {
  const spec = action ? WIKI_ACTIONS[action] : undefined;
  const Icon = icon ?? spec?.icon;
  const text = label ?? spec?.label ?? "";

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            className={className}
            {...rest}
          >
            {Icon && <Icon aria-hidden />}
            <span className={cn("sr-only")}>{text}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * The `...` row menu shared by the folder grid, folder toolbar and page view.
 * Renders Rename / Move / Delete for a page or folder and reports the chosen
 * action to the caller, which owns the actual CRUD dialogs.
 */
export function WikiItemMenu({
  target,
  canDelete = true,
  onAction,
  tooltipSide = "bottom",
}: {
  target: PageOrFolderTarget;
  /** Folders can only be deleted when empty (backend returns 409 otherwise). */
  canDelete?: boolean;
  onAction: (target: PageOrFolderTarget, action: "rename" | "move" | "delete") => void;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}) {
  const noun = target.kind;
  const rename = WIKI_ACTIONS.rename;
  const move = WIKI_ACTIONS.move;
  const del = WIKI_ACTIONS.delete;

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm">
                <MoreHorizontal aria-hidden />
                <span className="sr-only">{`${noun} actions`}</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>More</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => onAction(target, "rename")}>
          <rename.icon aria-hidden />
          {rename.label}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction(target, "move")}>
          <move.icon aria-hidden />
          {move.label}
        </DropdownMenuItem>
        {canDelete && (
          <DropdownMenuItem variant="destructive" onSelect={() => onAction(target, "delete")}>
            <del.icon aria-hidden />
            {del.label}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
