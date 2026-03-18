const NOTION_API_VERSION = '2022-06-28';
const BASE_URL = 'https://api.notion.com/v1';
const PAGE_ID = '29a5bdeb-6ad9-8046-b54f-c69734ecfe6b';
const QUICK_TASKS_HEADING = 'Quick Tasks';
const CACHE_KEY = 'https://todo.seantippen.com/_internal/todos-cache';
const CACHE_TTL = 120; // seconds

// Track subrequests to stay under Cloudflare's 50 limit
let subRequests = 0;
const MAX_SUB = 45;

async function fetchChildren(token, blockId, cursor) {
    if (subRequests >= MAX_SUB) return { results: [], next: null };
    subRequests++;
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    const r = await fetch(`${BASE_URL}/blocks/${blockId}/children?${params}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_API_VERSION }
    });
    if (r.status === 429) {
        const wait = parseFloat(r.headers.get('Retry-After') || '1') * 1000;
        await new Promise(ok => setTimeout(ok, wait));
        return fetchChildren(token, blockId, cursor);
    }
    if (!r.ok) throw new Error(`Notion API error: ${r.status}`);
    const data = await r.json();
    return { results: data.results || [], next: data.next_cursor };
}

async function allChildren(token, blockId) {
    const all = [];
    let cursor = null;
    do {
        const { results, next } = await fetchChildren(token, blockId, cursor);
        all.push(...results);
        cursor = next;
    } while (cursor);
    return all;
}

function plainText(rt) {
    return (rt || []).map(s => {
        if (s.type === 'mention' && s.mention?.type === 'date') return s.mention.date?.start || s.plain_text || '';
        return s.plain_text || '';
    }).join('').trim();
}

function isRecent(heading, cutoff) {
    const m = heading.match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] >= cutoff : true;
}

async function walkChildren(token, blockId, heading, depth) {
    if (depth > 2 || subRequests >= MAX_SUB) return [];
    const todos = [];
    const children = await allChildren(token, blockId);
    for (const b of children) {
        if (subRequests >= MAX_SUB) break;
        const t = b.type;
        if (t === 'to_do') {
            todos.push({ id: b.id, text: plainText(b.to_do?.rich_text), checked: b.to_do?.checked || false, heading });
            if (b.has_children && depth < 1) todos.push(...await walkChildren(token, b.id, heading, depth + 1));
        } else if (t === 'toggle') {
            const label = plainText(b.toggle?.rich_text) || heading;
            if (b.has_children) todos.push(...await walkChildren(token, b.id, label, depth + 1));
        } else if (['heading_1', 'heading_2', 'heading_3'].includes(t)) {
            const sub = plainText(b[t]?.rich_text);
            if (b.has_children) todos.push(...await walkChildren(token, b.id, sub, depth + 1));
        }
    }
    return todos;
}

async function collectTodos(token) {
    subRequests = 0;
    const cutoff = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0];
    const todos = [];
    let heading = 'Ungrouped';
    let oldStreak = 0;
    let cursor = null;
    do {
        const { results, next } = await fetchChildren(token, PAGE_ID, cursor);
        cursor = next;
        for (const b of results) {
            if (subRequests >= MAX_SUB) return todos;
            const t = b.type;
            if (['heading_1', 'heading_2', 'heading_3'].includes(t)) {
                heading = plainText(b[t]?.rich_text);
                if (!isRecent(heading, cutoff)) { oldStreak++; if (oldStreak >= 2) return todos; continue; }
                oldStreak = 0;
                if (b.has_children) todos.push(...await walkChildren(token, b.id, heading, 0));
            } else if (t === 'toggle') {
                const label = plainText(b.toggle?.rich_text) || heading;
                if (b.has_children) todos.push(...await walkChildren(token, b.id, label, 0));
            } else if (t === 'to_do') {
                todos.push({ id: b.id, text: plainText(b.to_do?.rich_text), checked: b.to_do?.checked || false, heading });
            }
        }
    } while (cursor);
    return todos;
}

async function collectQuickTasks(token, tasksPageId) {
    if (!tasksPageId) return [];
    const todos = [];
    const children = await allChildren(token, tasksPageId);
    for (const b of children) {
        if (b.type === 'to_do') {
            todos.push({ id: b.id, text: plainText(b.to_do?.rich_text), checked: b.to_do?.checked || false, heading: QUICK_TASKS_HEADING });
        }
    }
    return todos;
}

function jsonResp(data, status) {
    return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
    });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname === '/api/todos' && request.method === 'GET') {
            const token = env.NOTION_TOKEN;
            if (!token) return jsonResp({ error: 'NOTION_TOKEN not configured' }, 500);

            // Check cache first
            const cache = caches.default;
            const cacheReq = new Request(CACHE_KEY);
            const cached = await cache.match(cacheReq);
            if (cached) return cached;

            try {
                const tasksPageId = env.TASKS_PAGE_ID;
                const [journalTodos, quickTodos] = await Promise.all([
                    collectTodos(token),
                    collectQuickTasks(token, tasksPageId),
                ]);
                const todos = [...quickTodos, ...journalTodos];
                const resp = jsonResp({ todos, lastSynced: new Date().toISOString() });
                const toCache = new Response(resp.clone().body, resp);
                toCache.headers.set('Cache-Control', `max-age=${CACHE_TTL}`);
                ctx.waitUntil(cache.put(cacheReq, toCache));
                return resp;
            } catch (e) {
                return jsonResp({ error: e.message }, 500);
            }
        }

        if (url.pathname === '/api/add' && request.method === 'POST') {
            const token = env.NOTION_TOKEN;
            const tasksPageId = env.TASKS_PAGE_ID;
            if (!token) return jsonResp({ error: 'NOTION_TOKEN not configured' }, 500);
            if (!tasksPageId) return jsonResp({ error: 'TASKS_PAGE_ID not configured' }, 500);
            const { text } = await request.json();
            if (!text || typeof text !== 'string' || !text.trim()) return jsonResp({ error: 'text required' }, 400);
            const r = await fetch(`${BASE_URL}/blocks/${tasksPageId}/children`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_API_VERSION, 'Content-Type': 'application/json' },
                body: JSON.stringify({ children: [{ object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: text.trim() } }], checked: false } }] }),
            });
            if (!r.ok) return jsonResp({ error: await r.text() }, r.status);
            const data = await r.json();
            const block = data.results?.[0];
            // Purge cache so next read is fresh
            const cache = caches.default;
            ctx.waitUntil(cache.delete(new Request(CACHE_KEY)));
            return jsonResp({ ok: true, todo: block ? { id: block.id, text: text.trim(), checked: false, heading: QUICK_TASKS_HEADING } : null });
        }

        if (url.pathname === '/api/setup' && request.method === 'POST') {
            const token = env.NOTION_TOKEN;
            if (!token) return jsonResp({ error: 'NOTION_TOKEN not configured' }, 500);
            if (env.TASKS_PAGE_ID) return jsonResp({ error: 'TASKS_PAGE_ID already set', id: env.TASKS_PAGE_ID }, 400);
            const r = await fetch('https://api.notion.com/v1/pages', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_API_VERSION, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    parent: { page_id: PAGE_ID },
                    properties: { title: [{ text: { content: 'Quick Tasks' } }] },
                    icon: { type: 'emoji', emoji: '⚡' },
                    children: [{ object: 'block', type: 'callout', callout: { icon: { type: 'emoji', emoji: '📝' }, rich_text: [{ text: { content: 'Tasks added from the Triumph Todos app appear here.' } }] } }],
                }),
            });
            if (!r.ok) return jsonResp({ error: await r.text() }, r.status);
            const page = await r.json();
            return jsonResp({ ok: true, tasks_page_id: page.id, instructions: 'Set this as TASKS_PAGE_ID in Cloudflare Pages environment variables, then redeploy.' });
        }

        if (url.pathname === '/api/update' && request.method === 'POST') {
            const token = env.NOTION_TOKEN;
            if (!token) return jsonResp({ error: 'NOTION_TOKEN not configured' }, 500);
            const { id, checked } = await request.json();
            if (!id || typeof checked !== 'boolean') return jsonResp({ error: 'id and checked required' }, 400);
            const r = await fetch(`${BASE_URL}/blocks/${id}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_API_VERSION, 'Content-Type': 'application/json' },
                body: JSON.stringify({ to_do: { checked } }),
            });
            if (!r.ok) return jsonResp({ error: await r.text() }, r.status);
            // Purge cache so next read is fresh
            const cache = caches.default;
            ctx.waitUntil(cache.delete(new Request(CACHE_KEY)));
            return jsonResp({ ok: true });
        }

        if (url.pathname === '/api/edit' && request.method === 'POST') {
            const token = env.NOTION_TOKEN;
            if (!token) return jsonResp({ error: 'NOTION_TOKEN not configured' }, 500);
            const { id, text } = await request.json();
            if (!id || typeof text !== 'string' || !text.trim()) return jsonResp({ error: 'id and text required' }, 400);
            const r = await fetch(`${BASE_URL}/blocks/${id}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_API_VERSION, 'Content-Type': 'application/json' },
                body: JSON.stringify({ to_do: { rich_text: [{ type: 'text', text: { content: text.trim() } }] } }),
            });
            if (!r.ok) return jsonResp({ error: await r.text() }, r.status);
            const cache = caches.default;
            ctx.waitUntil(cache.delete(new Request(CACHE_KEY)));
            return jsonResp({ ok: true });
        }

        return env.ASSETS.fetch(request);
    }
};
