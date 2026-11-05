// Probe: can a free web search find TripAdvisor keys for a few Edit hotels?
import fs from 'node:fs';
import { findTripadvisorKey } from './find_tripadvisor.mjs';
const { hotels } = JSON.parse(fs.readFileSync('public/data/hotels.json', 'utf8'));
const names = ['Kimpton Gray', 'Hotel Indigo Auckland', '1 Hotel Mayfair', 'Capella Ubud', 'Omni Tempe', 'Six Senses Rome', 'Pendry Chicago', 'Vista Verona'];
for (const n of names) {
  const h = hotels.find((x) => x.name.includes(n));
  const r = await findTripadvisorKey(h);
  console.log(`${h.name} -> ${r?.key} (${r?.slug ?? '-'}, score ${r?.score?.toFixed?.(2)}, ${r?.engine})`);
  await new Promise((res) => setTimeout(res, 3000));
}
