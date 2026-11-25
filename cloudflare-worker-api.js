// Cloudflare Worker pro api.63e.cz
// SIGNAL_KV: signalizace (TTL 5 min) a databáze návštěv (klíče vdb:).
// Prohlížení návštěv: nastav tajnou proměnnou VISITOR_UUID.
// Adresa je https://api.63e.cz/v/<VISITOR_UUID> a hodnota nesmí být v gitu.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const VISIT_TTL = 60 * 60 * 24 * 45;
const INDEX_KEY = 'vdb:index';
const MAX_EVENTS = 400;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function sameSecret(got, expect) {
  if (typeof got !== 'string' || typeof expect !== 'string' || !expect || got.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0;
}

function classifyVisit(ua, visit) {
  const u = String(ua || '').toLowerCase();
  const reasons = [];
  const botUa = /bot|crawl|spider|slurp|headless|phantom|selenium|puppeteer|playwright|wget|curl\/|python-requests|scrapy|bytespider|gptbot|claudebot|bingpreview|facebookexternal|petalbot|ahrefs|semrush|dotbot|yandex|baiduspider|duckduckbot|applebot|googlebot|bingbot|preview|uptime|httpunit|nutch|scan|semrush|ahrefsbot/;
  if (visit && visit.webdriver) reasons.push('webdriver');
  if (botUa.test(u)) reasons.push('ua');
  if (!u || u.length < 12) reasons.push('ua-kratke');
  if (visit && Number(visit.langs) === 0) reasons.push('bez-jazyka');
  if (visit && (Number(visit.w) === 0 || Number(visit.h) === 0)) reasons.push('bez-obrazovky');
  if (reasons.length) return { kind: 'bot', reasons: reasons };
  if (visit && Number(visit.w) > 0 && Number(visit.h) > 0 && Number(visit.langs) > 0) {
    return { kind: 'human', reasons: ['prohlizec'] };
  }
  return { kind: 'unknown', reasons: ['malo-signalu'] };
}

function clip(value, n) {
  return String(value == null ? '' : value).slice(0, n);
}

function normalizeLog(item) {
  const data = item && Array.isArray(item.message) ? item.message[1] : null;
  const message = data && data.message != null ? data.message : (item && typeof item.message === 'string' ? item.message : '');
  return {
    id: clip(data && data.id, 32),
    name: clip(data && data.name, 32),
    role: clip(data && data.role, 16),
    type: clip((data && data.type) || (item && item.type) || 'info', 16),
    message: clip(message, 400),
    time: clip(data && data.time, 40),
  };
}

async function readIndex(kv) {
  try {
    const raw = await kv.get(INDEX_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

async function storeVisit(kv, record) {
  const key = 'vdb:e:' + record.t + ':' + Math.random().toString(36).slice(2, 8);
  const index = await readIndex(kv);
  index.push({
    k: key,
    t: record.t,
    id: record.id,
    name: record.name,
    kind: record.kind,
    n: record.logs.length,
  });
  const dropped = index.length > MAX_EVENTS ? index.splice(0, index.length - MAX_EVENTS) : [];
  await kv.put(key, JSON.stringify(record), { expirationTtl: VISIT_TTL });
  await kv.put(INDEX_KEY, JSON.stringify(index), { expirationTtl: VISIT_TTL });
  for (let i = 0; i < dropped.length; i++) {
    try { await kv.delete(dropped[i].k); } catch (e) {}
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderVisits(events) {
  const counts = { human: 0, bot: 0, unknown: 0 };
  const people = new Map();
  events.forEach((e) => {
    counts[e.kind] = (counts[e.kind] || 0) + 1;
    const key = e.id || 'bez-id';
    const row = people.get(key) || { id: key, name: e.name || '', kind: e.kind, n: 0, logs: 0, last: 0 };
    row.n += 1;
    row.logs += (e.logs || []).length;
    row.last = Math.max(row.last, e.t || 0);
    row.name = e.name || row.name;
    row.kind = e.kind || row.kind;
    people.set(key, row);
  });
  const rows = Array.from(people.values()).sort((a, b) => b.last - a.last);
  const recent = events.slice(-40).reverse();
  const when = (t) => t ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : '';
  const peopleHtml = rows.map((r) =>
    `<tr><td>${esc(when(r.last))}</td><td>${esc(r.kind)}</td><td>${esc(r.name)}</td><td>${esc(r.id)}</td><td>${r.n}</td><td>${r.logs}</td></tr>`
  ).join('');
  const logHtml = recent.map((e) => {
    const lines = (e.logs || []).map((l) => `<li>${esc(l.time)} ${esc(l.type)} ${esc(l.message)}</li>`).join('');
    return `<article><h3>${esc(when(e.t))} · ${esc(e.kind)} · ${esc(e.name || e.id)} · ${esc((e.reasons || []).join(', '))}</h3><ul>${lines}</ul></article>`;
  }).join('');
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>Návštěvy</title>
<style>
body{margin:0;background:#111;color:#eee;font:14px/1.4 sans-serif}
main{max-width:980px;margin:0 auto;padding:24px}
table{width:100%;border-collapse:collapse;margin:12px 0 28px}
td,th{border-bottom:1px solid #333;text-align:left;padding:6px 8px;vertical-align:top}
article{border-top:1px solid #333;padding:10px 0}
h3{font-size:14px;margin:0 0 6px}
li{margin:2px 0}
</style></head><body><main>
<h1>Návštěvy</h1>
<p>Dávek ${events.length}. Lidé ${counts.human || 0}. Boti ${counts.bot || 0}. Nejasné ${counts.unknown || 0}.</p>
<table><thead><tr><th>Naposledy</th><th>Typ</th><th>Jméno</th><th>Id</th><th>Dávky</th><th>Řádky</th></tr></thead><tbody>${peopleHtml}</tbody></table>
<h2>Poslední log</h2>
${logHtml || '<p>Zatím nic.</p>'}
</main></body></html>`;
}

async function handleLog(request, env) {
  if (!env.SIGNAL_KV) return json({ success: false, error: 'Missing KV binding SIGNAL_KV' }, 500);
  const text = await request.text();
  if (text.length > 80000) return json({ success: false, error: 'Too large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ success: false, error: 'Bad JSON' }, 400); }
  const logs = Array.isArray(body && body.logs) ? body.logs.slice(0, 25).map(normalizeLog) : [];
  const visit = body && body.visit && typeof body.visit === 'object' ? body.visit : {};
  const ua = request.headers.get('user-agent') || '';
  const judged = classifyVisit(ua, visit);
  const record = {
    t: Date.now(),
    id: clip(visit.id || (logs[0] && logs[0].id), 32),
    name: clip(visit.name || (logs[0] && logs[0].name), 32),
    build: clip(visit.build, 24),
    kind: judged.kind,
    reasons: judged.reasons,
    country: clip(request.headers.get('cf-ipcountry') || '', 8),
    logs: logs,
  };
  if (!record.logs.length && !record.id) return json({ success: true, stored: false });
  await storeVisit(env.SIGNAL_KV, record);
  return json({ success: true, stored: true, kind: record.kind });
}

async function handleVisits(uuid, env) {
  const secret = env && env.VISITOR_UUID;
  if (!sameSecret(uuid, secret)) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!env.SIGNAL_KV) return new Response('Missing KV', { status: 500 });
  const index = await readIndex(env.SIGNAL_KV);
  const events = [];
  for (let i = 0; i < index.length; i++) {
    try {
      const raw = await env.SIGNAL_KV.get(index[i].k);
      if (raw) events.push(JSON.parse(raw));
    } catch (e) {}
  }
  return new Response(renderVisits(events), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      const url = new URL(request.url);

      if (url.pathname === '/log' && request.method === 'POST') return handleLog(request, env);

      if (request.method === 'GET' && url.pathname.startsWith('/v/')) {
        return handleVisits(decodeURIComponent(url.pathname.slice(3)), env || {});
      }

      if (!env.SIGNAL_KV) {
        return json({ success: false, error: 'Missing KV binding SIGNAL_KV' }, 500);
      }

      if (request.method === 'GET') {
        const key = url.searchParams.get('key');
        if (!key || key.startsWith('vdb:')) return json({ success: false, error: 'Missing key' }, 400);
        const content = await env.SIGNAL_KV.get(key);
        return json({ success: true, content: content || null });
      }

      if (request.method === 'POST') {
        const body = await request.json();
        if (!body || !body.subdomain || String(body.subdomain).startsWith('vdb:')) {
          return json({ success: false, error: 'Missing subdomain' }, 400);
        }
        await env.SIGNAL_KV.put(String(body.subdomain), String(body.content || ''), { expirationTtl: 300 });
        return json({ success: true });
      }

      return json({ success: false, error: 'Method not allowed' }, 405);
    } catch (err) {
      return json({ success: false, error: err && err.message ? err.message : String(err) }, 500);
    }
  },
};
