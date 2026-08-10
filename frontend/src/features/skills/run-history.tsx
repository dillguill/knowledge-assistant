import { Badge } from "@/components/assistant-ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/time";
import type { Run } from "./api";

type Variant = "success" | "destructive" | "warning" | "muted";

const STATUS_VARIANT: Record<string, Variant> = {
  succeeded: "success",
  failed: "destructive",
  running: "warning",
  queued: "warning",
  cancelled: "muted",
};

/** Past runs, newest first. A failed run stays queryable on purpose — history
 * showing what broke beats a run that vanished. */
export function RunHistory({
  runs,
  onOpen,
}: {
  runs: Run[];
  onOpen: (id: number) => void;
}) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-6 py-8 text-center">
        <p className="text-heading">No runs yet</p>
        <p className="max-w-xs text-body text-muted-foreground">
          Start a skill above and its progress will appear here — including
          runs that fail.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-28 ps-3 font-mono text-eyebrow uppercase">
              Status
            </TableHead>
            <TableHead className="font-mono text-eyebrow uppercase">Run</TableHead>
            <TableHead className="w-28 pe-3 text-right font-mono text-eyebrow uppercase">
              Started
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow
              key={run.id}
              // The row is the target, not a link inside it — a bigger hit
              // area, and it keeps the whole record clickable.
              onClick={() => onOpen(run.id)}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(run.id);
                }
              }}
              className="cursor-pointer focus-visible:bg-accent focus-visible:outline-none"
            >
              <TableCell className="ps-3">
                <Badge
                  size="sm"
                  variant={STATUS_VARIANT[run.status] ?? "muted"}
                  className="font-mono text-eyebrow uppercase"
                >
                  {run.error_code ?? run.status}
                </Badge>
              </TableCell>
              <TableCell className="max-w-0">
                <span className="block truncate">
                  <span className="font-medium">{run.skill}</span>
                  {typeof run.input?.topic === "string" && (
                    <span className="text-muted-foreground">
                      {" · "}
                      {run.input.topic}
                    </span>
                  )}
                </span>
              </TableCell>
              <TableCell className="pe-3 text-right font-mono text-meta tabular-nums text-muted-foreground">
                {relativeTime(run.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
