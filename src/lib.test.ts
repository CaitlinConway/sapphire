import { describe, expect, it } from 'vitest';
import { Hotel, PricesFile, applyFilters, creditsFor, defaultCheckins, priceHotel, rank } from './lib';

const base: Hotel = {
  id: '1', name: 'Kimpton Gray Hotel by IHG', address: '', city: 'Chicago', state: 'IL', country: 'US', postal: '',
  lat: 41.88, lng: -87.63, stars: 4, collection: 'Hotel & Resort Collection', taRating: null, taReviews: null, image: null,
  selectBrand: 'IHG', airports: [], united: { code: 'ORD', km: 25 }, homeNonstop: null, nearHome: true,
};
const plain: Hotel = { ...base, id: '2', name: '1 Hotel Mayfair', city: 'London', country: 'GB', selectBrand: null, nearHome: false, homeNonstop: { code: 'LHR', km: 22, min: 470 } };
const prices: PricesFile = {
  updated: null, nights: 2, checkins: ['2026-12-03', '2026-12-06'], heat: {},
  totals: { '1': { '2026-12-03': 448, '2026-12-06': 600 }, '2': { '2026-12-03': 900 } },
};
const on = { editCredit: true, selectCredit: true };

describe('pricing', () => {
  it('stacks both credits on select-brand Edit hotels', () => {
    expect(creditsFor(base, on)).toBe(500);
    expect(creditsFor(plain, on)).toBe(250);
    expect(creditsFor(base, { editCredit: true, selectCredit: false })).toBe(250);
  });
  it('never goes below zero', () => {
    expect(priceHotel(base, '2026-12-03', prices, {}, on).net).toBe(0);
  });
  it('picks the cheapest date when no date is chosen', () => {
    const p = priceHotel(base, null, prices, {}, { editCredit: true, selectCredit: false });
    expect(p.checkin).toBe('2026-12-03');
    expect(p.net).toBe(198);
  });
  it('manual Chase price overrides the estimate', () => {
    const p = priceHotel(plain, '2026-12-03', prices, { '2|2026-12-03': 700 }, on);
    expect(p.total).toBe(700);
    expect(p.source).toBe('manual');
    expect(p.net).toBe(450);
  });
  it('ranks priced hotels by net, unpriced last', () => {
    const rows = [plain, base].map((h) => priceHotel(h, '2026-12-06', prices, {}, on));
    expect(rank(rows).map((r) => r.hotel.id)).toEqual(['1', '2']);
    expect(rank(rows)[1].net).toBeNull();
  });
  it('filters by city, country name and flags', () => {
    const rows = [plain, base].map((h) => priceHotel(h, null, prices, {}, on));
    expect(applyFilters(rows, { query: 'united kingdom', collection: '', selectOnly: false, unitedOnly: false, nonstopOnly: false, maxNet: null }).length).toBe(1);
    expect(applyFilters(rows, { query: '', collection: '', selectOnly: true, unitedOnly: false, nonstopOnly: false, maxNet: null })[0].hotel.id).toBe('1');
    expect(applyFilters(rows, { query: '', collection: '', selectOnly: false, unitedOnly: false, nonstopOnly: false, maxNet: 100 }).length).toBe(1);
  });
  it('default check-ins are Thursdays and Sundays', () => {
    const d = defaultCheckins('2026-11-05', 1);
    expect(d).toEqual(['2026-11-08', '2026-11-12']);
  });
});
