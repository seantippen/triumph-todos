# Triumph Todos — Features

## Two interfaces, one source of truth
- Web dashboard at todo.seantippen.com — works on any device
- Native desktop app (Python/tkinter) — system tray, keyboard-driven
- Both read and write to the same Notion page in real-time

## Task management
- Pull tasks from your Notion daily work journal automatically
- Add new tasks from either app — stored in a dedicated Quick Tasks page
- Check/uncheck tasks — syncs back to Notion instantly with optimistic UI
- Ctrl+Z undo — reverts the last checkbox toggle (local + Notion)
- Smart 7-day window — only shows recent tasks, ignores old history

## Views
- **Grouped mode** — tasks organized under Notion date headings with count badges
- **Flat mode** — one continuous list, no headers, fully reorderable
- **Filter buttons** — All / Today / This Week
- **Inline search** — live-filter by task text or heading
- Collapsible "Completed today" section

## Drag-to-reorder (flat mode)
- Drag any task to auto-switch to flat mode
- Custom order persists in localStorage across refreshes
- Drag handles appear on the left (⠇ grip)
- Green drop indicator shows placement
- New tasks from Notion sync slot in at the top

## Custom dividers
- Add moveable divider cards between tasks
- Inline-editable labels (click to rename)
- Draggable and deleteable — organize your list however you want
- Persist across refreshes

## Desktop app extras
- Smart polling — 2-min base, exponential backoff when idle
- Focus-aware — refreshes immediately when you tab back in
- System tray — minimize to tray, stays running in background
- Keyboard shortcuts — Ctrl+N add, Ctrl+F search, Ctrl+R refresh, Ctrl+1/2/3 filter
- Ctrl+E toggle completed section

## Web dashboard extras
- Sticky frosted-glass header
- Skeleton loading with shimmer animation
- Sync status indicator (stale warning after 5 min)
- Auto-refresh every 2 minutes, pauses when tab is hidden
- Mobile-responsive down to 320px

## Infrastructure
- Cloudflare Pages + Workers — global edge, sub-100ms responses
- Worker-level caching with tag-based purge on writes
- Notion API rate limit handling with automatic retry
- No database — Notion is the database
- No build step — single HTML file, vanilla JS
- Subrequest budgeting to stay under Cloudflare's 50-request limit
