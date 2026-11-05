// Find a hotel's TripAdvisor key (g123-d456) with a free web search: DuckDuckGo's HTML page,
// then Bing as a fallback. Only the "d" number matters to Xotelo's /rates.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const RE = /Hotel_Review-g(\d+)-d(\d+)-Reviews-(?:or\d+-)?([A-Za-z0-9_%\-]+?)(?:-[A-Z][A-Za-z_]+)?\.html/g;

const STOP = /\b(by ihg|a leading hotel of the world|hotel|hotels|the|resort|resorts|and|spa|a|of|by|collection|autograph|luxury|member|design)\b/g;
const norm = (s) =>
  decodeURIComponent(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(STOP, ' ')
    .replace(/\s+/g, ' ')
    .trim();
function overlap(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  return [...A].filter((w) => B.has(w)).length / A.size;
}

function candidates(html) {
  // Result links may be URL-encoded inside redirect wrappers; decode a couple of times.
  let text = html;
  for (let i = 0; i < 2; i++) {
    try { text += ' ' + decodeURIComponent(text.replace(/\+/g, ' ')); } catch { /* keep going */ }
  }
  // Bing wraps result links as bing.com/ck/a?...&u=a1<base64url>.
  for (const m of html.matchAll(/[?&;]u=a1([A-Za-z0-9_\-]+)/g)) {
    try { text += ' ' + Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { /* ignore */ }
  }
  const out = new Map();
  for (const m of text.matchAll(RE)) {
    const key = `g${m[1]}-d${m[2]}`;
    if (!out.has(key)) out.set(key, m[3].replace(/_/g, ' '));
  }
  return [...out].map(([key, slug]) => ({ key, slug }));
}

async function get(url, init = {}) {
  try {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(init.headers ?? {}) } });
    return { status: res.status, html: res.ok ? await res.text() : '' };
  } catch (e) {
    return { status: 0, html: '', error: e.message };
  }
}

export async function searchEngines(query) {
  const ddg = await get('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query }).toString(),
  });
  let c = candidates(ddg.html);
  let engine = 'ddg';
  if (!c.length) {
    const bing = await get(`https://www.bing.com/search?${new URLSearchParams({ q: query, setlang: 'en' })}`);
    c = candidates(bing.html);
    engine = `bing(${bing.status})`;
  }
  if (!c.length) {
    const brave = await get(`https://search.brave.com/search?${new URLSearchParams({ q: query })}`);
    c = candidates(brave.html);
    engine += ` brave(${brave.status})`;
  }
  return { engine: `${engine} ddg=${ddg.status}`, candidates: c };
}

/** Returns { key, slug, score, engine } or null. */
export async function findTripadvisorKey(h) {
  const { engine, candidates: c } = await searchEngines(`tripadvisor ${h.name} ${h.city} hotel review`);
  let best = null;
  for (const x of c) {
    const score = overlap(h.name, x.slug);
    if (!best || score > best.score) best = { ...x, score, engine };
  }
  return best && best.score >= 0.5 ? best : best ? { ...best, key: null } : { key: null, engine, score: 0 };
}
