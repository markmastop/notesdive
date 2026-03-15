# NotesDive

NotesDive is a self-hostable notes workspace built around a local vault, reMarkable sync, document preview, and local AI integrations.

Today the project ships as a small monorepo with:

- a FastAPI backend
- a React/Vite frontend
- a file-based vault under `data/`
- a local SQLite index for vault metadata
- a local SQLite cache for reMarkable document metadata
- optional Ollama and Scriberr integrations

The current UI already supports:

- browsing vault notes
- browsing cached reMarkable documents
- syncing reMarkable documents into the vault as markdown or PDF
- previewing reMarkable content
- local note creation
- basic workspace overview and recent activity
- Ollama chat and document handoff
- Scriberr transcription listing

## Stack

- Backend: Python 3.12, FastAPI, Uvicorn
- Frontend: React 18, Vite, Tailwind CSS
- Runtime: Docker / Docker Compose
- Storage: markdown files, frontmatter, local JSON, SQLite caches
- Realtime UI updates: Server-Sent Events for reMarkable sync status

## Project Layout

```text
.
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   ├── services/
│   │   ├── utils/
│   │   └── main.py
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   └── package.json
├── data/
│   ├── attachments/
│   ├── integrations/
│   │   ├── remarkable/
│   │   └── vault/
│   ├── samples/
│   └── vault/
├── docker-compose.yaml
├── docker-compose.dev.yaml
├── .env.example
├── run.sh
└── README.md
```

## How It Works

### Backend

The backend owns all stateful operations:

- vault note loading and writing
- vault index creation in SQLite
- reMarkable registration, caching, preview generation, and vault sync
- Ollama settings, model listing, chat history, and streaming responses
- Scriberr settings and transcription listing

Important services:

- `NoteService`: loads markdown notes from the vault and exposes note detail
- `VaultService`: reports vault status and index metadata
- `VaultIndexService`: builds and reads the local vault SQLite index
- `RemarkableService`: caches reMarkable metadata, builds previews, and syncs to the vault
- `OllamaService` and `OllamaHistoryService`: local chat execution and persistence
- `ScriberrService`: remote transcription listing

### Frontend

The frontend is a single dashboard application with views for:

- Home
- reMarkable
- Obsidian Vault
- Scriberr
- Ollama
- Settings

The frontend talks to the backend over HTTP and uses SSE for live reMarkable sync updates.

### Data Model

NotesDive stores persistent data in `data/`:

- `data/vault/`: markdown notes and synced reMarkable exports
- `data/attachments/`: attachment storage
- `data/integrations/remarkable/`: reMarkable auth, cache, sync state, preview cache
- `data/integrations/vault/`: vault SQLite index
- `data/samples/notes.json`: fallback sample source if the vault has no notes

### reMarkable Sync Flow

1. Pair the app with reMarkable using a one-time code from `https://my.remarkable.com/device/remarkable`
2. The backend caches document metadata in SQLite
3. The UI browses cached documents and previews them
4. A sync exports reMarkable content into `data/vault/remarkable/`
5. The frontend receives live sync progress over SSE from `/api/remarkable/sync-events`

## Current Capabilities

### Vault

- Read markdown notes from the configured vault root
- Parse frontmatter for note metadata
- Build and query a local SQLite vault index
- Show indexed note and folder counts
- Rebuild the vault index on demand

### reMarkable

- Pair and unpair with reMarkable Cloud
- Cache document metadata in SQLite
- Browse cached documents
- Warm preview cache
- Render previews
- Export notebooks as markdown
- Export documents as PDF where applicable
- Stream sync progress to the UI via SSE

### Upstream References

The current reMarkable integration is based on a mix of upstream concepts and project-specific implementation:

- `ddvk/rmapi` informed the auth, registration, token, and document listing approach
- `rmscene` is used for `.rm` scene parsing and text extraction
- the cache layer, preview generation, markdown export, and vault sync flow are implemented in this repository

### Ollama

- Save integration settings
- List available models
- Start chats
- Stream assistant responses
- Persist chat history in SQLite
- Send vault or reMarkable documents into the chat flow

### Scriberr

- Save integration settings
- List transcriptions
- Filter and inspect transcription records in the UI

## API Overview

Main endpoints currently exposed by the backend:

### Core

- `GET /api/health`
- `GET /api/notes`
- `GET /api/notes/{note_id}`
- `POST /api/notes`
- `GET /api/vault/info`
- `POST /api/vault/reindex`

### Integration Settings

- `GET /api/integrations/settings`
- `POST /api/integrations/ollama/settings`
- `POST /api/integrations/scriberr/settings`

### Ollama

- `POST /api/ollama/chat`
- `POST /api/ollama/chat/stream`
- `GET /api/ollama/chats`
- `GET /api/ollama/chats/{chat_id}`
- `GET /api/ollama/models`

### Scriberr

- `GET /api/scriberr/transcriptions`

### reMarkable

- `GET /api/remarkable/status`
- `POST /api/remarkable/register`
- `POST /api/remarkable/unpair`
- `GET /api/remarkable/documents`
- `POST /api/remarkable/preview-cache/warm`
- `GET /api/remarkable/sync-status`
- `GET /api/remarkable/sync-events`
- `POST /api/remarkable/sync`
- `GET /api/remarkable/documents/{document_id}/asset`
- `GET /api/remarkable/documents/{document_id}/preview`
- `GET /api/remarkable/documents/{document_id}/context`

## Environment Variables

General variables used in local or deployed environments:

### Compose / Frontend

- `BACKEND_PORT`
- `FRONTEND_PORT`
- `VITE_API_BASE_URL`
- `VITE_APP_BUILD_REF`
- `VITE_APP_BUILD_TIME`

### Backend

- `APP_BUILD_REF`
- `APP_BUILD_TIME`
- `APP_CORS_ORIGINS`
- `APP_DATA_ROOT`
- `APP_NOTES_SEED_FILE`
- `APP_VAULT_ROOT`
- `APP_ATTACHMENTS_ROOT`
- `APP_VAULT_INTEGRATION_ROOT`
- `APP_OLLAMA_INTEGRATION_ROOT`
- `APP_SCRIBERR_INTEGRATION_ROOT`
- `APP_REMARKABLE_INTEGRATION_ROOT`
- `APP_REMARKABLE_SETUP_URL`
- `APP_REMARKABLE_AUTH_ROOT`
- `APP_REMARKABLE_DOC_ROOT`
- `APP_REMARKABLE_SYNC_ROOT`
- `APP_REMARKABLE_CACHE_DB_NAME`

See [.env.example](.env.example) and [backend/app/core/config.py](backend/app/core/config.py) for the effective defaults.

## Local Development

### Option 1: Start Both Services With The Helper Script

```bash
chmod +x run.sh
./run.sh
```

What `run.sh` does:

- creates `backend/.venv` if needed
- installs backend dependencies
- installs frontend dependencies
- prepares the `data/` directories
- starts the backend on `3010`
- starts the frontend on `5173`

Default local URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3010`
- Swagger docs: `http://localhost:3010/docs`

### Option 2: Docker Compose For Development

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yaml up --build
```

This uses:

- live reload for the backend
- Vite dev server for the frontend
- bind mounts for source code and `data/`

Relevant files:

- [docker-compose.dev.yaml](docker-compose.dev.yaml)
- [frontend/Dockerfile.dev](frontend/Dockerfile.dev)

### Option 3: Start Services Manually

Backend:

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
APP_CORS_ORIGINS='["http://localhost:5173"]' \
APP_DATA_ROOT=../data \
APP_NOTES_SEED_FILE=../data/samples/notes.json \
APP_VAULT_ROOT=../data/vault \
APP_ATTACHMENTS_ROOT=../data/attachments \
uvicorn app.main:app --app-dir . --reload --reload-dir app --host 0.0.0.0 --port 3010
```

Frontend:

```bash
cd frontend
npm install
VITE_API_BASE_URL=http://localhost:3010 npm run dev -- --host 0.0.0.0 --port 5173
```

## Production-Like Docker Compose

The repository contains a production-oriented compose file in [docker-compose.yaml](docker-compose.yaml).

Start it locally with:

```bash
cp .env.example .env
docker compose up --build
```

This file:

- builds the backend from [backend/Dockerfile](backend/Dockerfile)
- builds the frontend from [frontend/Dockerfile](frontend/Dockerfile)
- mounts `./data` into `/data`
- passes build metadata into both containers

## Coolify Deployment

NotesDive can be deployed to Coolify using the root-level [docker-compose.yaml](docker-compose.yaml).

### Recommended Setup

Use one Compose-based application in Coolify pointing at the repository root.

Coolify should use:

- Compose file: `docker-compose.yaml`
- Base directory: repository root

### Persistent Storage

You should keep `/data` persistent. That directory contains:

- the vault
- reMarkable auth state
- reMarkable cache database
- vault index database
- preview cache output
- synced exports

If you do not persist `/data`, you will lose:

- reMarkable pairing state
- sync state
- preview cache
- vault index
- local notes and synced documents

### Required Environment Variables In Coolify

At minimum, set:

```env
APP_CORS_ORIGINS=["https://notes.example.com"]
VITE_API_BASE_URL=https://api.example.com
APP_BUILD_REF=<git-sha-or-tag>
APP_BUILD_TIME=<build-timestamp>
VITE_APP_BUILD_REF=<git-sha-or-tag>
VITE_APP_BUILD_TIME=<build-timestamp>
```

If frontend and backend are served behind the same public Coolify domain pattern, use the actual backend URL in `VITE_API_BASE_URL`.

### Coolify Deployment Steps

1. Create a new Compose-based app in Coolify.
2. Point it to this repository.
3. Select [docker-compose.yaml](docker-compose.yaml).
4. Configure persistent storage for the backend service so `/data` survives redeploys.
5. Set `APP_CORS_ORIGINS` to the public frontend domain.
6. Set `VITE_API_BASE_URL` to the public backend URL.
7. Optionally set build metadata variables so the UI and API show the deployed ref.
8. Deploy.

### Coolify Notes

- SSE is used for reMarkable sync progress. The backend already returns `X-Accel-Buffering: no` on the sync event stream, which helps with reverse proxy buffering.
- If you put another proxy in front of Coolify, make sure it does not aggressively buffer `text/event-stream`.
- The frontend is a built Vite app, not the Vite dev server, when deployed through [frontend/Dockerfile](frontend/Dockerfile).

## Operational Notes

### reMarkable

- Pairing requires a one-time code from `https://my.remarkable.com/device/remarkable`
- Cached metadata is stored in SQLite under `data/integrations/remarkable`
- Sync exports are written under `data/vault/remarkable/`
- Sync progress is pushed to the frontend via SSE

### Vault Index

- The vault index is stored under `data/integrations/vault`
- `POST /api/vault/reindex` rebuilds the index from the current vault files

### Frontmatter And Notes

Vault notes are read from markdown. NotesDive uses frontmatter where available for:

- `id`
- `title`
- `summary`
- `source`
- `created_at`
- `modified_at`
- `remarkable_id`
- `attachment_paths`

If source documents are inconsistent, the export tries to stay tolerant rather than forcing overly strict structure.

## Example Note Create Payload

```json
{
  "title": "Quick capture from web client",
  "summary": "A demo note created from the UI.",
  "content": "# Example\n\nCreated from NotesDive.",
  "source": "web-client",
  "tags": ["demo", "inbox"],
  "vault_path": "Inbox/quick-capture-from-web-client.md",
  "attachment_paths": ["remarkable/sketch-01.pdf"]
}
```

## Known Design Direction

The codebase is intentionally structured so the current setup can evolve further without a rewrite:

- better vault search
- richer sync bookkeeping
- improved markdown export heuristics
- more advanced AI workflows through Ollama
- tighter integration with external note and transcription systems

## Repository Files Worth Knowing

- [README.md](README.md)
- [docker-compose.yaml](docker-compose.yaml)
- [docker-compose.dev.yaml](docker-compose.dev.yaml)
- [.env.example](.env.example)
- [run.sh](run.sh)
- [backend/app/core/config.py](backend/app/core/config.py)
- [backend/app/api/routes.py](backend/app/api/routes.py)
