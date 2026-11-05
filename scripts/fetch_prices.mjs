// Fetch public price estimates from Xotelo (https://xotelo.com, free, TripAdvisor-based).
// Writes:
//   data/tripadvisor_keys.json   hotel id -> { key: TripAdvisor hotel_key | null, checked: YYYY-MM-DD }
//   public/data/prices.json      { updated, checkins[], totals: {id: {checkin: usd2Nights}}, heat: {id: {cheap[], high[]}}, keys }
// Env: MAX_CALLS (default 3000), DELAY_MS (default 700), WEEKS (default 12), NIGHTS (default 2),
//      RETRY_UNMATCHED_DAYS (default 14), PROBE=1 (print a few raw responses and exit)
// Chase Travel's own prepaid rate is usually a bit different: these are estimates.
import fs from 'node:fs';

const API = 'https://data.xotelo.com/api';
// /search is only served through RapidAPI. Set RAPIDAPI_KEY (a repo secret) to use it.
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'xotelo-hotel-prices.p.rapidapi.com';
const RAPID_ONLY = new Set(['search']);
const MAX_CALLS = +(process.env.MAX_CALLS ?? 8000);
const DELAY_MS = +(process.env.DELAY_MS ?? 700);
const WEEKS = +(process.env.WEEKS ?? 12);
const NIGHTS = +(process.env.NIGHTS ?? 2);
const RETRY_DAYS = +(process.env.RETRY_UNMATCHED_DAYS ?? 60);
// RapidAPI's free Xotelo plan is a hard 1,000 requests/month. Stay under it, tracked in data/rapidapi_usage.json.
const SEARCH_MONTHLY_LIMIT = +(process.env.SEARCH_MONTHLY_LIMIT ?? 950);
const USAGE_FILE = 'data/rapidapi_usage.json';
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
  const rapid = RAPID_ONLY.has(path);
  if (rapid && !RAPIDAPI_KEY) return null;
  const url = rapid
    ? `https://${RAPIDAPI_HOST}/api/${path}?${new URLSearchParams(params)}`
    : `${API}/${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let status = 0, text = '';
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (sapphire-edit-finder)',
          Accept: 'application/json',
          ...(rapid ? { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': RAPIDAPI_HOST } : {}),
        },
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
// Manual TripAdvisor matches: hotel id -> TripAdvisor URL or key (g123-d456). Always wins.
const manualKeys = readJson('data/tripadvisor_overrides.json', { overrides: {} }).overrides ?? {};
for (const [id, v] of Object.entries(manualKeys)) {
  const m = String(v).match(/g\d+-d\d+/);
  if (m) keys[id] = { key: m[0], checked: today, manual: true };
}
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
  // Query variants, to learn what the search endpoint accepts (4 searches max).
  let s = null;
  for (const q of ['Kimpton Gray Hotel', 'Kimpton Gray Chicago', 'Chicago']) {
    const r = await api('search', { query: q });
    console.log(`search "${q}"`, JSON.stringify(r)?.slice(0, 500));
    s ??= r;
  }
  const g = await api('search', { query: 'Chicago', location_type: 'geo' });
  console.log('search geo "Chicago"', JSON.stringify(g)?.slice(0, 500));
  const k = bestMatch(h, collectKeys(s));
  console.log('match', h.name, '->', k?.name, k?.hotel_key);
  if (k) {
    const r = await api('rates', { hotel_key: k.hotel_key, chk_in: checkins[2], chk_out: iso(addDays(new Date(checkins[2]), NIGHTS)) });
    console.log('rates', JSON.stringify(r)?.slice(0, 800));
  }
  // Endpoints that don't need a search: a known key from Xotelo's docs, and Chicago's location key.
  const r2 = await api('rates', { hotel_key: 'g297930-d305178', chk_in: checkins[2], chk_out: iso(addDays(new Date(checkins[2]), NIGHTS)) });
  console.log('rates(known key)', JSON.stringify(r2)?.slice(0, 600));
  const l = await api('list', { location_key: 'g35805', limit: '5' });
  console.log('list(Chicago)', JSON.stringify(l)?.slice(0, 600));
  const hm = await api('heatmap', { hotel_key: 'g297930-d305178', chk_out: iso(addDays(new Date(checkins[2]), NIGHTS)) });
  console.log('heatmap(known key)', JSON.stringify(hm)?.slice(0, 400));
  console.log('failures', failureSamples);
  process.exit(0);
}

const retryBefore = iso(addDays(new Date(today), -RETRY_DAYS));
let saved = 0;
try {
  // 1. Match hotels to TripAdvisor keys (new hotels, and unmatched ones every RETRY_DAYS).
  const month = today.slice(0, 7);
  const usage = readJson(USAGE_FILE, { month, searches: 0 });
  if (usage.month !== month) Object.assign(usage, { month, searches: 0 });
  const searchesLeft = Math.max(0, SEARCH_MONTHLY_LIMIT - usage.searches);
  // Priority: hotels with both credits, then United nonstop from home, then the rest.
  const prio = (h) => (h.selectBrand ? 0 : h.homeNonstop || h.nearHome ? 1 : 2);
  const toMatch = RAPIDAPI_KEY
    ? hotels
        .filter((h) => !keys[h.id] || (!keys[h.id].key && keys[h.id].checked < retryBefore))
        .sort((a, b) => prio(a) - prio(b))
        .slice(0, searchesLeft)
    : [];
  if (RAPIDAPI_KEY) console.log(`RapidAPI searches used in ${month}: ${usage.searches}/${SEARCH_MONTHLY_LIMIT}`);
  if (!RAPIDAPI_KEY) console.log('No RAPIDAPI_KEY: skipping hotel matching; only hotels with known TripAdvisor keys get prices.');
  console.log(`Matching ${toMatch.length} hotels to TripAdvisor…`);
  let consecutiveMisses = 0;
  for (const h of toMatch) {
    // One search per hotel to conserve the monthly quota.
    const before = calls;
    const res = await api('search', { query: h.name });
    const m = bestMatch(h, collectKeys(res));
    consecutiveMisses = res ? 0 : consecutiveMisses + 1;
    usage.searches += calls - before;
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 1));
    if (consecutiveMisses >= 15) {
      console.log('15 searches in a row returned nothing; stopping matching to save the monthly quota.');
      break;
    }
    keys[h.id] = { key: m?.hotel_key ?? null, checked: today };
    if (calls - saved >= 200) { save(); saved = calls; }
  }

  // 2. Rates. Breadth first: hotels with no prices yet get a quick pass (heatmap + the next
  //    QUICK_DATES check-ins) so the whole map fills fast; then the stalest hotels get every date.
  const QUICK_DATES = +(process.env.QUICK_DATES ?? 4);
  async function fetchHotel(h, dates) {
    const key = keys[h.id].key;
    const totals = (prices.totals[h.id] ??= {});
    const hm = await api('heatmap', { hotel_key: key, chk_out: iso(addDays(new Date(checkins[0]), NIGHTS)) });
    const m = hm?.heatmap ?? hm;
    if (m) prices.heat[h.id] = { cheap: m.cheap_price_days ?? [], high: m.high_price_days ?? [] };
    for (const ci of dates) {
      const co = iso(addDays(new Date(ci), NIGHTS));
      const r = await api('rates', { hotel_key: key, chk_in: ci, chk_out: co, currency: 'USD' });
      const rates = (r?.rates ?? []).map((x) => (+x.rate || 0) + (+x.tax || 0)).filter((x) => x > 0);
      if (rates.length) totals[ci] = Math.round(Math.min(...rates) * NIGHTS);
      else delete totals[ci];
    }
    if (calls - saved >= 200) { save(); saved = calls; }
  }
  const withKey = hotels.filter((h) => keys[h.id]?.key);
  const fresh = withKey.filter((h) => !prices.fetched[h.id]);
  console.log(`Quick pass: ${fresh.length} new hotels × ${QUICK_DATES} dates…`);
  for (const h of fresh) {
    await fetchHotel(h, checkins.slice(0, QUICK_DATES));
    prices.fetched[h.id] = '0000-quick';
  }
  const queue = withKey.sort((a, b) => (prices.fetched[a.id] ?? '').localeCompare(prices.fetched[b.id] ?? ''));
  console.log(`Full pass: up to ${queue.length} hotels × ${checkins.length} dates…`);
  for (const h of queue) {
    await fetchHotel(h, checkins);
    prices.fetched[h.id] = today;
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
