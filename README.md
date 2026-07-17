# Knowledge Assistant

An AI chat application that acts as a research aggregator: uploaded documents grow
**living documentation** — a user-approved wiki that serves as the chat's curated,
up-to-date knowledge source. Every answer cites the documents it came from, and every
citation resolves to an openable original.

Portfolio piece demonstrating AI/RAG engineering, full-stack product work, backend systems,
and evaluation — running on free-tier hosting.

> **Live:** https://dillguill.github.io/knowledge-assistant/
> **Status:** v0.1.0 (streaming chat foundation) in progress — see Issues/Milestones for tracking.

## Features

- **Chat** — open-webui-class interface: streaming responses, thread history, message
  edit/regenerate, model selector (OpenRouter), in-chat attachments, system prompt editor.
- **Knowledge sources, user-selected per conversation** *(planned)*:
  1. **Wiki** — the approved, aggregated living docs
  2. **Documents** — uploaded source collections queried directly
  3. **Fresh input** — files attached in-chat, or free-tier web search
- **Wiki (living docs)** *(planned)* — structured, cross-linked pages aggregated from
  sources; every change flows through a per-section approval diff, with provenance back to
  the originals.
- **RAG** *(planned)* — hybrid retrieval (SQLite FTS5 keyword + sqlite-vec vector,
  rank-fused, reranked) behind a swappable retriever interface, toggleable against plain
  context mode.
- **Skills** *(planned)* — structured research and comparison workflows invocable from chat.
- **Analytics** *(planned)* — usage dashboard (tokens, requests, latency per model).

## Architecture

```
React SPA (GitHub Pages) ──HTTPS/SSE──► FastAPI (Hugging Face Space)
                                          ├─ SQLite: FTS5 + sqlite-vec      (planned)
                                          ├─ embeddings, in-process         (planned)
                                          ├─► OpenRouter (LLM proxy; key = Space secret)
                                          ├─► web search API                (planned)
                                          └─► private HF Dataset repo (durable storage)
```

Static frontend on GitHub Pages; Python backend on a Hugging Face Space; SQLite synced to a
private HF Dataset for durable storage. No secrets in the bundle. Visitors get chat and a
read-only wiki; writes are owner-gated.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React · Vite · TypeScript · Tailwind · shadcn/ui · assistant-ui |
| Backend | FastAPI · Uvicorn · Pydantic |
| LLM | OpenRouter (free-tier models) |
| Retrieval *(planned)* | SQLite FTS5 + sqlite-vec · sentence-transformers |
| Ingestion *(planned)* | pypdf · trafilatura · stdlib |
| Hosting | GitHub Pages + Hugging Face Space + private HF Dataset |

## Roadmap

Semver milestones, each independently demoable; tracked via GitHub Milestones and Issues.

| Release | Theme |
|---|---|
| v0.1.0 | Foundation — repo, CI, deploy pipelines, streaming chat proxy, model selector |
| v0.2.0 | Chat app baseline — threads, history, system prompt editor, settings, mobile |
| v0.3.0 | Knowledge bases — uploads, ingestion, collections, cited answers |
| v0.4.0 | Living docs — aggregation proposals, approval diffs, wiki UI |
| v0.5.0 | RAG — hybrid retrieval behind a retriever interface |
| v0.6.0 | Web search — free-tier search as a chat source |
| v0.7.0 | Analytics + eval foundation |
| v0.8.0 | Skills — structured workflows |
| v1.0.0 | Showcase release |

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
