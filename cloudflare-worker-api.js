// Cloudflare Worker pro api.63e.cz - signalizace s CORS
// Vyžaduje KV binding s názvem SIGNAL_KV.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      const url = new URL(request.url);

      if (url.pathname === '/log') {
        return json({ success: true });
      }

      if (!env.SIGNAL_KV) {
        return json({ success: false, error: 'Missing KV binding SIGNAL_KV' }, 500);
      }

      if (request.method === 'GET') {
        const key = url.searchParams.get('key');
        if (!key) return json({ success: false, error: 'Missing key' }, 400);
        const content = await env.SIGNAL_KV.get(key);
        return json({ success: true, content: content || null });
      }

      if (request.method === 'POST') {
        const body = await request.json();
        if (!body || !body.subdomain) return json({ success: false, error: 'Missing subdomain' }, 400);
        await env.SIGNAL_KV.put(String(body.subdomain), String(body.content || ''), { expirationTtl: 300 });
        return json({ success: true });
      }

      return json({ success: false, error: 'Method not allowed' }, 405);
    } catch (err) {
      return json({ success: false, error: err && err.message ? err.message : String(err) }, 500);
    }
  },
};
