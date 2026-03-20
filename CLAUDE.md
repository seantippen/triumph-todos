# triumph-todos

## Overview
To-do app with Notion sync — desktop (tkinter) + web (Cloudflare Pages), both read/write the same Notion pages.

## Stack
- **Desktop**: Python 3.8+ / tkinter (`app.py`)
- **Web Frontend**: Vanilla JS, single-file `web/index.html`, no build step
- **Web Backend**: Cloudflare Workers via `web/_worker.js`
- **Database**: Notion API (no local DB)
- **Deploy**: Cloudflare Pages (project name: `todo`)
- **Live URL**: https://todo.seantippen.com/
- **Repo**: https://github.com/seantippen/triumph-todos (public)

## Key Files
- `app.py` — **SACRED. Do not modify unless explicitly asked.** Desktop app (tkinter, system tray, smart polling)
- `notion_api.py` — Shared Notion REST client (no SDK, raw `requests`)
- `web/index.html` — Full web app (vanilla JS + inline CSS, localStorage state)
- `web/_worker.js` — **THE routing layer.** Overrides `functions/api/` entirely. All API routes live here.
- `web/sw.js` — Service Worker (offline support, caching)
- `web/manifest.json` — PWA manifest
- `web/functions/api/*.js` — **DEPRECATED. Do not use.** Legacy stubs, `_worker.js` handles everything.
- `deploy.sh` — One-line deployment script

## API Routes (all in `_worker.js`)
- `GET /api/todos` — Fetch from Notion journal + Quick Tasks (120s cache)
- `POST /api/add` — Create to-do in Quick Tasks
- `POST /api/update` — Toggle checkbox
- `POST /api/edit` — Update task text
- `POST /api/delete` — Delete block
- `POST /api/setup` — Create new Quick Tasks page

## Notion Page IDs
- Journal: `29a5bdeb-6ad9-8046-b54f-c69734ecfe6b` (hardcoded in `_worker.js` and `notion_api.py`)
- Quick Tasks: `3275bdeb-6ad9-81ef-9238-de8507164336` (env var `TASKS_PAGE_ID` in CF Pages)

## Build & Deploy
```bash
# Deploy web app (no build step)
npx wrangler pages deploy web --project-name=todo --branch=master
# Or use the script:
./deploy.sh
```
- **No wrangler.toml** — config managed in Cloudflare dashboard
- **GitHub auto-deploy does NOT work** — always use wrangler manually
- CF Pages env vars: `NOTION_TOKEN`, `TASKS_PAGE_ID`

## Rules
- `app.py` is SACRED — never touch without explicit permission
- `_worker.js` is the ONLY routing file — check it before adding any API route
- `functions/api/` is dead code — do not add routes there
- Subrequest budget: `_worker.js` limits to 45/50 CF subrequests per invocation

## Git
- Branch: `master`
- Config: user.email=github@seantippen.com, user.name=Sean Tippen
