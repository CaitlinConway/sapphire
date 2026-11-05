// Fetch public price estimates from Xotelo (https://xotelo.com, free, TripAdvisor-based).
// Writes:
//   data/tripadvisor_keys.json   hotel id -> { key: TripAdvisor hotel_key | null, checked: YYYY-MM-DD }
//   public/data/prices.json      { updated, checkins[], totals: {id: {checkin: usd2Nights}}, heat: {id: {cheap[], high[]}}, keys }
// Env: MAX_CALLS (default 3000), DELAY_MS (default 700), WEEKS (default 12), NIGHTS (default 2),
//      RETRY_UNMATCHED_DAYS (default 14), PROBE=1 (print a few raw responses and exit)
// Chase Travel's own prepaid rate is usually a bit different: these are estimates.
import fs from 'node:fs';

const API = 'https://data.xotelo.com/api';
const MAX_CALLS = +(process.env.MAX_CALLS ?? 3000);
const DELAY_MS = +(process.env.DELAY_MS ?? 700);
const WEEKS = +(process.env.WEEKS ?? 12);
const NIGHTS = +(process.env.NIGHTS ?? 2);
const RETRY_DAYS = +(process.env.RETRY_UNMATCHED_DAYS ?? 14);
const KEYS_FILE = 'data/tripadvisor_keys.json';
const PRICES_FILE = 'public/data/prices.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const today = iso(new Date());

let calls = 0;
let failures = 0;
const failureSamples = [];
async function api(path, params) {
  if (calls >= MAX_CALLS) throw new Error('budget');
  calls++;
  if (calls % 100 === 0) console.log(`  … ${calls} calls`);
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let status = 0, text = '';
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (sapphire-edit-finder)', Accept: 'application/json' },
      });
      status = res.status;
      text = await res.text();
      await sleep(DELAY_MS);
      if (status === 429 || status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
      const body = JSON.parse(text);
      if (body.error) throw new Error(`api error: ${JSON.stringify(body.error).slice(0, 200)}`);
      return body.result ?? null;
    } catch (e) {
      if (attempt === 2 || (status && status < 500 && status !== 429)) {
        failures++;
        if (failureSamples.length < 5) failureSamples.push(`${path} ${status} ${e.message} :: ${text.slice(0, 200)}`);
        return null;
      }
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
const STOP = /\b(by ihg|a leading hotel of the world|hotel|hotels|the|resort|resorts|and|spa|a|of|by|collection|autograph|luxury)\b/g;
const norm = (s) =>
  (s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();
export function similarity(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.min(A.size, B.size);
}
function bestMatch(h, cands) {
  let best = null, score = 0;
  for (const c of cands) {
    let s = similarity(h.name, c.name ?? '');
    const place = `${c.place_name ?? ''} ${c.short_place_name ?? ''} ${c.street_address ?? ''}`.toLowerCase();
    if (h.city && place.includes(h.city.toLowerCase())) s += 0.2;
    if (s > score) { score = s; best = c; }
  }
  return score >= 0.6 ? best : null;
}

// Check-in dates: every Thursday and Sunday for the next WEEKS weeks.
function checkinDates() {
  const out = [];
  const start = addDays(new Date(today), 1);
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = addDays(start, i);
    if (d.getUTCDay() === 4 || d.getUTCDay() === 0) out.push(iso(d));
  }
  return out;
}

const { hotels } = readJson('public/data/hotels.json', { hotels: [] });
// Older files stored a bare key or null; upgrade to { key, checked }.
const rawKeys = readJson(KEYS_FILE, {});
const keys = Object.fromEntries(
  Object.entries(rawKeys).map(([id, v]) => [id, v && typeof v === 'object' ? v : { key: v ?? null, checked: v ? today : '1970-01-01' }]),
);
const prices = readJson(PRICES_FILE, { updated: null, nights: NIGHTS, checkins: [], totals: {}, heat: {}, fetched: {} });
prices.fetched ??= {};
const checkins = checkinDates();

function save() {
  for (const t of Object.values(prices.totals)) for (const d of Object.keys(t)) if (d < today) delete t[d];
  prices.updated = new Date().toISOString();
  prices.nights = NIGHTS;
  prices.checkins = checkins;
  prices.keys = Object.fromEntries(Object.entries(keys).filter(([, v]) => v.key).map(([id, v]) => [id, v.key]));
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 1));
  fs.writeFileSync(PRICES_FILE, JSON.stringify(prices));
}

if (process.env.PROBE) {
  const h = hotels.find((x) => /Kimpton Gray/.test(x.name)) ?? hotels[0];
  const s = await api('search', { query: h.name });
  console.log('search', JSON.stringify(s)?.slice(0, 800));
  const k = bestMatch(h, collectKeys(s));
  console.log('match', h.name, '->', k?.name, k?.hotel_key);
  if (k) {
    const r = await api('rates', { hotel_key: k.hotel_key, chk_in: checkins[2], chk_out: iso(addDays(new Date(checkins[2]), NIGHTS)) });
    console.log('rates', JSON.stringify(r)?.slice(0, 800));
  }
  console.log('failures', failureSamples);
  process.exit(0);
}

const retryBefore = iso(addDays(new Date(today), -RETRY_DAYS));
let saved = 0;
try {
  // 1. Match hotels to TripAdvisor keys (new hotels, and unmatched ones every RETRY_DAYS).
  const toMatch = hotels.filter((h) => !keys[h.id] || (!keys[h.id].key && keys[h.id].checked < retryBefore));
  console.log(`Matching ${toMatch.length} hotels to TripAdvisor…`);
  for (const h of toMatch) {
    let m = bestMatch(h, collectKeys(await api('search', { query: h.name })));
    if (!m && h.city) m = bestMatch(h, collectKeys(await api('search', { query: `${h.name} ${h.city}` })));
    keys[h.id] = { key: m?.hotel_key ?? null, checked: today };
    if (calls - saved >= 200) { save(); saved = calls; }
  }

  // 2. Rates, stalest hotel first.
  const queue = hotels
    .filter((h) => keys[h.id]?.key)
    .sort((a, b) => (prices.fetched[a.id] ?? '').localeCompare(prices.fetched[b.id] ?? ''));
  console.log(`Fetching rates for up to ${queue.length} hotels × ${checkins.length} dates…`);
  for (const h of queue) {
    const key = keys[h.id].key;
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
    if (calls - saved >= 200) { save(); saved = calls; }
  }
} catch (e) {
  if (e.message !== 'budget') throw e;
  console.log(`Stopped at call budget (${MAX_CALLS}); the next run continues from here.`);
}

save();
const matched = Object.values(keys).filter((v) => v.key).length;
const priced = Object.values(prices.totals).filter((t) => Object.keys(t).length).length;
console.log(`${calls} API calls · ${failures} failed · ${matched}/${hotels.length} hotels matched · ${priced} with prices`);
if (failureSamples.length) console.log('Sample failures:\n' + failureSamples.join('\n'));
if (calls > 50 && failures / calls > 0.9) {
  console.error('Almost every API call failed; see the samples above.');
  process.exit(1);
}
