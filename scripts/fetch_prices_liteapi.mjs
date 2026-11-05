// Fetch 2-night price estimates from LiteAPI (https://docs.liteapi.travel). Hotel list and rate
// search are free endpoints. Needs LITEAPI_KEY.
// Writes:
//   data/liteapi_ids.json     hotel id -> { liteId | null, name, km, checked }
//   public/data/prices.json   { updated, source, nights, checkins[], totals: {id: {checkin: usd2Nights}}, heat: {} }
// Env: LITEAPI_KEY, MAX_CALLS (default 3000), WEEKS (default 12), NIGHTS (default 2), BATCH (default 50),
//      DELAY_MS (default 300), RETRY_UNMATCHED_DAYS (default 30), PROBE=1 (one hotel, print responses)
import fs from 'node:fs';

const BASE = 'https://api.liteapi.travel/v3.0';
const KEY = process.env.LITEAPI_KEY;
const MAX_CALLS = +(process.env.MAX_CALLS ?? 3000);
const WEEKS = +(process.env.WEEKS ?? 12);
const NIGHTS = +(process.env.NIGHTS ?? 2);
const BATCH = +(process.env.BATCH ?? 50);
const DELAY_MS = +(process.env.DELAY_MS ?? 300);
const RETRY_DAYS = +(process.env.RETRY_UNMATCHED_DAYS ?? 30);
const IDS_FILE = 'data/liteapi_ids.json';
const PRICES_FILE = 'public/data/prices.json';

if (!KEY) {
  console.error('LITEAPI_KEY is not set.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const today = iso(new Date());

let calls = 0, failures = 0;
const samples = [];
async function api(method, path, { query, body } = {}) {
  if (calls >= MAX_CALLS) throw new Error('budget');
  calls++;
  if (calls % 50 === 0) console.log(`  … ${calls} calls`);
  const url = `${BASE}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let status = 0, text = '';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'X-API-Key': KEY, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      status = res.status;
      text = await res.text();
      await sleep(DELAY_MS);
      if (status === 429 || status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${status}`);
      return JSON.parse(text);
    } catch (e) {
      if (attempt === 2 || (status >= 400 && status < 500 && status !== 429)) {
        failures++;
        if (samples.length < 5) samples.push(`${method} ${path} ${status} ${e.message} :: ${text.slice(0, 300)}`);
        return null;
      }
      await sleep(2000 * (attempt + 1));
    }
  }
  return null;
}

const STOP = /\b(by ihg|a leading hotel of the world|hotel|hotels|the|resort|resorts|and|spa|a|of|by|collection|autograph|luxury|&)\b/g;
const norm = (s) =>
  (s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();
function similarity(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  return [...A].filter((w) => B.has(w)).length / Math.min(A.size, B.size);
}
function km(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
/** Best LiteAPI hotel near our coordinates: name overlap, nudged by closeness. */
function bestMatch(h, cands) {
  let best = null, score = 0;
  for (const c of cands ?? []) {
    const d = km(h.lat, h.lng, +c.latitude, +c.longitude);
    const s = similarity(h.name, c.name) + (d < 0.3 ? 0.15 : d < 1 ? 0.05 : -0.1);
    if (s > score) { score = s; best = { ...c, d }; }
  }
  return score >= 0.6 ? best : null;
}

function checkinDates() {
  const out = [];
  const start = addDays(new Date(today), 1);
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = addDays(start, i);
    if (d.getUTCDay() === 4 || d.getUTCDay() === 0) out.push(iso(d));
  }
  return out;
}

/** Cheapest whole-stay total for each hotel in a /hotels/rates response. */
function cheapestTotals(resp) {
  const out = {};
  for (const h of resp?.data ?? []) {
    let min = Infinity;
    for (const rt of h.roomTypes ?? []) {
      let amt = rt.offerRetailRate?.amount;
      if (amt == null) {
        const per = (rt.rates ?? []).map((r) => r.retailRate?.total?.[0]?.amount).filter((x) => x != null);
        if (per.length) amt = Math.min(...per);
      }
      if (amt != null && +amt > 0) min = Math.min(min, +amt);
    }
    if (min < Infinity) out[h.hotelId] = Math.round(min);
  }
  return out;
}

const { hotels } = readJson('public/data/hotels.json', { hotels: [] });
const ids = readJson(IDS_FILE, {});
const prices = readJson(PRICES_FILE, {});
const checkins = checkinDates();

const rateBody = (liteIds, ci) => ({
  hotelIds: liteIds,
  checkin: ci,
  checkout: iso(addDays(new Date(ci), NIGHTS)),
  occupancies: [{ adults: 2 }],
  currency: 'USD',
  guestNationality: 'US',
  timeout: 12,
  maxRatesPerHotel: 1,
});

if (process.env.PROBE) {
  const h = hotels.find((x) => /Kimpton Gray/.test(x.name)) ?? hotels[0];
  const list = await api('GET', '/data/hotels', { query: { latitude: h.lat, longitude: h.lng, radius: 1000, limit: 30 } });
  console.log('list', (list?.data ?? []).slice(0, 8).map((c) => `${c.id} ${c.name}`));
  const m = bestMatch(h, list?.data);
  console.log('match', h.name, '->', m?.id, m?.name, m?.d?.toFixed(2), 'km');
  if (m) {
    const r = await api('POST', '/hotels/rates', { body: rateBody([m.id], checkins[2]) });
    console.log('rates', JSON.stringify(r)?.slice(0, 700));
    console.log('cheapest', cheapestTotals(r));
  }
  console.log('failures', samples);
  process.exit(0);
}

function save() {
  const out = {
    updated: new Date().toISOString(),
    source: 'LiteAPI',
    nights: NIGHTS,
    checkins,
    totals: prices.totals ?? {},
    heat: prices.heat ?? {},
  };
  for (const t of Object.values(out.totals)) for (const d of Object.keys(t)) if (d < today) delete t[d];
  fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 1));
  fs.writeFileSync(PRICES_FILE, JSON.stringify(out));
}

prices.totals ??= {};
const retryBefore = iso(addDays(new Date(today), -RETRY_DAYS));
try {
  // 1. Match each hotel to a LiteAPI id by coordinates + name (free endpoint).
  const toMatch = hotels.filter((h) => !ids[h.id] || (!ids[h.id].liteId && ids[h.id].checked < retryBefore));
  console.log(`Matching ${toMatch.length} hotels to LiteAPI…`);
  let n = 0;
  for (const h of toMatch) {
    const list = await api('GET', '/data/hotels', { query: { latitude: h.lat, longitude: h.lng, radius: 1500, limit: 60 } });
    if (!list) continue; // network/API failure: try again next run
    const m = bestMatch(h, list.data);
    ids[h.id] = { liteId: m?.id ?? null, name: m?.name ?? null, km: m ? +m.d.toFixed(2) : null, checked: today };
    if (++n % 100 === 0) save();
  }

  // 2. Rates: one request per batch of hotels per check-in date.
  const pairs = hotels.filter((h) => ids[h.id]?.liteId).map((h) => [h.id, ids[h.id].liteId]);
  console.log(`Pricing ${pairs.length} hotels × ${checkins.length} dates in batches of ${BATCH}…`);
  for (const ci of checkins) {
    for (let i = 0; i < pairs.length; i += BATCH) {
      const batch = pairs.slice(i, i + BATCH);
      const r = await api('POST', '/hotels/rates', { body: rateBody(batch.map(([, l]) => l), ci) });
      if (!r) continue;
      const got = cheapestTotals(r);
      for (const [id, lite] of batch) {
        const t = (prices.totals[id] ??= {});
        if (got[lite] != null) t[ci] = got[lite];
        else delete t[ci];
      }
    }
    save();
    console.log(`  priced ${ci}`);
  }
} catch (e) {
  if (e.message !== 'budget') throw e;
  console.log(`Stopped at call budget (${MAX_CALLS}).`);
}

save();
const matched = Object.values(ids).filter((v) => v.liteId).length;
const priced = Object.values(prices.totals).filter((t) => Object.keys(t).length).length;
console.log(`${calls} API calls · ${failures} failed · ${matched}/${hotels.length} hotels matched · ${priced} with prices`);
if (samples.length) console.log('Sample failures:\n' + samples.join('\n'));
if (calls > 20 && failures / calls > 0.9) {
  console.error('Almost every API call failed; see the samples above.');
  process.exit(1);
}
