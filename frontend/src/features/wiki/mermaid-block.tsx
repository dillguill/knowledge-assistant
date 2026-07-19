import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { markdownPreClassName } from "@/components/assistant-ui/markdown-text";

let mermaidIdCounter = 0;

/**
 * Renders a mermaid diagram fence to inline SVG. `mermaid` is dynamic-imported
 * on mount so it never lands in the main bundle — most wiki pages have no
 * diagrams at all, and the library is large.
 */
export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);

    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
        const id = `wiki-mermaid-${++mermaidIdCounter}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    return (
      <pre className={cn(markdownPreClassName, "wiki-mermaid-error")}>
        <code>{code}</code>
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="wiki-mermaid-loading my-3 text-sm text-muted-foreground">
        Rendering diagram…
      </div>
    );
  }

  // Mermaid's render() returns markup it fully controls (no user HTML is
  // interpolated into it), so injecting it here is the standard, safe way to
  // mount it.
  return (
    <div
      className="wiki-mermaid my-3 flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
