import { useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView';
import {
  CitySort,
  ContinentGroup,
  Filters,
  Hotel,
  HotelsFile,
  ManualPrices,
  Priced,
  PricesFile,
  Settings,
  addDays,
  applyFilters,
  cityKeyOf,
  countryName,
  defaultCheckins,
  fmtDate,
  groupByCity,
  priceColor,
  priceHotel,
  rank,
  usd,
} from './lib';

const ANY = '';

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export default function App() {
  const [data, setData] = useState<HotelsFile | null>(null);
  const [prices, setPrices] = useState<PricesFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkin, setCheckin] = useState<string>(ANY);
  const [filters, setFilters] = useState<Filters>({
    query: '',
    collection: '',
    selectOnly: false,
    unitedOnly: false,
    nonstopOnly: false,
    maxNet: null,
  });
  const [settings, setSettings] = useState<Settings>(() => load('settings', { editCredit: true, selectCredit: true }));
  const [manual, setManual] = useState<ManualPrices>(() => load('manualPrices', {}));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showHeat, setShowHeat] = useState(true);
  const [showPins, setShowPins] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [limit, setLimit] = useState(100);
  const [view, setView] = useState<'hotels' | 'cities'>(() => load('view', 'hotels'));
  const [citySort, setCitySort] = useState<CitySort>(() => load('citySort', 'name'));
  const [openCity, setOpenCity] = useState<string | null>(null);

  useEffect(() => {
    fetch('data/hotels.json')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError('Could not load hotel data.'));
    fetch('data/prices.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => setPrices(p))
      .catch(() => setPrices(null));
  }, []);

  useEffect(() => save('settings', settings), [settings]);
  useEffect(() => save('manualPrices', manual), [manual]);
  useEffect(() => save('view', view), [view]);
  useEffect(() => save('citySort', citySort), [citySort]);

  const today = new Date().toISOString().slice(0, 10);
  const checkins = useMemo(() => {
    const base = prices?.checkins?.length ? prices.checkins : defaultCheckins(today);
    const extra = Object.keys(manual).map((k) => k.split('|')[1]);
    return [...new Set([...base, ...extra])].filter((d) => d >= today).sort();
  }, [prices, manual, today]);

  const hasPrices = !!prices && Object.keys(prices.totals ?? {}).length > 0;

  const priced = useMemo<Priced[]>(
    () => (data ? data.hotels.map((h) => priceHotel(h, checkin || null, prices, manual, settings)) : []),
    [data, checkin, prices, manual, settings],
  );
  const rows = useMemo(() => rank(applyFilters(priced, filters)), [priced, filters]);
  const groups = useMemo(() => (view === 'cities' ? groupByCity(rows, citySort) : []), [view, rows, citySort]);
  // Drilling into a city narrows the map to that city's hotels.
  const cityRows = useMemo(
    () => (view === 'cities' && openCity ? rows.filter((r) => cityKeyOf(r.hotel) === openCity) : null),
    [view, openCity, rows],
  );
  const mapRows = cityRows && cityRows.length ? cityRows : rows;
  const selected = rows.find((r) => r.hotel.id === selectedId) ?? priced.find((r) => r.hotel.id === selectedId) ?? null;

  // Time-lapse: step through check-in dates.
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setCheckin((c) => {
        const i = checkins.indexOf(c);
        return checkins[(i + 1) % checkins.length];
      });
    }, 1300);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing, checkins]);

  const stats = useMemo(() => {
    const p = rows.filter((r) => r.net != null);
    return {
      count: rows.length,
      priced: p.length,
      select: rows.filter((r) => r.hotel.selectBrand).length,
      free: p.filter((r) => r.net === 0).length,
      cheapest: p[0]?.net ?? null,
      cities: new Set(rows.map((r) => cityKeyOf(r.hotel))).size,
    };
  }, [rows]);

  const fitKey = JSON.stringify(filters) + (cityRows && cityRows.length ? `|${openCity}` : '');
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setLimit(100);
  };
  const sliderIndex = Math.max(0, checkins.indexOf(checkin));

  if (error) return <div className="empty">{error}</div>;
  if (!data) return <div className="empty">Loading hotels…</div>;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="gem" aria-hidden>◆</span>
          <div>
            <h1>Edit Deal Finder</h1>
            <p>Sapphire Reserve · The Edit $250 · select-brand $250 · 2-night stays</p>
          </div>
        </div>
        <div className="search">
          <input
            type="search"
            placeholder="City, country, hotel or brand (e.g. Lisbon, Japan, Kimpton)"
            value={filters.query}
            onChange={(e) => set('query', e.target.value)}
          />
          <select value={checkin} onChange={(e) => { setPlaying(false); setCheckin(e.target.value); }} aria-label="Check-in date">
            <option value={ANY}>Any date (cheapest)</option>
            {checkins.map((d) => (
              <option key={d} value={d}>
                {fmtDate(d)} → {fmtDate(addDays(d, 2))}
              </option>
            ))}
          </select>
        </div>
      </header>

      <section className="controls">
        <label className="chip">
          <input type="checkbox" checked={filters.selectOnly} onChange={(e) => set('selectOnly', e.target.checked)} />
          Both credits only
        </label>
        <label className="chip">
          <input type="checkbox" checked={filters.unitedOnly} onChange={(e) => set('unitedOnly', e.target.checked)} />
          United serves it
        </label>
        <label className="chip">
          <input type="checkbox" checked={filters.nonstopOnly} onChange={(e) => set('nonstopOnly', e.target.checked)} />
          United nonstop from {data.homeAirport}
        </label>
        <select value={filters.collection} onChange={(e) => set('collection', e.target.value)} aria-label="Collection">
          <option value="">All collections</option>
          <option>Hotel & Resort Collection</option>
          <option>Boutique Collection</option>
          <option>All In Collection</option>
        </select>
        <label className="chip">
          Max net
          <input
            type="number"
            min={0}
            step={50}
            placeholder="any"
            value={filters.maxNet ?? ''}
            onChange={(e) => set('maxNet', e.target.value === '' ? null : +e.target.value)}
          />
        </label>
        <span className="sep" />
        <label className="chip subtle" title="Turn off if you've used both Edit credits this year">
          <input type="checkbox" checked={settings.editCredit} onChange={(e) => setSettings({ ...settings, editCredit: e.target.checked })} />
          Edit credit left
        </label>
        <label className="chip subtle" title="One-time 2026 credit for IHG, Minor, Montage, Omni, Pan Pacific, Pendry, Virgin. Expires Dec 31, 2026.">
          <input type="checkbox" checked={settings.selectCredit} onChange={(e) => setSettings({ ...settings, selectCredit: e.target.checked })} />
          Select-brand credit left
        </label>
      </section>

      {!hasPrices && (
        <div className="notice">
          No price estimates yet. The map shows where Edit hotels are, and you can type a Chase Travel price on any hotel to rank it.
          Run the <b>Refresh prices</b> GitHub Action to fill estimates.
        </div>
      )}

      <main className="body">
        <section className="list" aria-label={view === 'cities' ? 'Cities by continent' : 'Ranked hotels'}>
          <div className="listhead">
          <div className="viewbar">
            <div className="tabs" role="tablist" aria-label="List view">
              <button role="tab" aria-selected={view === 'hotels'} className={view === 'hotels' ? 'on' : ''} onClick={() => setView('hotels')}>
                Hotels
              </button>
              <button role="tab" aria-selected={view === 'cities'} className={view === 'cities' ? 'on' : ''} onClick={() => setView('cities')}>
                Cities by continent
              </button>
            </div>
            {view === 'cities' && (
              <select value={citySort} onChange={(e) => setCitySort(e.target.value as CitySort)} aria-label="Sort cities">
                <option value="name">A–Z</option>
                <option value="hotels">Most hotels</option>
                <option value="cheapest">Cheapest</option>
              </select>
            )}
          </div>
          <div className="stats">
            {view === 'cities' && <span><b>{stats.cities.toLocaleString()}</b> cities</span>}
            <span><b>{stats.count.toLocaleString()}</b> hotels</span>
            <span><b>{stats.priced.toLocaleString()}</b> priced</span>
            <span><b>{stats.select}</b> with both credits</span>
            {stats.free > 0 && <span className="good"><b>{stats.free}</b> free after credits</span>}
            {stats.cheapest != null && <span>cheapest net <b>{usd(stats.cheapest)}</b></span>}
          </div>
          </div>
          {view === 'cities' ? (
            <CityList
              groups={groups}
              home={data.homeAirport}
              openCity={openCity}
              selectedId={selectedId}
              onToggleCity={(k) => setOpenCity((c) => (c === k ? null : k))}
              onSelect={(id) => {
                setSelectedId(id);
                // On phones the map (and the hotel card) sits above the list.
                if (window.matchMedia('(max-width: 820px)').matches) document.querySelector('.mapwrap')?.scrollIntoView({ behavior: 'smooth' });
              }}
            />
          ) : (
            <ol>
              {rows.slice(0, limit).map((r, i) => (
                <Row key={r.hotel.id} r={r} rank={i + 1} home={data.homeAirport} active={r.hotel.id === selectedId} onClick={() => setSelectedId(r.hotel.id)} />
              ))}
            </ol>
          )}
          {view === 'hotels' && rows.length > limit && (
            <button className="more" onClick={() => setLimit((l) => l + 200)}>
              Show more ({(rows.length - limit).toLocaleString()} left)
            </button>
          )}
          {rows.length === 0 && <p className="empty">No hotels match.</p>}
        </section>

        <section className="mapwrap">
          <MapView rows={mapRows} selectedId={selectedId} onSelect={setSelectedId} showHeat={showHeat} showPins={showPins} fitKey={fitKey} />
          <div className="maptools">
            <label><input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} /> Heatmap</label>
            <label><input type="checkbox" checked={showPins} onChange={(e) => setShowPins(e.target.checked)} /> Pins</label>
            <Legend />
          </div>
          <div className="timeline">
            <button onClick={() => { if (!checkin) setCheckin(checkins[0]); setPlaying((p) => !p); }} aria-label={playing ? 'Pause' : 'Play dates'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, checkins.length - 1)}
              value={sliderIndex}
              onChange={(e) => { setPlaying(false); setCheckin(checkins[+e.target.value]); }}
              aria-label="Check-in date"
            />
            <span className="when">{checkin ? `${fmtDate(checkin)} → ${fmtDate(addDays(checkin, 2))}` : 'Any date'}</span>
            {checkin && <button className="link" onClick={() => { setPlaying(false); setCheckin(ANY); }}>clear</button>}
          </div>
          {selected && (
            <Detail
              r={selected}
              prices={prices}
              checkins={checkins}
              checkin={checkin}
              manual={manual}
              home={data.homeAirport}
              setManual={setManual}
              onPickDate={(d) => { setPlaying(false); setCheckin(d); }}
              onClose={() => setSelectedId(null)}
            />
          )}
        </section>
      </main>
      <footer>
        Prices are public estimates (Xotelo/TripAdvisor) and may differ from the Chase Travel prepaid rate; always confirm on Chase Travel.
        The Edit credit is up to $250 per prepaid 2+ night booking (max $500/yr). Select-brand credit list built by name matching.
        {prices?.updated && <> Prices updated {new Date(prices.updated).toLocaleDateString()}.</>} Hotel list built {new Date(data.built).toLocaleDateString()}.
      </footer>
    </div>
  );
}

function Badges({ h, home }: { h: Hotel; home: string }) {
  return (
    <span className="badges">
      <span className="badge edit">Edit $250</span>
      {h.selectBrand && <span className="badge sel">+$250 {h.selectBrand}</span>}
      {h.nearHome ? (
        <span className="badge home">Near {home}</span>
      ) : h.homeNonstop ? (
        <span className="badge ns" title={`United nonstop ${home}–${h.homeNonstop.code}, about ${Math.round(h.homeNonstop.min / 60)}h`}>
          ✈ UA nonstop {home}–{h.homeNonstop.code}
        </span>
      ) : h.united ? (
        <span className="badge ua" title={`United serves ${h.united.code} (${h.united.km} km)`}>✈ United {h.united.code}</span>
      ) : null}
    </span>
  );
}

function CityList(props: {
  groups: ContinentGroup[];
  home: string;
  openCity: string | null;
  selectedId: string | null;
  onToggleCity(key: string): void;
  onSelect(id: string): void;
}) {
  const { groups, home, openCity, selectedId, onToggleCity, onSelect } = props;
  const many = groups.reduce((n, g) => n + g.cities, 0) > 150;
  return (
    <div className="cities">
      {groups.map((g) => (
        <details key={g.continent} className="continent" open={!many || g.countries.some((c) => c.cities.some((ci) => ci.key === openCity))}>
          <summary>
            <span className="cname">{g.continent}</span>
            <span className="ccount">
              {g.cities} {g.cities === 1 ? 'city' : 'cities'} · {g.hotels} {g.hotels === 1 ? 'hotel' : 'hotels'}
            </span>
          </summary>
          {g.countries.map((c) => (
            <div key={c.country} className="country">
              <h4>
                {c.name} <span>{c.cities.length}</span>
              </h4>
              <ul>
                {c.cities.map((ci) => {
                  const open = ci.key === openCity;
                  return (
                    <li key={ci.key} className={open ? 'city open' : 'city'}>
                      <button className="cityrow" aria-expanded={open} onClick={() => onToggleCity(ci.key)}>
                        <span className="caret" aria-hidden>{open ? '▾' : '▸'}</span>
                        <span className="cinfo">
                          <span className="ctitle">
                            {ci.city}
                            {ci.state && <span className="cstate">, {ci.state}</span>}
                          </span>
                          <span className="badges">
                            {ci.selectCount > 0 && <span className="badge sel">{ci.selectCount} both credits</span>}
                            {ci.nearHome ? (
                              <span className="badge home">Near {home}</span>
                            ) : ci.nonstop ? (
                              <span className="badge ns">✈ {home}–{ci.nonstop}</span>
                            ) : null}
                          </span>
                        </span>
                        <span className="cright">
                          <span className="chotels">{ci.rows.length} {ci.rows.length === 1 ? 'hotel' : 'hotels'}</span>
                          {ci.cheapest != null && (
                            <span className="cfrom" style={{ color: priceColor(ci.cheapest) }}>from {usd(ci.cheapest)}</span>
                          )}
                        </span>
                      </button>
                      {open && (
                        <ol className="cityhotels">
                          {ci.rows.map((r, i) => (
                            <Row key={r.hotel.id} r={r} rank={i + 1} home={home} active={r.hotel.id === selectedId} onClick={() => onSelect(r.hotel.id)} />
                          ))}
                        </ol>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}

function Row({ r, rank, home, active, onClick }: { r: Priced; rank: number; home: string; active: boolean; onClick(): void }) {
  const h = r.hotel;
  return (
    <li className={active ? 'row active' : 'row'} onClick={onClick}>
      <span className="rank">{rank}</span>
      <div className="info">
        <div className="name">{h.name}</div>
        <div className="where">
          {h.city}
          {h.state && h.country === 'US' ? `, ${h.state}` : ''} · {countryName(h.country)}
          {r.checkin && !r.source ? '' : r.checkin ? ` · ${fmtDate(r.checkin)}` : ''}
        </div>
        <Badges h={h} home={home} />
      </div>
      <div className="price">
        <span className="net" style={{ color: priceColor(r.net) }}>{usd(r.net)}</span>
        <span className="gross">
          {r.total != null ? `${usd(r.total)} − ${usd(r.credits)}` : 'no price'}
          {r.source === 'manual' && ' · yours'}
        </span>
      </div>
    </li>
  );
}

function Detail(props: {
  r: Priced;
  prices: PricesFile | null;
  checkins: string[];
  checkin: string;
  manual: ManualPrices;
  home: string;
  setManual(f: (m: ManualPrices) => ManualPrices): void;
  onPickDate(d: string): void;
  onClose(): void;
}) {
  const { r, prices, checkins, checkin, manual, home, setManual, onPickDate, onClose } = props;
  const h = r.hotel;
  const totals = prices?.totals[h.id] ?? {};
  const heat = prices?.heat[h.id];
  const key = prices?.keys?.[h.id];
  const editDate = checkin || r.checkin || checkins[0];
  const mk = `${h.id}|${editDate}`;
  const [draft, setDraft] = useState<string>(manual[mk]?.toString() ?? '');
  useEffect(() => setDraft(manual[mk]?.toString() ?? ''), [mk, manual]);

  const series = checkins.map((d) => ({ d, v: manual[`${h.id}|${d}`] ?? totals[d] ?? null }));
  const max = Math.max(1, ...series.map((s) => s.v ?? 0));

  return (
    <aside className="detail">
      <button className="close" onClick={onClose} aria-label="Close">×</button>
      {h.image && <img src={h.image} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />}
      <h2>{h.name}</h2>
      <p className="addr">
        {h.address}, {h.city}
        {h.state ? `, ${h.state}` : ''} · {countryName(h.country)}
      </p>
      <p className="meta">
        {h.collection}
        {h.taRating ? ` · TripAdvisor ${h.taRating}/5 (${h.taReviews?.toLocaleString() ?? 0})` : ''}
      </p>
      <Badges h={h} home={home} />
      <div className="big">
        <div>
          <span className="lbl">2-night total</span>
          <b>{usd(r.total)}</b>
        </div>
        <div>
          <span className="lbl">Credits</span>
          <b>−{usd(r.credits)}</b>
        </div>
        <div>
          <span className="lbl">You pay</span>
          <b style={{ color: priceColor(r.net) }}>{usd(r.net)}</b>
        </div>
      </div>
      {r.checkin && <p className="meta">Best date shown: {fmtDate(r.checkin)} → {fmtDate(addDays(r.checkin, 2))}</p>}

      <h3>2-night price by check-in date</h3>
      <div className="bars" role="list">
        {series.map(({ d, v }) => {
          const cheap = heat?.cheap?.includes(d);
          return (
            <button
              key={d}
              role="listitem"
              className={`bar${d === checkin ? ' on' : ''}${cheap ? ' cheap' : ''}`}
              title={`${fmtDate(d)}: ${v == null ? 'no price' : usd(v)}`}
              onClick={() => onPickDate(d)}
            >
              <span style={{ height: v == null ? 3 : `${Math.max(8, (v / max) * 100)}%` }} />
            </button>
          );
        })}
      </div>

      <h3>Your Chase Travel price</h3>
      <form
        className="manual"
        onSubmit={(e) => {
          e.preventDefault();
          const n = parseFloat(draft);
          setManual((m) => {
            const next = { ...m };
            if (!draft || isNaN(n)) delete next[mk];
            else next[mk] = Math.round(n);
            return next;
          });
        }}
      >
        <span>2 nights from {fmtDate(editDate)}</span>
        <input type="number" min={0} placeholder="e.g. 520" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit">Save</button>
      </form>

      <h3>Getting there</h3>
      <ul className="air">
        {h.airports.length === 0 && <li>No airport within 80 km in the route data.</li>}
        {h.airports.map((a) => (
          <li key={a.code}>
            {a.code} · {a.km} km
            {h.homeNonstop?.code === a.code && ` · United nonstop from ${home} (~${Math.round(h.homeNonstop.min / 60)}h)`}
            {h.united?.code === a.code && h.homeNonstop?.code !== a.code && ' · United serves'}
          </li>
        ))}
      </ul>

      <div className="links">
        <a href="https://www.chase.com/travel/the-edit" target="_blank" rel="noreferrer">Book on Chase Travel</a>
        {key && (
          <a href={`https://www.tripadvisor.com/Hotel_Review-${key}.html`} target="_blank" rel="noreferrer">TripAdvisor</a>
        )}
        <a
          href={`https://www.google.com/travel/hotels?q=${encodeURIComponent(`${h.name} ${h.city}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Google Hotels
        </a>
        <a href={`https://www.united.com/en/us/fsr/choose-flights?f=${home}&t=${h.homeNonstop?.code ?? h.united?.code ?? ''}${editDate ? `&d=${editDate}&r=${addDays(editDate, 2)}` : ''}&tt=2&px=1`} target="_blank" rel="noreferrer">
          United flights
        </a>
      </div>
    </aside>
  );
}

function Legend() {
  const steps: [string, string][] = [
    ['≤$100', '#1a9e5c'],
    ['≤$250', '#7cb342'],
    ['≤$500', '#f2a51a'],
    ['≤$900', '#e8682c'],
    ['more', '#c62f3c'],
    ['no price', '#8a94a6'],
  ];
  return (
    <span className="legend">
      net:
      {steps.map(([l, c]) => (
        <span key={l}>
          <i style={{ background: c }} />
          {l}
        </span>
      ))}
      <span><i className="ring" />both credits</span>
      <span><i className="glow" />glow = cheap area</span>
    </span>
  );
}
