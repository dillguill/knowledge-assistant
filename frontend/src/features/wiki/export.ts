/** Downloads the page's raw markdown source as `{slug}.md`. Purely
 * client-side — there's no export endpoint, the content is already in hand. */
export function exportPageAsMarkdown(slug: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Triggers the browser's print dialog. The `@media print` rules in
 * index.css (scoped to `.wiki-print-area`) hide the shell/sidebar/nav and
 * every button, leaving only the rendered page content — "Print" doubles as
 * "Save as PDF" via the browser's own print-to-PDF destination. */
export function exportPageAsPdf(): void {
  window.print();
}
