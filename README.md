# Scrapex

**Scrapex** is an AI-powered web scraping platform that generates production-ready TypeScript scraper scripts from natural language instructions. Give it a URL and describe the data you want — it analyses the site, designs a JSON schema, refines the prompt, and writes a complete Playwright-based TypeScript script you can run locally to fetch all the data.

> **The AI does not fetch data for you.** It writes a standalone TypeScript *script* that, when you run it, fetches and extracts the data itself. You get clean, version-controlled, re-runnable scraper code.

---

## Features

| Feature | Status |
|---|---|
| Agentic 4-step scraper generation (analyse → schema → refine → build) | ✅ |
| Streams TypeScript code live as the AI writes it | ✅ |
| Session history — browse and review past sessions | ✅ |
| Scraper library — one-click re-run from history | ✅ |
| Teams — create teams, invite members by email, assign roles (owner / editor / viewer) | ✅ |
| Per-user daily rate limiting (1 prompt/day for standard accounts) | ✅ |
| 50+ AI models — Gemini, OpenRouter, Groq with round-robin key rotation | ✅ |
| Dark / light theme | ✅ |
| Email / password + Google + GitHub sign-in | ✅ |
| Role-based access (`is_owner` flag for admin accounts) | ✅ |

---

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite, Framer Motion, Lucide React
- **Backend**: Node.js + Express + TypeScript
- **Database / Auth**: Supabase (PostgreSQL + Row Level Security)
- **AI providers**: Google Gemini, OpenRouter, Groq
- **Scraper runtime**: [Playwright](https://playwright.dev/) (in generated scripts)

---

## Quick Start

### 1 — Clone and install

```bash
git clone https://github.com/medriid/scrapex.git
cd scrapex
npm install
```

### 2 — Configure environment variables

```bash
cp .env.example .env
# Edit .env and fill in your values (see sections below)
```

### 3 — Run locally

```bash
npm run dev
# Client: http://localhost:5173
# Server: http://localhost:3001
```

### 4 — Run database migrations

Migrations run automatically on startup if `DATABASE_URL` is set. To run them manually:

```bash
npm run build
npm run migrate
```

---

## Environment Variables

### Supabase (required)

Go to [supabase.com](https://supabase.com) → your project → **Project Settings → API**.

| Variable | Where | Description |
|---|---|---|
| `SUPABASE_URL` | Server | Your project URL, e.g. `https://abc123.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | **Service role** secret key — **never expose to the browser** |
| `VITE_SUPABASE_URL` | Client | Same URL as above |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client | **Anon / publishable** key — safe to expose |

### AI API Keys (at least one required)

| Variable | Provider | Where to get one |
|---|---|---|
| `GEMINI_API_KEY_1` (+ `_2`, `_3` …) | Google Gemini | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| `GROQ_API_KEY_1` (+ `_2`, …) | Groq | [console.groq.com](https://console.groq.com) — generous free tier |
| `OPENROUTER_API_KEY_1` (+ `_2`, …) | OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) |

Multiple keys per provider are supported and automatically round-robin rotated.

### Optional

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL URI for auto-migrations on startup |
| `PORT` | `3001` | HTTP server port |
| `NODE_ENV` | `development` | Set to `production` on Heroku |
| `CLIENT_URL` | `http://localhost:5173` | Used for CORS — set to your Heroku URL in production |
| `VITE_SHOW_DB_STATUS` | `false` | Show live DB status badge in the app header |

---

## Giving yourself admin access

After signing up, run this SQL in the Supabase SQL Editor to grant owner access:

```sql
UPDATE public.users SET is_owner = true WHERE email = 'your@email.com';
```

Owners have unlimited daily prompts and full access to all features.

---

## Setting Up Google Sign-In

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**.
2. Create a new **OAuth 2.0 Client ID** (Web application).
3. Under **Authorized redirect URIs**, add:
   ```
   https://<your-supabase-project-ref>.supabase.co/auth/v1/callback
   ```
4. Copy the **Client ID** and **Client Secret**.
5. In your Supabase dashboard → **Authentication → Providers → Google**, enable it and paste your Client ID and Client Secret.
6. Save — Google sign-in is now active.

> The OAuth redirect URI is your **Supabase project URL** + `/auth/v1/callback`. Supabase handles the OAuth exchange; you do not need to add any callback URL to your own server.

---

## Setting Up GitHub Sign-In

1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps → New OAuth App**.
2. Set **Homepage URL** to your app URL (e.g. `https://yourapp.herokuapp.com`).
3. Set **Authorization callback URL** to:
   ```
   https://<your-supabase-project-ref>.supabase.co/auth/v1/callback
   ```
   This is the **GitHub OAuth callback URL** — it points to Supabase, which handles the token exchange and then redirects back to your app.
4. Copy the **Client ID** and generate a **Client Secret**.
5. In your Supabase dashboard → **Authentication → Providers → GitHub**, enable it and paste your Client ID and Client Secret.

> **What is the GitHub OAuth callback URL?** It is the URL GitHub redirects to after the user approves access. For Supabase-managed OAuth, this is always your Supabase project's auth endpoint (`/auth/v1/callback`). Supabase verifies the code, creates/updates the user session, and redirects back to your app's `redirectTo` URL (by default `window.location.origin`).

---

## Teams

The Teams feature lets you collaborate with others:

- Create a team with any name.
- Invite members by their Scrapex email address.
- Assign roles: **Owner** (full control), **Editor** (can run sessions), **Viewer** (read-only).
- Remove members at any time.

Teams are accessible from the **Teams** tab in the sidebar.

---

## Rate Limiting

| Account type | Daily prompts | Notes |
|---|---|---|
| Standard (all sign-ups) | 1 prompt/day | Resets at midnight UTC |
| Owner (`is_owner = true`) | Unlimited | Set via SQL (see above) |

The sidebar shows a usage bar for standard accounts. When the limit is reached, the session form is disabled until the next day.

---

## Running the Generated Script

Every session produces a standalone TypeScript scraper. To run it:

```bash
# Install dependencies
npm install playwright
npx playwright install chromium

# Run (TypeScript)
npx ts-node scraper.ts

# Or compile first
npx tsc --target ES2020 --module CommonJS --esModuleInterop true scraper.ts
node scraper.js
```

Results are printed as formatted JSON to stdout. You can pipe or redirect:

```bash
npx ts-node scraper.ts > results.json
```

---

## Deploying to Heroku

1. Set all environment variables in **Heroku → Settings → Config Vars**.
2. Push — the `Procfile` runs migrations then starts the server:

```
release: npm run migrate
web: node server/dist/index.js
```

Make sure `CLIENT_URL` is set to your Heroku app URL so CORS is configured correctly.

---

## Database Migrations

Migrations live in `supabase/migrations/` and run in filename order:

| File | Description |
|---|---|
| `001_init.sql` | `scraper_sessions` table + RLS |
| `002_users.sql` | `users` table, auth trigger, `user_id` FK on sessions |
| `003_teams.sql` | `teams` + `team_members` tables, daily usage columns |

To apply manually, run each file in the Supabase SQL Editor or use:

```bash
npm run migrate
```

