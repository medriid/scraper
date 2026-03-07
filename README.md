# Scrapex

AI-powered web scraping with agentic sessions and TypeScript API generation.

---

## Environment Variable Setup

You need two sets of environment variables: **server-side** (read only by the Node.js backend) and **client-side** (prefixed with `VITE_`, bundled into the browser build).

Copy `.env.example` to `.env` and fill in the values below.

---

### Required — Supabase

Go to [supabase.com](https://supabase.com) → your project → **Project Settings → API**.

| Variable | Where to use it | What to put |
|---|---|---|
| `SUPABASE_URL` | Server (`.env`) | Your project URL, e.g. `https://abc123.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server (`.env`) | **service_role** secret key — shown in the API settings. **Never expose this to the browser.** |
| `SUPABASE_PUBLISHABLE_KEY` | Server (`.env`) | The **anon / publishable** key — also in API settings. Only needed if you don't set the service role key above. |
| `VITE_SUPABASE_URL` | Client (`.env`) | Same URL as `SUPABASE_URL` above |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client (`.env`) | The **anon / publishable** key. Safe to expose to the browser. In older dashboard versions this is called "anon key"; both are the same value. |

> **TL;DR — what key goes where:**
> - `SUPABASE_SERVICE_ROLE_KEY` → server only, never the browser
> - `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`) → browser/client, safe to expose

---

### Optional — Database connection (for automatic migrations)

Go to **Project Settings → Database → Connection string → URI**.

| Variable | Where to use it | What to put |
|---|---|---|
| `DATABASE_URL` | Server (`.env`) | PostgreSQL connection string, e.g. `postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres` |

When `DATABASE_URL` is set the server will automatically run any un-applied SQL files from `supabase/migrations/` on startup.  
If it is not set, migrations are skipped (you can run them manually in the Supabase SQL editor).

---

### Optional — Database status badge

| Variable | Where to use it | What to put |
|---|---|---|
| `VITE_SHOW_DB_STATUS` | Client (`.env`) | `true` to show a live DB status badge in the app header; `false` (default) to hide it |

---

### Required — AI API Keys

The scraper needs at least one AI provider key.

| Variable | Provider | Where to get one |
|---|---|---|
| `GEMINI_API_KEY_1` (+ `_2`, `_3` …) | Google Gemini | [aistudio.google.com](https://aistudio.google.com/app/apikey) — free tier available |
| `GROQ_API_KEY_1` (+ `_2`, …) | Groq | [console.groq.com](https://console.groq.com) — very generous free tier |
| `OPENROUTER_API_KEY_1` (+ `_2`, …) | OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) — free models available |

Multiple keys of the same provider are supported and are round-robin rotated automatically.

---

### Server settings

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `NODE_ENV` | `development` | Set to `production` on Heroku |
| `CLIENT_URL` | `http://localhost:5173` | Used for CORS; set to your Heroku app URL in production |

---

## Running locally

```bash
cp .env.example .env
# fill in .env values

npm install
npm run dev       # starts both client (port 5173) and server (port 3001)
```

## Running migrations manually

```bash
npm run build
npm run migrate   # runs supabase/migrations/*.sql against DATABASE_URL
```

## Deploying to Heroku

1. Set all environment variables in the Heroku dashboard (Settings → Config Vars)
2. Push — Heroku runs `heroku-postbuild` (builds both client and server) then `Procfile` which runs migrations and starts the server

---

## Recommended future features

- **Scheduled scraping** — cron jobs to re-run scrapers on a schedule and store diffs
- **Export formats** — download results as CSV, JSON, or XLSX directly from the UI
- **Scraper library** — save and re-run past scrapers with one click from Session History
- **Webhooks** — POST results to a URL when a scrape completes
- **Team access** — role-based access (viewer / editor / owner) instead of the current binary is_owner flag
- **Visual schema editor** — drag-and-drop editor to tweak the AI-generated data schema before generating the scraper
- **Diff viewer** — compare two scrape results side-by-side to spot changes
- **Rate-limit per user** — per-user scrape quotas tracked in the database
- **Dark/light theme toggle** — system-preference aware theme switcher
- **Browser extension** — highlight elements on a live page to feed context directly to the agent

