"use client";

import { useCallback } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { exportToPdf } from "@/lib/pdf-export";

function formatAsHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withCode = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `</p><pre style="background:#f5f5f5;padding:12px;border-radius:6px;overflow-x:auto;font-size:0.85rem;line-height:1.4;"><code>${code.trim()}</code></pre><p>`;
  });
  const withInline = withCode.replace(/`([^`]+)`/g, "<code style=\"background:#f5f5f5;padding:2px 4px;border-radius:3px;font-size:0.85em;\">$1</code>");
  const paragraphs = withInline.split(/\n\n+/).map((b) => `<p>${b.replace(/\n/g, "<br/>")}</p>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,-apple-system,sans-serif;font-size:12pt;line-height:1.6;color:#222;max-width:6.5in;margin:0 auto;padding:0.5in}p{margin:0 0 0.75rem}pre{white-space:pre-wrap;word-break:break-word}code{font-family:SFMono-Regular,Consolas,monospace}</style></head><body>${paragraphs}</body></html>`;
}

export function useActionBarExportPdf(filename?: string) {
  const aui = useAui();
  const hasExportableContent = useAuiState((s) => {
    return (
      (s.message.role !== "assistant" || s.message.status?.type !== "running") &&
      s.message.parts.some((c) => c.type === "text" && c.text.length > 0)
    );
  });

  const callback = useCallback(async () => {
    const content = aui.message().getCopyText();
    if (!content) return;
    const html = formatAsHtml(content);
    const el = document.createElement("div");
    el.innerHTML = html;
    el.style.position = "absolute";
    el.style.left = "-9999px";
    el.style.top = "0";
    document.body.appendChild(el);
    try {
      await exportToPdf(el, filename ?? `message-${Date.now()}.pdf`);
    } finally {
      document.body.removeChild(el);
    }
  }, [aui, filename]);

  if (!hasExportableContent) return null;
  return callback;
}
