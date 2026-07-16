# Knowledge Assistant

A self-hosted AI assistant for research and data — grounded in manuals, articles, files, and
manufacturer specifications. It hosts living documents that update with user input and
additional files (with user approval), and guides research and comparison workflows through
structured skills.

The system is built in phases. Each goal below is a phase that produces something usable on its
own, and later phases build on the earlier ones.

## Goals

### 1. Foundational document-query interface

An LLM interface that answers questions from documents held in individual directories.

- [ ] Point the assistant at a directory (collection) of documents and ask questions scoped to it
- [ ] Ingest common formats: PDFs, articles, manuals, plain text / markdown
- [ ] Answers are **grounded in the source documents**, not the model's general knowledge
- [ ] Every answer **cites the specific document(s)** it came from
- [ ] Baseline retrieval (direct query over the directory) — the reference point the later RAG
      phase is measured against

### 2. Living documents (structured wiki)

A document design that aggregates and organizes retrieved information into "living docs."

- [ ] Structured, **wiki-style layout** — sections plus cross-links between related documents
- [ ] Aggregate information from many source files into a single organized document per topic
- [ ] Documents **update over time** as the user adds input or new files
- [ ] **Every change requires user approval** — nothing is written or altered without sign-off
- [ ] Provenance: content in a living doc traces back to the source it came from
- [ ] Living docs are queryable on their own, separately from the raw source corpus

### 3. RAG-driven generation

Introduce retrieval-augmented generation to perform the same querying and answering task, and
to build its own living docs.

- [ ] Retrieval-augmented answering over a larger corpus than direct context-stuffing allows
- [ ] Chunking + embeddings + retrieval feeding grounded, cited generation
- [ ] The RAG pipeline **generates and maintains its own living docs** (Goal 2), automatically
- [ ] Same grounding + citation guarantees as the baseline interface

### 4. Accuracy grading / evaluation

A system to grade the accuracy of the produced documents and answers.

- [ ] **A/B comparison: RAG output vs. direct query** on the same questions
- [ ] Accuracy / faithfulness metrics (does the answer match the source material)
- [ ] A test set of questions with known-good answers to grade against
- [ ] Track which approach performs better, and where each fails
