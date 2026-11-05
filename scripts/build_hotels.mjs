// Build public/data/hotels.json: hotels + select-brand tag + nearest airports + United / ORD nonstop flags.
// Route data: https://github.com/Jonty/airline-route-data (downloaded at build time, cached in .cache/).
import fs from 'node:fs';
import { brandFor } from './brands.mjs';

const ROUTES_URL = 'https://raw.githubusercontent.com/Jonty/airline-route-data/main/airline_routes.json';
const CACHE = '.cache/airline_routes.json';
const HOME = process.env.HOME_AIRPORT || 'ORD';
const CARRIER = 'UA';
const RADIUS_KM = 80;

async function loadRoutes() {
  const local = process.env.ROUTES_FILE || CACHE;
  if (fs.existsSync(local) && !process.env.REFRESH_ROUTES) return JSON.parse(fs.readFileSync(local, 'utf8'));
  console.log('Downloading route data…');
  const res = await fetch(ROUTES_URL);
  if (!res.ok) throw new Error(`Route download failed: ${res.status}`);
  const text = await res.text();
  fs.mkdirSync('.cache', { recursive: true });
  fs.writeFileSync(CACHE, text);
  return JSON.parse(text);
}

function km(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const hotels = JSON.parse(fs.readFileSync('data/edit_hotels.source.json', 'utf8'));
const overrides = JSON.parse(fs.readFileSync('data/brand_overrides.json', 'utf8')).overrides ?? {};
const routes = await loadRoutes();

// Airports with passenger service, and which of them United serves.
const uaServed = new Set();
for (const [code, ap] of Object.entries(routes)) {
  for (const r of ap.routes ?? []) {
    if (r.carriers?.some((c) => c.iata === CARRIER)) {
      uaServed.add(code);
      uaServed.add(r.iata);
    }
  }
}
const homeNonstop = new Map();
for (const r of routes[HOME]?.routes ?? []) {
  if (r.carriers?.some((c) => c.iata === CARRIER)) homeNonstop.set(r.iata, r.min);
}
const airports = Object.entries(routes)
  .filter(([, ap]) => (ap.routes ?? []).length > 0)
  .map(([code, ap]) => ({ code, lat: +ap.latitude, lng: +ap.longitude, n: ap.routes.length, city: ap.city_name }));

let nUA = 0, nHome = 0, nSel = 0;
const out = hotels.map((h) => {
  const brand = h.id in overrides ? overrides[h.id] : brandFor(h.name);
  const near = airports
    .map((a) => ({ ...a, d: km(h.lat, h.lng, a.lat, a.lng) }))
    .filter((a) => a.d <= RADIUS_KM)
    .sort((a, b) => a.d - b.d);
  const ua = near.find((a) => uaServed.has(a.code));
  const nonstop = near.find((a) => homeNonstop.has(a.code));
  const isHome = near.some((a) => a.code === HOME && a.d <= 60);
  if (brand) nSel++;
  if (ua) nUA++;
  if (nonstop) nHome++;
  return {
    ...h,
    selectBrand: brand,
    airports: near.slice(0, 3).map((a) => ({ code: a.code, km: Math.round(a.d) })),
    united: ua ? { code: ua.code, km: Math.round(ua.d) } : null,
    homeNonstop: nonstop ? { code: nonstop.code, km: Math.round(nonstop.d), min: homeNonstop.get(nonstop.code) } : null,
    nearHome: isHome,
  };
});

fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync(
  'public/data/hotels.json',
  JSON.stringify({ built: new Date().toISOString(), homeAirport: HOME, hotels: out }),
);
console.log(`${out.length} hotels · ${nSel} select-brand · ${nUA} near a United airport · ${nHome} with ${CARRIER} nonstop from ${HOME}`);
