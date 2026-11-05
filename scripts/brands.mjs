// Brands covered by the 2026 Sapphire Reserve "select hotels" $250 credit.
// Matched against hotel names; data/brand_overrides.json wins over these rules.
export const SELECT_BRANDS = [
  ['IHG', /InterContinental|Kimpton|\bRegent\b|Six Senses|Vignette Collection|Hotel Indigo|\bvoco\b|Crowne Plaza|\bEVEN Hotel|Holiday Inn|Staybridge|Candlewood|HUALUXE|Atwell Suites|Garner Hotel|Iberostar Beachfront|Ruby (Hotel|[A-Z])/i],
  ['Minor', /Anantara|\bAvani\b|^Oaks |\bTivoli\b|\bNH Collection\b|^NH |\bnhow\b|Elewana/i],
  ['Montage', /\bMontage\b/i],
  ['Omni', /\bOmni\b/i],
  ['Pan Pacific', /Pan Pacific|PARKROYAL/i],
  ['Pendry', /\bPendry\b/i],
  ['Virgin', /Virgin Hotels?/i],
];

export function brandFor(name) {
  for (const [brand, re] of SELECT_BRANDS) if (re.test(name)) return brand;
  return null;
}
