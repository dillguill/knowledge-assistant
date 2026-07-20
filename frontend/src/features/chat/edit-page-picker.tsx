import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useWikiTree } from "@/features/wiki/use-wiki";
import { useTargetSelection } from "./target-selection";

/**
 * Searchable page picker opened by the `/edit-page` command (command-palette
 * pattern — the composer's `@` trigger popover can't be opened
 * programmatically). Picking a page pins it as the edit target, which shows
 * the "Editing:" pill and opens the TargetPanel side panel (md+).
 */
export function EditPagePicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { tree } = useWikiTree();
  const { setTargetPageId } = useTargetSelection();

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit a page"
      description="Pick a wiki page to edit"
    >
      <CommandInput placeholder="Search wiki pages…" />
      <CommandList>
        <CommandEmpty>No pages found.</CommandEmpty>
        <CommandGroup heading="Wiki pages">
          {tree.pages.map((p) => (
            <CommandItem
              key={p.id}
              value={`${p.id} ${p.title} ${p.slug}`}
              onSelect={() => {
                setTargetPageId(p.id);
                onOpenChange(false);
              }}
            >
              {p.title}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
