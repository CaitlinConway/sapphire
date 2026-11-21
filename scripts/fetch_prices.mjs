// Fetch public price estimates from Xotelo (https://xotelo.com, free, TripAdvisor-based).
// Xotelo prices a hotel by its TripAdvisor key (g123-d456). Its own search is broken, so keys
// come from data/tripadvisor_overrides.json (hotel id -> TripAdvisor URL or key), filled by hand.
// Writes:
//   data/tripadvisor_keys.json   hotel id -> { key, checked, manual }
//   public/data/prices.json      { updated, checkins[], totals: {id: {checkin: usd2Nights}}, heat: {id: {cheap[], high[]}}, keys }
// Env: MAX_CALLS (default 8000), DELAY_MS (default 700), WEEKS (default 12), NIGHTS (default 2),
//      QUICK_DATES (default 4), CONCURRENCY (default 4), PROBE=1 (price one hotel, print the raw responses and exit)
// Chase Travel's own prepaid rate is usually a bit different: these are estimates.
import fs from 'node:fs';

const API = 'https://data.xotelo.com/api';
const MAX_CALLS = +(process.env.MAX_CALLS ?? 8000);
const DELAY_MS = +(process.env.DELAY_MS ?? 700);
const WEEKS = +(process.env.WEEKS ?? 12);
const NIGHTS = +(process.env.NIGHTS ?? 2);
const QUICK_DATES = +(process.env.QUICK_DATES ?? 4);
// Xotelo answers in ~2s, so price several hotels at once.
const CONCURRENCY = +(process.env.CONCURRENCY ?? 4);
const KEYS_FILE = 'data/tripadvisor_keys.json';
const OVERRIDES_FILE = 'data/tripadvisor_overrides.json';
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
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (sapphire-edit-finder)', Accept: 'application/json' } });
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
const keys = {};
for (const [id, v] of Object.entries(readJson(KEYS_FILE, {}))) if (v?.key) keys[id] = v;
for (const [id, v] of Object.entries(readJson(OVERRIDES_FILE, { overrides: {} }).overrides ?? {})) {
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
  prices.keys = Object.fromEntries(Object.entries(keys).map(([id, v]) => [id, v.key]));
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 1));
  fs.writeFileSync(PRICES_FILE, JSON.stringify(prices));
}

if (process.env.PROBE) {
  const h = hotels.find((x) => keys[x.id]) ?? null;
  if (!h) { console.log('No hotel has a TripAdvisor key yet.'); process.exit(1); }
  const ci = checkins[2], co = iso(addDays(new Date(checkins[2]), NIGHTS));
  console.log('probe', h.name, keys[h.id].key, ci, co);
  console.log('rates', JSON.stringify(await api('rates', { hotel_key: keys[h.id].key, chk_in: ci, chk_out: co, currency: 'USD' }))?.slice(0, 600));
  console.log('heatmap', JSON.stringify(await api('heatmap', { hotel_key: keys[h.id].key, chk_out: co }))?.slice(0, 300));
  console.log('failures', failureSamples);
  process.exit(failures ? 1 : 0);
}

let saved = 0;
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

// Run fn over items with up to CONCURRENCY in flight; a budget stop ends the whole pool.
async function pool(items, fn) {
  let i = 0, stop = null;
  const worker = async () => {
    while (!stop && i < items.length) {
      const item = items[i++];
      try { await fn(item); } catch (e) { stop = e; }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (stop) throw stop;
}

try {
  // Breadth first: hotels with no prices yet get a quick pass (heatmap + the next QUICK_DATES
  // check-ins) so the map fills fast; then the stalest hotels get every date.
  const withKey = hotels.filter((h) => keys[h.id]);
  console.log(`${withKey.length}/${hotels.length} hotels have a TripAdvisor key.`);
  const fresh = withKey.filter((h) => !prices.fetched[h.id]);
  console.log(`Quick pass: ${fresh.length} new hotels × ${QUICK_DATES} dates…`);
  await pool(fresh, async (h) => {
    await fetchHotel(h, checkins.slice(0, QUICK_DATES));
    prices.fetched[h.id] = '0000-quick';
  });
  const queue = withKey.sort((a, b) => (prices.fetched[a.id] ?? '').localeCompare(prices.fetched[b.id] ?? ''));
  console.log(`Full pass: up to ${queue.length} hotels × ${checkins.length} dates…`);
  await pool(queue, async (h) => {
    await fetchHotel(h, checkins);
    prices.fetched[h.id] = today;
  });
} catch (e) {
  if (e.message !== 'budget') throw e;
  console.log(`Stopped at call budget (${MAX_CALLS}); the next run continues from here.`);
}

save();
const priced = Object.values(prices.totals).filter((t) => Object.keys(t).length).length;
console.log(`${calls} API calls · ${failures} failed · ${Object.keys(keys).length} hotels with keys · ${priced} with prices`);
if (failureSamples.length) console.log('Sample failures:\n' + failureSamples.join('\n'));
if (calls > 50 && failures / calls > 0.9) {
  console.error('Almost every API call failed; see the samples above.');
  process.exit(1);
}
