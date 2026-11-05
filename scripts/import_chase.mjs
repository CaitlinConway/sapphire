// Convert a raw Chase Travel "The Edit" JSON capture ({"h":[...]}) into data/edit_hotels.source.json.
// Usage: node scripts/import_chase.mjs path/to/chase_capture.json
import fs from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/import_chase.mjs <chase_capture.json>');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const list = raw.h ?? raw;
const hotels = list.map((x) => {
  const c = x.cnt ?? {};
  const a = c.adr ?? {};
  return {
    id: String(x.id),
    name: x.n,
    address: a.l1 ?? '',
    city: a.ct?.n ?? '',
    state: a.st?.c ?? '',
    country: a.cc ?? '',
    postal: a.pc ?? '',
    lat: c.geo?.lat ?? null,
    lng: c.geo?.lng ?? null,
    stars: c.rt || null,
    collection: (c.cmp ?? []).map((m) => m.cn).join('; '),
    taRating: c.tar?.rt ?? null,
    taReviews: c.tar?.cnt ?? null,
    image: c.img?.[0]?.url ?? null,
  };
});
hotels.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync('data/edit_hotels.source.json', JSON.stringify(hotels, null, 1));
console.log(`Wrote ${hotels.length} hotels to data/edit_hotels.source.json`);
