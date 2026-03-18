const NOTION_API_VERSION = '2022-06-28';

export async function onRequestPost(context) {
    const token = context.env.NOTION_TOKEN;
    const tasksPageId = context.env.TASKS_PAGE_ID;

    if (!token) return new Response(JSON.stringify({ error: 'NOTION_TOKEN not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
    });
    if (!tasksPageId) return new Response(JSON.stringify({ error: 'TASKS_PAGE_ID not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
    });

    const { text } = await context.request.json();
    if (!text || typeof text !== 'string' || !text.trim()) {
        return new Response(JSON.stringify({ error: 'text (non-empty string) required' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
        });
    }

    const r = await fetch(`https://api.notion.com/v1/blocks/${tasksPageId}/children`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': NOTION_API_VERSION,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            children: [{
                object: 'block',
                type: 'to_do',
                to_do: {
                    rich_text: [{ type: 'text', text: { content: text.trim() } }],
                    checked: false,
                },
            }],
        }),
    });

    if (!r.ok) {
        const err = await r.text();
        return new Response(JSON.stringify({ error: err }), {
            status: r.status, headers: { 'Content-Type': 'application/json' }
        });
    }

    const data = await r.json();
    const block = data.results?.[0];

    return new Response(JSON.stringify({
        ok: true,
        todo: block ? {
            id: block.id,
            text: text.trim(),
            checked: false,
            heading: 'Quick Tasks',
        } : null,
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
