const NOTION_API_VERSION = '2022-06-28';

export async function onRequestPost(context) {
    const token = context.env.NOTION_TOKEN;
    if (!token) return new Response(JSON.stringify({ error: 'NOTION_TOKEN not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
    });

    const { id, checked } = await context.request.json();
    if (!id || typeof checked !== 'boolean') {
        return new Response(JSON.stringify({ error: 'id (string) and checked (boolean) required' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
        });
    }

    const r = await fetch(`https://api.notion.com/v1/blocks/${id}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': NOTION_API_VERSION,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to_do: { checked } }),
    });

    if (!r.ok) {
        const err = await r.text();
        return new Response(JSON.stringify({ error: err }), {
            status: r.status, headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
