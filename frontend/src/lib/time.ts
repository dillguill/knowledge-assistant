const units = [
  { label: "y", ms: 31_536_000_000 },
  { label: "mo", ms: 2_592_000_000 },
  { label: "w", ms: 604_800_000 },
  { label: "d", ms: 86_400_000 },
  { label: "h", ms: 3_600_000 },
  { label: "m", ms: 60_000 },
] as const;

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  for (const { label, ms } of units) {
    const n = Math.floor(diff / ms);
    if (n >= 1) return `${n}${label} ago`;
  }
  return "just now";
}
