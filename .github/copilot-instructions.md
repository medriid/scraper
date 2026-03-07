# Copilot Instructions for Scrapex

## Project Overview

Scrapex is an AI-powered web scraping platform with agentic sessions and TypeScript API generation. Users provide a URL and natural-language instructions; the AI analyses the target site, designs a JSON schema, refines the prompt, and streams a production-ready TypeScript/Playwright scraper back to the browser in real time.

## Repository Structure

```
scrapex/
├── client/          # React 18 + Vite + TypeScript frontend
│   └── src/
│       ├── components/   # UI components (AgentSession, ConfigForm, ResultsPanel, …)
│       ├── contexts/     # React contexts (AuthContext)
│       ├── lib/          # API helpers, Supabase client
│       └── types/        # Shared TypeScript types
├── server/          # Express + Node.js + TypeScript backend
│   └── src/
│       ├── routes/       # Express route handlers (scraper, models, auth)
│       ├── services/     # Business logic (agentService, aiService, keyRotation, supabaseService)
│       └── templates/    # Code-generation templates (apiTemplate)
├── supabase/
│   └── migrations/  # Ordered SQL migration files applied on server startup
├── .env.example     # Template for all required environment variables
└── package.json     # Root workspace — orchestrates client + server
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, framer-motion, lucide-react, Three.js/GSAP |
| Backend | Node.js ≥ 20, Express, TypeScript (`tsx` for dev, `tsc` for prod) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password, Google OAuth, GitHub OAuth) |
| AI providers | Google Gemini, Groq, OpenRouter (round-robin key rotation) |
| Deployment | Heroku (Procfile + heroku-postbuild) |

## Development Setup

```bash
cp .env.example .env   # fill in Supabase + AI API keys (see README for details)
npm install            # installs all workspaces (root, client, server)
npm run dev            # starts client on :5173 and server on :3001 concurrently
```

Key environment variables (all documented in `.env.example`):
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — server-side Supabase access
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` — client-side Supabase access
- `GEMINI_API_KEY_1`, `GROQ_API_KEY_1`, `OPENROUTER_API_KEY_1` (and `_2`, `_3` … for rotation)
- `DATABASE_URL` — PostgreSQL connection string; enables automatic migration on startup
- `CLIENT_URL` — allowed CORS origin (default `http://localhost:5173`)

## Build & Deploy

```bash
npm run build     # tsc for server → server/dist/, tsc + vite build for client → client/dist/
npm run migrate   # runs unapplied SQL files from supabase/migrations/ against DATABASE_URL
npm start         # migrate then start the Express server (serves built client in production)
```

In production (`NODE_ENV=production`) the Express server also serves the built client from `client/dist/`.

## Linting

```bash
npm run lint --workspace=client   # ESLint on client/src (ts, tsx) — zero warnings policy
```

There is no linter configured for the server; rely on TypeScript strict mode (`tsc --noEmit`) instead.

## Testing

There is currently no automated test suite. When adding tests, place them alongside the code they cover (`*.test.ts` / `*.test.tsx`) and use Vitest (client) or the Node.js built-in test runner (server) to stay consistent with the existing toolchain.

## Coding Conventions

- **TypeScript everywhere** — strict mode is on; avoid `any`, prefer explicit return types on exported functions.
- **Named exports** for components, utilities, and service functions; default exports only for React page/component files where conventional.
- **camelCase** for variables and functions; **PascalCase** for React components and TypeScript interfaces/types.
- **ES modules** throughout (`import`/`export`); the server uses `.js` extensions in import paths (required by `tsc` + Node ESM).
- **Server routes** are thin — business logic lives in `services/`; routes validate input (Zod) and call services.
- **AI prompts** live inside the service that uses them (`agentService.ts`, `aiService.ts`), not in route handlers.
- **Environment variables** are read at startup via `dotenv/config` (server) or `import.meta.env` (client); never hard-code keys or secrets.
- **CSS** is plain CSS (no CSS-in-JS); global styles in `client/src/index.css`; component-level classes follow BEM-like naming.
- **No test files** committed to the root — keep them next to the source they cover.

## Architecture Notes

### AI key rotation (`server/src/services/keyRotation.ts`)
Multiple API keys per provider (`GEMINI_API_KEY_1`, `_2`, …) are discovered at startup and round-robin rotated on every request to maximise free-tier quota.

### Agent session flow (`server/src/services/agentService.ts`)
The scraper pipeline runs as a Server-Sent Events (SSE) stream:
1. **Browse** — log the target URL
2. **Analyse** — non-streaming `chatCompletion` to understand site structure
3. **Schema** — non-streaming call to generate a JSON schema
4. **Refine** — non-streaming call to produce a detailed technical spec
5. **Build** — streaming `streamCompletion` that emits `code_chunk` SSE events as TypeScript code is generated

### Supabase schema
The `users` table has an `is_owner` boolean flag. Only users with `is_owner = true` can access the app. Grant access via the Supabase SQL editor:
```sql
UPDATE public.users SET is_owner = true WHERE email = 'you@example.com';
```

### CORS & security
Allowed origins: `CLIENT_URL` env var and any `*.herokuapp.com` domain. Helmet is used with a strict CSP. Rate limiting: 30 req/min for `/api/*`, 200 req/min for static assets.

## Common Tasks

### Add a new AI provider
1. Add key discovery in `server/src/services/keyRotation.ts`.
2. Add a new case in `server/src/services/aiService.ts` (`chatCompletion` and `streamCompletion`).
3. Update `server/src/routes/models.ts` to expose the new models.
4. Document the new `*_API_KEY_n` env vars in `.env.example` and `README.md`.

### Add a new API route
1. Create `server/src/routes/<name>.ts` — validate with Zod, delegate to a service.
2. Register the router in `server/src/index.ts` under `/api/<name>`.
3. Add the corresponding fetch helper in `client/src/lib/api.ts`.

### Add a database migration
1. Create a new file in `supabase/migrations/` with a name like `YYYYMMDD_description.sql`.
2. The migration runs automatically on next server startup when `DATABASE_URL` is set.

### Add a new React component
1. Create `client/src/components/<ComponentName>.tsx` — use a named export.
2. Import and render it from `App.tsx` or the relevant parent component.
3. Add styles to `client/src/index.css` using the existing naming conventions.
