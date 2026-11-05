export const EDIT_CREDIT = 250;
export const SELECT_CREDIT = 250;

export interface Hotel {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postal: string;
  lat: number;
  lng: number;
  stars: number | null;
  collection: string;
  taRating: number | null;
  taReviews: number | null;
  image: string | null;
  selectBrand: string | null;
  airports: { code: string; km: number }[];
  united: { code: string; km: number } | null;
  homeNonstop: { code: string; km: number; min: number } | null;
  nearHome: boolean;
}

export interface HotelsFile {
  built: string;
  homeAirport: string;
  hotels: Hotel[];
}

export interface PricesFile {
  updated: string | null;
  nights: number;
  checkins: string[];
  totals: Record<string, Record<string, number>>;
  heat: Record<string, { cheap: string[]; high: string[] }>;
  keys?: Record<string, string>;
}

export interface Settings {
  editCredit: boolean;
  selectCredit: boolean;
}

export interface Filters {
  query: string;
  collection: string;
  selectOnly: boolean;
  unitedOnly: boolean;
  nonstopOnly: boolean;
  maxNet: number | null;
}

/** Manual Chase prices the user typed in: key `${hotelId}|${checkin}` -> 2-night total in USD. */
export type ManualPrices = Record<string, number>;

export interface Priced {
  hotel: Hotel;
  checkin: string | null;
  total: number | null;
  source: 'manual' | 'estimate' | null;
  credits: number;
  net: number | null;
}

export function creditsFor(hotel: Hotel, s: Settings): number {
  return (s.editCredit ? EDIT_CREDIT : 0) + (s.selectCredit && hotel.selectBrand ? SELECT_CREDIT : 0);
}

export function netPrice(total: number, credits: number): number {
  return Math.max(0, total - credits);
}

/** Price for one hotel on one check-in date, or the cheapest date when checkin is null. */
export function priceHotel(
  hotel: Hotel,
  checkin: string | null,
  prices: PricesFile | null,
  manual: ManualPrices,
  s: Settings,
): Priced {
  const credits = creditsFor(hotel, s);
  const dates = checkin ? [checkin] : allDates(hotel.id, prices, manual);
  let best: Priced = { hotel, checkin, total: null, source: null, credits, net: null };
  for (const d of dates) {
    const m = manual[`${hotel.id}|${d}`];
    const e = prices?.totals[hotel.id]?.[d];
    const total = m ?? e;
    if (total == null) continue;
    if (best.total == null || total < best.total) {
      best = { hotel, checkin: d, total, source: m != null ? 'manual' : 'estimate', credits, net: netPrice(total, credits) };
    }
  }
  return best;
}

function allDates(id: string, prices: PricesFile | null, manual: ManualPrices): string[] {
  const set = new Set(Object.keys(prices?.totals[id] ?? {}));
  for (const k of Object.keys(manual)) {
    const [hid, d] = k.split('|');
    if (hid === id) set.add(d);
  }
  return [...set];
}

const countryNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

export function countryName(code: string): string {
  try {
    return (code && countryNames?.of(code)) || code;
  } catch {
    return code;
  }
}

export function matchesQuery(h: Hotel, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const hay = `${h.name} ${h.city} ${h.state} ${h.country} ${countryName(h.country)} ${h.selectBrand ?? ''}`.toLowerCase();
  return t.split(/\s+/).every((w) => hay.includes(w));
}

export function applyFilters(rows: Priced[], f: Filters): Priced[] {
  return rows.filter(({ hotel: h, net }) => {
    if (!matchesQuery(h, f.query)) return false;
    if (f.collection && !h.collection.includes(f.collection)) return false;
    if (f.selectOnly && !h.selectBrand) return false;
    if (f.unitedOnly && !h.united) return false;
    if (f.nonstopOnly && !h.homeNonstop && !h.nearHome) return false;
    if (f.maxNet != null && (net == null || net > f.maxNet)) return false;
    return true;
  });
}

/** Cheapest net first; unpriced hotels after, alphabetically. Ties: more credits first. */
export function rank(rows: Priced[]): Priced[] {
  return [...rows].sort((a, b) => {
    if (a.net == null && b.net == null) return a.hotel.name.localeCompare(b.hotel.name);
    if (a.net == null) return 1;
    if (b.net == null) return -1;
    return a.net - b.net || b.credits - a.credits || (a.total ?? 0) - (b.total ?? 0);
  });
}

export function priceColor(net: number | null): string {
  if (net == null) return 'var(--unpriced)';
  if (net <= 100) return '#1a9e5c';
  if (net <= 250) return '#7cb342';
  if (net <= 500) return '#f2a51a';
  if (net <= 900) return '#e8682c';
  return '#c62f3c';
}

/** Heat weight: cheap net prices glow brightest. */
export function heatWeight(net: number | null): number {
  if (net == null) return 0.12;
  return Math.min(1, Math.max(0.08, 1 - net / 800));
}

export const usd = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function fmtDate(d: string): string {
  const dt = new Date(`${d}T12:00:00Z`);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function addDays(d: string, n: number): string {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Every Thursday and Sunday over the next `weeks` weeks (fallback when no price file). */
export function defaultCheckins(today: string, weeks = 12): string[] {
  const out: string[] = [];
  for (let i = 1; i <= weeks * 7; i++) {
    const d = addDays(today, i);
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd === 4 || wd === 0) out.push(d);
  }
  return out;
}

// ---------- City list grouped by continent ----------

export const CONTINENTS = [
  'North America',
  'Caribbean & Central America',
  'South America',
  'Europe',
  'Middle East',
  'Africa',
  'Asia',
  'Oceania',
] as const;
export type Continent = (typeof CONTINENTS)[number] | 'Other';

const CONTINENT_CODES: Record<Exclude<Continent, 'Other'>, string> = {
  'North America': 'US CA MX',
  'Caribbean & Central America': 'AG AI AW BB BL BM BS BZ CR CU CW DM DO GD GT HN JM KN KY LC MF NI PA PR SV SX TC TT VC VG VI',
  'South America': 'AR BO BR CL CO EC PE PY UY VE',
  Europe: 'AD AL AT BA BE BG CH CY CZ DE DK EE ES FI FR GB GR HR HU IE IS IT LI LT LU LV MC ME MK MT NL NO PL PT RO RS SE SI SK SM TR',
  'Middle East': 'AE BH IL JO KW LB OM QA SA',
  Africa: 'BW EG KE MA MU MZ NA RW SC TN TZ ZA ZM ZW',
  Asia: 'AZ BT CN GE HK ID IN JP KH KR LA LK MM MN MO MV MY NP PH SG TH TW UZ VN',
  Oceania: 'AU CK FJ NZ PF WS',
};
const continentByCode: Record<string, Continent> = {};
for (const [c, codes] of Object.entries(CONTINENT_CODES)) for (const code of codes.split(' ')) continentByCode[code] = c as Continent;

export function continentOf(country: string): Continent {
  return continentByCode[country] ?? 'Other';
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// Local spellings and suffixed variants that the Chase list uses for the same place.
const CITY_ALIASES: Record<string, string> = {
  roma: 'Rome',
  milano: 'Milan',
  firenze: 'Florence',
  venezia: 'Venice',
  napoli: 'Naples',
  lisboa: 'Lisbon',
  sevilla: 'Seville',
  warszawa: 'Warsaw',
  praha: 'Prague',
  wien: 'Vienna',
  munchen: 'Munich',
  frankfurtammain: 'Frankfurt',
  newyorkcity: 'New York',
  washingtondc: 'Washington',
  cartagenadeindias: 'Cartagena',
  panama: 'Panama City',
  parosisland: 'Paros',
  ibizatown: 'Ibiza',
  solidaridad: 'Playa del Carmen',
  solidaridadplayadelcarmen: 'Playa del Carmen',
};

/** Clean a Chase city string: drop ", Region" and "(XX)" suffixes, postal district numbers and local spellings. */
export function cleanCity(raw: string): string {
  let c = raw.trim().replace(/\s*\(.*?\)\s*/g, ' ').split(',')[0].replace(/\s+\d+$/, '').trim();
  if (!c) c = raw.trim();
  const alias = CITY_ALIASES[fold(c)];
  if (alias) return alias;
  // "seoul" -> "Seoul", "Québec city" -> "Québec City"
  return c.replace(/(^|[\s-])(\p{Ll})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export interface CityGroup {
  key: string;
  city: string;
  state: string;
  country: string;
  continent: Continent;
  rows: Priced[];
  selectCount: number;
  nonstop: string | null;
  nearHome: boolean;
  cheapest: number | null;
}

export interface CountryGroup {
  country: string;
  name: string;
  cities: CityGroup[];
  hotels: number;
}

export interface ContinentGroup {
  continent: Continent;
  countries: CountryGroup[];
  cities: number;
  hotels: number;
}

export type CitySort = 'name' | 'cheapest' | 'hotels';

export function cityKeyOf(h: Hotel): string {
  const city = cleanCity(h.city);
  return `${h.country}|${h.country === 'US' ? h.state : ''}|${fold(city)}`;
}

/** Group (already filtered and ranked) rows into continent > country > city. */
export function groupByCity(rows: Priced[], sort: CitySort = 'name'): ContinentGroup[] {
  const cities = new Map<string, CityGroup>();
  for (const r of rows) {
    const h = r.hotel;
    const key = cityKeyOf(h);
    let g = cities.get(key);
    if (!g) {
      g = {
        key, city: cleanCity(h.city), state: h.country === 'US' ? h.state : '', country: h.country,
        continent: continentOf(h.country), rows: [], selectCount: 0, nonstop: null, nearHome: false, cheapest: null,
      };
      cities.set(key, g);
    }
    g.rows.push(r);
    if (h.selectBrand) g.selectCount++;
    if (h.nearHome) g.nearHome = true;
    if (h.homeNonstop && !g.nonstop) g.nonstop = h.homeNonstop.code;
    if (r.net != null && (g.cheapest == null || r.net < g.cheapest)) g.cheapest = r.net;
  }

  const cmpCity = (a: CityGroup, b: CityGroup) => {
    if (sort === 'cheapest') {
      if (a.cheapest != null || b.cheapest != null) {
        if (a.cheapest == null) return 1;
        if (b.cheapest == null) return -1;
        if (a.cheapest !== b.cheapest) return a.cheapest - b.cheapest;
      }
    } else if (sort === 'hotels' && a.rows.length !== b.rows.length) {
      return b.rows.length - a.rows.length;
    }
    return a.city.localeCompare(b.city) || a.state.localeCompare(b.state);
  };

  const byContinent = new Map<Continent, Map<string, CityGroup[]>>();
  for (const g of cities.values()) {
    let m = byContinent.get(g.continent);
    if (!m) byContinent.set(g.continent, (m = new Map()));
    const list = m.get(g.country) ?? [];
    list.push(g);
    m.set(g.country, list);
  }

  const order: Continent[] = [...CONTINENTS, 'Other'];
  return order
    .filter((c) => byContinent.has(c))
    .map((continent) => {
      const countries = [...byContinent.get(continent)!.entries()]
        .map(([country, list]) => ({
          country,
          name: countryName(country),
          cities: list.sort(cmpCity),
          hotels: list.reduce((n, c) => n + c.rows.length, 0),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        continent,
        countries,
        cities: countries.reduce((n, c) => n + c.cities.length, 0),
        hotels: countries.reduce((n, c) => n + c.hotels, 0),
      };
    });
}
