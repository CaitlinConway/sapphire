// Probe: how many Edit hotels have a TripAdvisor id (P3134) on Wikidata within 400 m of their coordinates?
import fs from 'node:fs';
const { hotels } = JSON.parse(fs.readFileSync('public/data/hotels.json', 'utf8'));
const sample = hotels.filter((_, i) => i % 38 === 0).slice(0, 40);
let hits = 0;
for (const h of sample) {
  const q = `SELECT ?item ?itemLabel ?ta WHERE {
    SERVICE wikibase:around { ?item wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${h.lng} ${h.lat})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "0.4" . }
    ?item wdt:P3134 ?ta .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
  const res = await fetch(`https://query.wikidata.org/sparql?${new URLSearchParams({ query: q, format: 'json' })}`, {
    headers: { 'User-Agent': 'sapphire-edit-finder/1.0 (github.com/CaitlinConway/sapphire)' },
  });
  const j = res.ok ? await res.json() : null;
  const rows = (j?.results?.bindings ?? []).map((b) => `${b.itemLabel?.value} [${b.ta?.value}]`);
  if (rows.length) hits++;
  console.log(`${h.name} (${h.city}) -> ${res.status} ${rows.slice(0, 3).join(' | ') || '-'}`);
  await new Promise((r) => setTimeout(r, 1200));
}
console.log(`Wikidata TripAdvisor ids near ${hits}/${sample.length} sampled hotels`);
