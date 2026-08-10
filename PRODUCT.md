<!-- Product truth for design work. Derived from context/PRD.md and
context/ARCHITECTURE.md rather than a fresh interview, since this project
already keeps those. Assumptions are labelled. -->

# Knowledge Assistant — product truth

## What it is

A chat-first research aggregator. Documents are uploaded as immutable sources;
the assistant proposes turning them into structured cross-linked "living docs"
(the **Wiki**); the owner approves every assistant-authored change as a diff;
chat answers cite grounded sources back to their origin.

## Unique mechanism

**Nothing the assistant writes persists without an explicit human diff
approval, and every answer carries a citation back to a source that still
exists.** Provenance is the product, not a feature of it.

## Primary object

**The chat.** It is the front door and the surface most used. Wiki and
Documents exist to ground it. Foundations optimize the conversation surface;
everything else supports it.

## Audience and scene

Two distinct roles, and the split is load-bearing in the UI:

- **Owner** (Dillon) — holds the owner token. Uploads, edits wiki pages
  directly, approves or rejects proposals, runs skills. Desk, long sessions.
- **Visitor** — no token. Reads the wiki, chats against the knowledge base,
  can never mutate anything. Often arriving from a portfolio link, likely on a
  phone, evaluating the work in a couple of minutes.

*Assumption (labelled):* the visitor-on-a-phone-from-a-portfolio-link scene is
inferred from the PRD's "portfolio piece" framing, not stated outright.

## Surfaces and modes

| Surface | Mode | Job |
|---|---|---|
| Chat | Operate | Ask a grounded question, get a cited answer, pin a page to edit |
| Wiki | Read / Operate | Read the knowledge base; owner edits and approves diffs |
| Documents | Operate | Upload sources, organize into collections, see ingest status |
| Skills | Operate | Start an agentic run, watch it live, review what it filed |
| Settings | Operate | Token, model, theme |

## Craft bar

Named by the owner, 2026-08-10. These set the standard the build must reach:

- **Claude / ChatGPT** — the conversation surface, and the artifacts panel
  pattern the Target panel now follows.
- **Notion** — content hierarchy and calm, text-forward density.
- **Vercel / Supabase dashboard** — real data tables, status badges, mono for
  identifiers, card grids.

This is a deliberate commitment to category convention executed at full
fidelity, not an invented visual direction. The product is an Operate tool;
expression must never obscure task, state, or affordance.

## Hard constraints

- **$0 to run.** Free-tier everything: HF Space (sleeps), OpenRouter free
  models, Firecrawl free tier.
- Stack limited to Python, TypeScript/React, SQL.
- No new frontend dependencies. Vendoring shadcn files is not a dependency;
  `react-hook-form`, a data-fetching library, a global store, or a router
  would be.
- Source documents persist; every answer must be checkable against them.
- Semver milestones, each independently demoable.
- The Space sleeps, so **cold start is a real, frequent first impression** —
  loading and waking states are primary UI, not edge cases.

## What must not change

- The **Wiki / Documents** naming. Load-bearing and user-facing.
- The owner/visitor permission split, and the fact that visitors never see
  controls they cannot use.
- Citation chips resolving back to real sources.
- The approve-by-diff flow.
