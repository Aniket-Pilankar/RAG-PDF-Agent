# PDF Agent RAG

Upload PDFs, and ask questions about them. Documents are chunked, embedded, and stored in a vector database; answers are generated from the retrieved passages and shown with the source excerpts they came from.

Built as a full-stack RAG application: a Next.js client, an Express API, and a background worker that handles ingestion asynchronously so uploads never block the request.

---

## Features

- **Multi-PDF chat** — upload several documents and scope a question to any subset of them
- **Asynchronous ingestion** — uploads are queued; a separate worker parses, chunks, and embeds
- **Live upload status** — the client subscribes over Socket.IO and updates when indexing finishes
- **Persistent chat sessions** — conversations and messages are stored in Postgres and can be reopened
- **History-aware retrieval** — follow-up questions are rewritten into standalone queries before search
- **HyDE retrieval** — a hypothetical answer is embedded instead of the raw question, improving recall
- **Cited sources** — each answer lists the chunks used, with filename, page number, and a download link
- **Per-user isolation** — Clerk authentication, with `userId` enforced both in Postgres and as a Qdrant filter

---

### Ingestion path

1. `POST /upload/pdf` stores the file on disk via multer and creates a `Pdf` row with status `processing`.
2. A job is pushed onto the `file-upload-queue` BullMQ queue (backed by Valkey).
3. The worker loads the PDF, splits it with `RecursiveCharacterTextSplitter` (1000 chars, 200 overlap), tags every chunk with `userId` and `pdfId`, embeds with `text-embedding-3-small`, and upserts into the `pdf-agent-rag` Qdrant collection.
4. The `Pdf` row flips to `ready` (or `failed`), and `QueueEvents` emits to the Socket.IO room named after the job id so the browser updates without polling.

### Query path

1. If chat history exists, the question is rewritten into a standalone question.
2. A short hypothetical answer is generated for that question (**HyDE**) and used as the embedding target.
3. The top 5 chunks are retrieved from Qdrant, filtered to the signed-in user and any selected `pdfIds`.
4. `gpt-4o-mini` answers over that context, and the exchange is persisted to the session.
5. If the model says it doesn't know, the source list is suppressed rather than showing irrelevant citations.

---

## Tech stack

| Layer | Stack |
| --- | --- |
| Client | Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/radix-ui, lucide-react |
| API | Node.js, Express 4, Socket.IO, multer |
| AI / RAG | LangChain, OpenAI `gpt-4o-mini` + `text-embedding-3-small` |
| Vector store | Qdrant |
| Queue | BullMQ on Valkey (Redis-compatible) |
| Database | PostgreSQL via Prisma |
| Auth | Clerk |

---

## Project structure

```
.
├── client/                      # Next.js frontend
│   ├── app/
│   │   ├── components/          # chat, chat-sessions, file-upload, pdf-list
│   │   ├── layout.tsx           # Clerk provider + signed-in/out shell
│   │   └── page.tsx             # sidebar + chat layout
│   ├── components/ui/           # shadcn primitives
│   └── proxy.ts                 # Clerk route protection
├── server/
│   ├── index.js                 # Express API + Socket.IO + RAG chat endpoint
│   ├── worker.js                # BullMQ worker: parse → chunk → embed → upsert
│   ├── prisma/schema.prisma     # Pdf, ChatSession, Message
│   └── uploads/                 # stored PDFs (gitignored)
└── docker-compose.yml           # Valkey + Qdrant + Postgres
```

---

## Getting started

### Prerequisites

- **Node.js 20+** (the server scripts use the built-in `--env-file` flag)
- **pnpm**
- **Docker Desktop** — supplies all three backing services
- An **OpenAI** API key and a **Clerk** application

### 1. Start the infrastructure

```bash
docker compose up -d
```

This brings up all three backing services:

| Service  | Port   | Purpose                                                         |
| -------- | ------ | --------------------------------------------------------------- |
| Valkey   | `6379` | BullMQ job queue (Redis-compatible)                             |
| Qdrant   | `6333` | Vector store — collection `pdf-agent-rag`, created on first use |
| Postgres | `5432` | Database `pdf_agent_rag`, user/password `postgres`              |

Confirm they're all up:

```bash
docker compose ps
```

> Use `docker compose stop` rather than `down` to keep your indexed data between sessions.

### 2. Configure the server

Create `server/.env`:

```env
OPENAI_API_KEY=sk-...
DATABASE_URL=postgresql://user:password@localhost:5432/pdf_agent_rag
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Install dependencies and apply the schema:

```bash
cd server
pnpm install
pnpm exec prisma migrate deploy   # or: prisma migrate dev
pnpm exec prisma generate
```

### 3. Configure the client

Create `client/.env.local`:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

```bash
cd client
pnpm install
```

### 4. Run it

Three processes, three terminals. Start them in this order:

```bash
cd server && pnpm dev
```

```bash
cd server && pnpm dev:worker
```

```bash
cd client && pnpm dev
```

| Terminal | What it is             | Watch for                                          |
| -------- | ---------------------- | -------------------------------------------------- |
| 1        | Express API on `:8000` | `Server started on PORT:8000`                      |
| 2        | Ingestion worker       | Silent until a PDF is uploaded, then `Job data: …` |
| 3        | Next.js UI on `:3000`  | `Ready in …`                                       |

Both server processes run under `node --watch`, so they restart on save. The client hot-reloads.

Check the API is alive:

```bash
curl http://localhost:8000/
```

Then open <http://localhost:3000>, sign in, upload a PDF, wait for it to turn **ready**, and start asking questions.

> **The worker must be running for uploads to finish.** Without it the job sits in the queue unclaimed and the PDF stays at `processing` forever — the upload appears to succeed, so this is the failure you're most likely to hit first.

---

## Developer tools

Four stores hold state, and each has its own way in. When something looks wrong, this is where to look.

Container names below assume the default Compose project name (`pdf-agent-rag`, set at the top of `docker-compose.yml`). Run `docker compose ps` if yours differ.

### Postgres — Prisma Studio

The friendliest view of `Pdf`, `ChatSession`, and `Message`:

```bash
cd server && pnpm exec prisma studio
```

Opens <http://localhost:5555>. Rows are editable inline, and you can click a `ChatSession` and follow its `messages` relation straight through. Run it from `server/` — it needs `prisma/schema.prisma` and `.env` in scope.

**Use it to check:** whether a PDF reached `status: 'ready'`, what a conversation actually stored, whether a delete cascaded.

### Qdrant — dashboard

<http://localhost:6333/dashboard>

Browse the `pdf-agent-rag` collection, page through points, and read each one's payload — you'll see the chunk text alongside its `metadata.userId`, `metadata.pdfId`, `metadata.loc.pageNumber`, and `metadata.source`. There's also a console for running filter queries.

**Use it to check:** whether the worker actually wrote vectors, whether chunks are tagged with the right `pdfId`, whether a delete removed its points.

### Qdrant — REST API

```bash
curl http://localhost:6333/collections/pdf-agent-rag
```

Returns `points_count`, plus the vector config — `size: 1536`, `distance: "Cosine"`, matching `text-embedding-3-small`.

Fetch a few points with their payloads:

```bash
curl -X POST http://localhost:6333/collections/pdf-agent-rag/points/scroll -H 'Content-Type: application/json' -d '{"limit":3,"with_payload":true,"with_vector":false}'
```

> **`indexed_vectors_count: 0` is normal, not a bug.** Qdrant only builds the HNSW index past `indexing_threshold` (10,000 by default). Below that it full-scans, which is exact and fast at this size. Search works either way.

### Valkey — queue state

```bash
docker exec -it pdf-agent-rag-valkey-1 valkey-cli
```

BullMQ namespaces everything under `bull:file-upload-queue:`:

| Key          | Holds                                                              |
| ------------ | ------------------------------------------------------------------ |
| `:wait`      | queued, not yet picked up                                          |
| `:active`    | being processed right now                                          |
| `:completed` | finished — a sorted set, scored by completion time                 |
| `:failed`    | threw — check `failedReason` on the job hash                       |
| `:<jobId>`   | one job's hash: `data`, `processedOn`, `finishedOn`, `returnvalue` |

```
KEYS bull:file-upload-queue*
ZRANGE bull:file-upload-queue:completed 0 -1 WITHSCORES
HGETALL bull:file-upload-queue:1
```

### Where to look when it breaks

| Symptom                                         | Look here                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| PDF stuck at "Processing…" forever              | Is terminal 2 running? Then Valkey `:wait` vs `:active`             |
| Upload succeeded but answers say "I don't know" | Qdrant `points_count` — did chunks actually get written?            |
| "Ready" but the sidebar disagrees               | Prisma Studio `Pdf.status` vs the Valkey job state                  |
| Answers cite the wrong document                 | Qdrant dashboard — check `metadata.pdfId` on the returned points    |
| 401 on every request                            | Clerk keys mismatched between `server/.env` and `client/.env.local` |
| `ECONNREFUSED` on startup                       | `docker compose ps` — a service didn't come up                      |

---

## API reference

All routes except `GET /` require a Clerk bearer token in the `Authorization` header.

| Method   | Route                         | Description                                                        |
| -------- | ----------------------------- | ------------------------------------------------------------------ |
| `GET`    | `/`                           | Health check                                                       |
| `POST`   | `/upload/pdf`                 | Upload a PDF (`multipart/form-data`, field `pdf`); returns `jobId` |
| `GET`    | `/pdfs`                       | List the caller's PDFs with ingestion status                       |
| `DELETE` | `/pdfs/:id`                   | Delete a PDF, its file, and its vectors                            |
| `POST`   | `/chat/sessions`              | Create a chat session                                              |
| `GET`    | `/chat/sessions`              | List sessions, most recently updated first                         |
| `GET`    | `/chat/sessions/:id/messages` | Fetch a session's messages                                         |
| `DELETE` | `/chat/sessions/:id`          | Delete a session and its messages                                  |
| `POST`   | `/chat`                       | Ask a question; returns `{ message, docs }`                        |

**Socket.IO** — connect to `http://localhost:8000`, `emit('subscribe', jobId)`, and listen for `job:status` with `{ status: 'completed' | 'failed' }`.

---

## Data model

| Model         | Purpose                                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| `Pdf`         | One uploaded document: `userId`, `filename`, `filePath`, `status`, `uploadedAt` |
| `ChatSession` | A conversation, titled from its first message                                   |
| `Message`     | A `user` or `assistant` turn, cascade-deleted with its session                  |

Chunk vectors live in Qdrant rather than Postgres, keyed by `metadata.userId` and `metadata.pdfId` so deletes and queries can filter on them.

---
