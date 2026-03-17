const NOTION_API_VERSION = '2022-06-28';
const BASE_URL = 'https://api.notion.com/v1';
const PAGE_ID = '29a5bdeb-6ad9-8046-b54f-c69734ecfe6b';

async function fetchChildren(token, blockId, cursor) {
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
    if (depth > 3) return [];
    const todos = [];
    const children = await allChildren(token, blockId);
    for (const b of children) {
        const t = b.type;
        if (t === 'to_do') {
            todos.push({ id: b.id, text: plainText(b.to_do?.rich_text), checked: b.to_do?.checked || false, heading });
            if (b.has_children) todos.push(...await walkChildren(token, b.id, heading, depth + 1));
        } else if (t === 'toggle') {
            const label = plainText(b.toggle?.rich_text) || heading;
            if (b.has_children) todos.push(...await walkChildren(token, b.id, label, depth + 1));
        } else if (['heading_1', 'heading_2', 'heading_3'].includes(t)) {
            const sub = plainText(b[t]?.rich_text);
            if (b.has_children) todos.push(...await walkChildren(token, b.id, sub, depth + 1));
        } else if (['bulleted_list_item', 'numbered_list_item', 'paragraph', 'callout', 'quote', 'column', 'column_list'].includes(t)) {
            if (b.has_children && depth < 1) todos.push(...await walkChildren(token, b.id, heading, depth + 1));
        }
    }
    return todos;
}

async function collectTodos(token) {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const todos = [];
    let heading = 'Ungrouped';
    let oldStreak = 0;
    let cursor = null;
    do {
        const { results, next } = await fetchChildren(token, PAGE_ID, cursor);
        cursor = next;
        for (const b of results) {
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

export async function onRequestGet(context) {
    const token = context.env.NOTION_TOKEN;
    if (!token) return new Response(JSON.stringify({ error: 'NOTION_TOKEN not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
    });
    try {
        const todos = await collectTodos(token);
        return new Response(JSON.stringify({ todos, lastSynced: new Date().toISOString() }), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
        });
    }
}
