# Knowledge Assistant

An AI chat application that acts as a research aggregator: uploaded documents grow
**living documentation** — a user-approved wiki that serves as the chat's curated,
up-to-date knowledge source. Every answer cites the documents it came from, and every
citation resolves to an openable original.

Portfolio piece demonstrating AI/RAG engineering, full-stack product work, backend systems,
and evaluation — running on free-tier hosting.

> **Live:** https://dillguill.github.io/knowledge-assistant/
> **Status:** v0.6.0 (Skills) code-complete — see Issues/Milestones for what's next.

## Features

- **Chat** — open-webui-class interface: streaming responses, thread history, message
  edit/regenerate, model selector (OpenRouter), in-chat attachments, system prompt editor.
- **Knowledge sources, user-selected per conversation**:
  1. **Wiki** — the approved, aggregated living docs
  2. **Documents** — uploaded source collections queried directly
  3. **Fresh input** — files attached in-chat, plus free-tier web search (off / on / auto)
- **Wiki (living docs)** — a folder-tree wiki of full-markdown pages with version history,
  diffs, and restore. Assistant-authored changes always flow through a proposal/approval
  loop (visitor-submittable, owner-approved, capped at 25 pending); the owner's own edits
  apply immediately as tracked versions. A wiki page can also be "targeted" in chat so the
  model proposes edits to it directly, and an owner-only drafter can generate a full page
  from selected documents in one call. Markdown and print-to-PDF export included.
- **RAG** *(planned, v0.7.0)* — hybrid retrieval (SQLite FTS5 keyword + sqlite-vec vector,
  rank-fused, reranked) behind a swappable retriever interface, toggleable against today's
  full-context mode. Current retrieval is FTS5 keyword search (live for Wiki) plus
  budget-truncated full-context stuffing — no chunking or embeddings exist yet.
- **Skills** *(v0.6.0, code-complete)* — structured research and comparison workflows
  invocable from chat.
- **Analytics** *(planned, v0.8.0)* — usage dashboard (tokens, requests, latency per model).

## Architecture

```
React SPA (GitHub Pages) ──HTTPS/SSE──► FastAPI (Hugging Face Space,
                                          wrapped in gradio.Server for free-tier hosting)
                                          ├─ SQLite: FTS5 keyword search (live)
                                          ├─ SQLite: sqlite-vec + embeddings   (planned, v0.7.0)
                                          ├─► OpenRouter (LLM proxy; key = Space secret)
                                          ├─► Firecrawl search API            (live, owner-gated)
                                          └─► private HF Dataset repo (durable storage)
```

Static frontend on GitHub Pages; Python backend on a Hugging Face Space; SQLite synced to a
private HF Dataset for durable storage (survives Space restarts). No secrets in the bundle.
Visitors get chat, a read-only wiki, and can submit wiki proposals; all other writes
(uploads, approvals, wiki CRUD) are owner-gated by a single admin token.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19 · Vite · TypeScript · Tailwind v4 · shadcn/ui · assistant-ui |
| Backend | FastAPI · Uvicorn · Pydantic v2 · raw `sqlite3` (no ORM) |
| LLM | OpenRouter (free-tier models), via the `openai` SDK |
| Retrieval | SQLite FTS5 keyword search (live) · sqlite-vec + sentence-transformers *(planned)* |
| Ingestion | pypdf · trafilatura · stdlib |
| Hosting | GitHub Pages + Hugging Face Space (Gradio SDK shim) + private HF Dataset |

## Roadmap

Semver milestones, each independently demoable; tracked via GitHub Milestones and Issues.

| Release | Theme | Status |
|---|---|---|
| v0.1.0 | Foundation — repo, CI, deploy pipelines, streaming chat proxy, model selector | ✅ Shipped |
| v0.2.0 | Chat app baseline — threads, history, system prompt editor, settings, mobile | ✅ Shipped |
| v0.3.0 | Knowledge bases — uploads, ingestion, collections, cited answers | ✅ Shipped |
| v0.4.0 | Living docs — aggregation proposals, approval diffs, wiki UI | ✅ Shipped |
| v0.4.5 | Wiki git + navigation — real git history, hierarchy sidebar, table of contents | ✅ Shipped |
| v0.5.0 | Web search — free-tier search as a chat source | ✅ Shipped |
| v0.6.0 | Skills — structured workflows | Code-complete |
| v0.7.0 | RAG — hybrid retrieval behind a retriever interface | Planned |
| v0.8.0 | Analytics + autoretrieval-style eval loop | Planned |
| v1.0.0 | Showcase release | Planned |

## Development

```bash
# frontend (demo mode without a backend)
cd frontend && npm install && npm run dev

# backend
cd backend && uv sync && uv run pytest
uv run uvicorn "app.main:create_app" --factory --reload
```

Frontend talks to the backend when `VITE_API_URL` is set at build time; without it, chat
runs against a clearly-labeled demo stub.
