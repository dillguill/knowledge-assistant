import "katex/dist/katex.min.css";

import {
  Children,
  createContext,
  useContext,
  useMemo,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkWikiLink from "remark-wiki-link";
import rehypeKatex from "rehype-katex";

import {
  markdownInlineCodeClassName,
  markdownPreClassName,
  proseMarkdownComponents,
} from "@/components/assistant-ui/markdown-text";
import { cn } from "@/lib/utils";
import { MermaidBlock } from "./mermaid-block";

export type WikiLinkResolution = { slug: string; exists: boolean };
export type WikiLinkResolver = (target: string) => WikiLinkResolution;

const WIKI_LINK_CLASS = "wiki-link";

// `@portaljs/remark-wiki-link` crashes at runtime against this project's
// micromark/mdast-util-from-markdown versions (its bundled tokenizer throws
// mid-parse), so we use the plainer, older `remark-wiki-link` package per the
// documented fallback. Existence is decided by the caller-supplied `resolve`
// prop at render time, not by this plugin's own `permalinks` bookkeeping —
// so the resolver is the identity function and `href` ends up holding the
// raw `[[target]]` text for `WikiAwareLink` to resolve itself.
const remarkWikiLinkOptions = {
  permalinks: [] as string[],
  pageResolver: (name: string) => [name],
  hrefTemplate: (permalink: string) => permalink,
  wikiLinkClassName: WIKI_LINK_CLASS,
  aliasDivider: "|",
};

const CodeBlockContext = createContext(false);

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as ReactElement<{ children?: ReactNode }>).props.children);
  }
  return "";
}

function MarkdownPre({ children, className, ...props }: ComponentPropsWithoutRef<"pre">) {
  const codeElement = Children.only(children) as ReactElement<{
    className?: string;
    children?: ReactNode;
  }>;
  const codeClassName = codeElement.props.className ?? "";

  if (/\blanguage-mermaid\b/.test(codeClassName)) {
    const code = extractText(codeElement.props.children).replace(/\n$/, "");
    return <MermaidBlock code={code} />;
  }

  return (
    <CodeBlockContext.Provider value={true}>
      <pre className={cn(markdownPreClassName, className)} {...props}>
        {children}
      </pre>
    </CodeBlockContext.Provider>
  );
}

function MarkdownCode({ className, ...props }: ComponentPropsWithoutRef<"code">) {
  const isBlock = useContext(CodeBlockContext);
  return (
    <code
      className={cn(!isBlock && markdownInlineCodeClassName, className)}
      {...props}
    />
  );
}

function WikiAwareLink({
  className,
  href,
  children,
  resolve,
  onNavigate,
  ...props
}: ComponentPropsWithoutRef<"a"> & {
  resolve: WikiLinkResolver;
  onNavigate?: (slug: string) => void;
}) {
  const isWikiLink = (className ?? "").split(/\s+/).includes(WIKI_LINK_CLASS);
  if (!isWikiLink) {
    const BaseLink = proseMarkdownComponents.a;
    return (
      <BaseLink className={className} href={href} {...props}>
        {children}
      </BaseLink>
    );
  }

  const { slug, exists } = resolve(href ?? "");
  if (!exists) {
    return (
      <span
        className="wiki-link-missing text-muted-foreground"
        title="No page with this name yet"
      >
        {children}
      </span>
    );
  }

  return (
    <a
      href={`/wiki/page/${slug}`}
      className="wiki-link text-primary hover:text-primary/80 underline underline-offset-2"
      onClick={(e) => {
        e.preventDefault();
        onNavigate?.(slug);
      }}
    >
      {children}
    </a>
  );
}

/**
 * Renders wiki page content: the same prose styling as chat (via
 * `proseMarkdownComponents`), plus `[[Wiki Links]]`, `$math$`, and mermaid
 * fences. Raw HTML stays disabled — no `rehype-raw` is added, so react-markdown's
 * default behavior (drop raw HTML nodes) applies.
 */
export function WikiMarkdown({
  content,
  resolve,
  onNavigate,
}: {
  content: string;
  resolve: WikiLinkResolver;
  onNavigate?: (slug: string) => void;
}) {
  const remarkPlugins: PluggableList = useMemo(
    () => [remarkGfm, remarkMath, [remarkWikiLink, remarkWikiLinkOptions]],
    [],
  );
  const rehypePlugins: PluggableList = useMemo(() => [rehypeKatex], []);

  return (
    <div className="aui-md">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          ...proseMarkdownComponents,
          a: (props) => <WikiAwareLink {...props} resolve={resolve} onNavigate={onNavigate} />,
          pre: MarkdownPre,
          code: MarkdownCode,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
