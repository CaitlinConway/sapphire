# Edit Deal Finder

A web app for finding cheap 2-night stays at Chase Sapphire Reserve **The Edit** hotels. It ranks hotels by what you pay after credits.

- **Credits:** each hotel gets The Edit's $250 credit. Hotels from the brands covered by the 2026 "select hotels" credit get another $250: IHG, Minor, Montage, Omni, Pan Pacific, Pendry and Virgin. That credit expires Dec 31, 2026.
- **Ranked list:** sorted by net price, which is the 2-night total minus the credits that apply. You can search by city, country, hotel or brand.
- **Map:** price-colored pins and a heatmap showing where cheap hotels cluster. A date slider and play button let you watch the heatmap change by check-in date.
- **United badges:** whether United serves a nearby airport, and whether United flies nonstop there from ORD.
- **Hotel panel:** a price-by-date chart, a field to type the real Chase Travel price (saved in your browser), and links to Chase, TripAdvisor, Google Hotels and United.

## Data

| File | Source | Refresh |
| --- | --- | --- |
| `data/edit_hotels.source.json` | Chase Travel "The Edit" list, captured from the logged-in site's network response | By hand: `npm run data:import -- capture.json` |
| `data/brand_overrides.json` | Manual fixes to the select-brand name matching (`scripts/brands.mjs`) | By hand |
| `public/data/hotels.json` | Built by `scripts/build_hotels.mjs`: hotels, brand tags, nearest airports, United / ORD nonstop flags from [Jonty/airline-route-data](https://github.com/Jonty/airline-route-data) | Nightly |
| `public/data/prices.json` | `scripts/fetch_prices.mjs`: [Xotelo](https://xotelo.com) public rates (TripAdvisor) for 2-night stays starting every Thursday and Sunday for 12 weeks | Nightly, rotating through the hotels within an API budget |

Prices are **estimates**. Chase Travel's prepaid rate can differ, so confirm on Chase before booking.

## Run locally

```bash
npm install
npm run data:hotels      # downloads route data, writes public/data/hotels.json
npm run data:prices      # optional; slow (MAX_CALLS=200 for a quick sample)
npm run dev
```

Set `HOME_AIRPORT=SFO` before running `data:hotels` to use a different home airport.

## Deploy

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `main`. It also runs nightly and on demand (**Actions → Refresh data and deploy → Run workflow**), and those runs refresh the routes and prices first. To turn on hosting, set **Settings → Pages → Source** to **GitHub Actions**.
