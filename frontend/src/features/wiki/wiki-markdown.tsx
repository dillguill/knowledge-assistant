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
import rehypeSlug from "rehype-slug";

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

/** A hover-reveal "#" link next to a heading, deep-linking to `#id` — reuses
 * the same `rehype-slug` id the table-of-contents panel scrolls to. Wiki-only
 * (chat headings aren't slugged/deep-linkable), so this lives here rather
 * than in the shared `proseMarkdownComponents`. Rendered as a sibling of the
 * heading (not a child) so its own "Link to this heading" label doesn't get
 * folded into the heading's accessible name. */
function HeadingAnchor({ id }: { id?: string }) {
  if (!id) return null;
  return (
    <a
      href={`#${id}`}
      aria-label="Link to this heading"
      className="no-underline text-muted-foreground opacity-0 group-hover:opacity-100"
    >
      #
    </a>
  );
}

const wikiHeadingComponents = {
  h1: ({ id, className, children, ...props }: ComponentPropsWithoutRef<"h1">) => (
    <div className="group mt-5 mb-2 flex items-baseline gap-2 first:mt-0 last:mb-0">
      <h1 id={id} className={cn("aui-md-h1 scroll-m-20 text-xl font-semibold", className)} {...props}>
        {children}
      </h1>
      <HeadingAnchor id={id} />
    </div>
  ),
  h2: ({ id, className, children, ...props }: ComponentPropsWithoutRef<"h2">) => (
    <div className="group mt-5 mb-2 flex items-baseline gap-2 first:mt-0 last:mb-0">
      <h2 id={id} className={cn("aui-md-h2 scroll-m-20 text-lg font-semibold", className)} {...props}>
        {children}
      </h2>
      <HeadingAnchor id={id} />
    </div>
  ),
  h3: ({ id, className, children, ...props }: ComponentPropsWithoutRef<"h3">) => (
    <div className="group mt-4 mb-1.5 flex items-baseline gap-2 first:mt-0 last:mb-0">
      <h3 id={id} className={cn("aui-md-h3 scroll-m-20 text-base font-semibold", className)} {...props}>
        {children}
      </h3>
      <HeadingAnchor id={id} />
    </div>
  ),
  h4: ({ id, className, children, ...props }: ComponentPropsWithoutRef<"h4">) => (
    <div className="group mt-3.5 mb-1 flex items-baseline gap-2 first:mt-0 last:mb-0">
      <h4 id={id} className={cn("aui-md-h4 scroll-m-20 text-base font-medium", className)} {...props}>
        {children}
      </h4>
      <HeadingAnchor id={id} />
    </div>
  ),
  h5: ({ id, className, children, ...props }: ComponentPropsWithoutRef<"h5">) => (
    <div className="group mt-3 mb-1 flex items-baseline gap-2 first:mt-0 last:mb-0">
      <h5 id={id} className={cn("aui-md-h5 scroll-m-20 text-sm font-semibold", className)} {...props}>
        {children}
      </h5>
      <HeadingAnchor id={id} />
    </div>
  ),
  h6: ({ id, className, children, ...props }: ComponentPropsWithoutRef<"h6">) => (
    <div className="group mt-3 mb-1 flex items-baseline gap-2 first:mt-0 last:mb-0">
      <h6 id={id} className={cn("aui-md-h6 scroll-m-20 text-sm font-medium", className)} {...props}>
        {children}
      </h6>
      <HeadingAnchor id={id} />
    </div>
  ),
};

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
  const rehypePlugins: PluggableList = useMemo(() => [rehypeSlug, rehypeKatex], []);

  return (
    <div className="aui-md">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          ...proseMarkdownComponents,
          ...wikiHeadingComponents,
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
