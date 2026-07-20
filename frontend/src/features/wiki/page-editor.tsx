import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";

const extensions = [markdown()];

/**
 * Markdown source editor for a wiki page. A thin CodeMirror wrapper so
 * `page-view.tsx` doesn't need to know about CodeMirror's own API.
 */
export function PageEditor({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      autoFocus={autoFocus}
      minHeight="50vh"
      className="rounded-md border border-border text-sm [&_.cm-editor]:rounded-md [&_.cm-scroller]:font-mono"
    />
  );
}
