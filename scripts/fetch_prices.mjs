// Fetch public price estimates from Xotelo (https://xotelo.com, free, TripAdvisor-based).
// Writes:
//   data/tripadvisor_keys.json   hotel id -> TripAdvisor hotel_key (or null when no match)
//   public/data/prices.json      { updated, checkins[], totals: {id: {checkin: usd2Nights}}, heat: {id: {cheap[], high[]}} }
// Env: MAX_CALLS (default 3000), DELAY_MS (default 700), WEEKS (default 12), NIGHTS (default 2)
// Chase Travel's own prepaid rate is usually a bit different: these are estimates.
import fs from 'node:fs';

const API = 'https://data.xotelo.com/api';
const MAX_CALLS = +(process.env.MAX_CALLS ?? 3000);
const DELAY_MS = +(process.env.DELAY_MS ?? 700);
const WEEKS = +(process.env.WEEKS ?? 12);
const NIGHTS = +(process.env.NIGHTS ?? 2);
const KEYS_FILE = 'data/tripadvisor_keys.json';
const PRICES_FILE = 'public/data/prices.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

let calls = 0;
async function api(path, params) {
  if (calls >= MAX_CALLS) throw new Error('budget');
  calls++;
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'sapphire-edit-finder/1.0' } });
      if (res.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
      const body = await res.json();
      await sleep(DELAY_MS);
      if (body.error) return null;
      return body.result ?? null;
    } catch {
      await sleep(2000 * (attempt + 1));
    }
  }
  return null;
}

// Find every object carrying a hotel_key, wherever the response nests it.
function collectKeys(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (typeof node.hotel_key === 'string') acc.push(node);
  for (const v of Object.values(node)) collectKeys(v, acc);
  return acc;
}
const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(by ihg|hotel|the|resort|and|spa|a|of)\b/g, ' ').replace(/\s+/g, ' ').trim();
function similarity(a, b) {
  const A = new Set(norm(a).split(' ')), B = new Set(norm(b).split(' '));
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(1, Math.min(A.size, B.size));
}

// Check-in dates: every Thursday and Sunday for the next WEEKS weeks.
function checkinDates() {
  const out = [];
  const start = addDays(new Date(new Date().toISOString().slice(0, 10)), 1);
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = addDays(start, i);
    if (d.getUTCDay() === 4 || d.getUTCDay() === 0) out.push(iso(d));
  }
  return out;
}

const { hotels } = readJson('public/data/hotels.json', { hotels: [] });
const keys = readJson(KEYS_FILE, {});
const prices = readJson(PRICES_FILE, { updated: null, nights: NIGHTS, checkins: [], totals: {}, heat: {}, fetched: {} });
prices.fetched ??= {};
const checkins = checkinDates();
const today = iso(new Date());

try {
  // 1. Match hotels to TripAdvisor keys.
  for (const h of hotels) {
    if (h.id in keys) continue;
    const r = await api('search', { query: `${h.name} ${h.city}`.slice(0, 120) });
    const cands = collectKeys(r);
    let best = null, score = 0;
    for (const c of cands) {
      const s = similarity(h.name, c.name ?? c.hotel_name ?? '');
      if (s > score) { score = s; best = c; }
    }
    keys[h.id] = best && score >= 0.5 ? best.hotel_key : null;
  }

  // 2. Rates, stalest hotel first.
  const queue = hotels
    .filter((h) => keys[h.id])
    .sort((a, b) => (prices.fetched[a.id] ?? '').localeCompare(prices.fetched[b.id] ?? ''));
  for (const h of queue) {
    const key = keys[h.id];
    const totals = (prices.totals[h.id] ??= {});
    for (const ci of checkins) {
      const co = iso(addDays(new Date(ci), NIGHTS));
      const r = await api('rates', { hotel_key: key, chk_in: ci, chk_out: co, currency: 'USD' });
      const rates = (r?.rates ?? []).map((x) => (+x.rate || 0) + (+x.tax || 0)).filter((x) => x > 0);
      if (rates.length) totals[ci] = Math.round(Math.min(...rates) * NIGHTS);
      else delete totals[ci];
    }
    const hm = await api('heatmap', { hotel_key: key, chk_out: iso(addDays(new Date(checkins[0]), NIGHTS)) });
    const m = hm?.heatmap ?? hm;
    if (m) prices.heat[h.id] = { cheap: m.cheap_price_days ?? [], high: m.high_price_days ?? [] };
    prices.fetched[h.id] = today;
  }
} catch (e) {
  if (e.message !== 'budget') throw e;
  console.log(`Stopped at call budget (${MAX_CALLS}); the next run continues from the stalest hotels.`);
}

// Drop past dates.
for (const t of Object.values(prices.totals)) for (const d of Object.keys(t)) if (d < today) delete t[d];
prices.updated = new Date().toISOString();
prices.nights = NIGHTS;
prices.checkins = checkins;
fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 1));
prices.keys = Object.fromEntries(Object.entries(keys).filter(([, v]) => v));
fs.writeFileSync(PRICES_FILE, JSON.stringify(prices));
const matched = Object.values(keys).filter(Boolean).length;
const priced = Object.values(prices.totals).filter((t) => Object.keys(t).length).length;
console.log(`${calls} API calls · ${matched}/${hotels.length} hotels matched · ${priced} with prices`);
