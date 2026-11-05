import { useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView';
import {
  Filters,
  Hotel,
  HotelsFile,
  ManualPrices,
  Priced,
  PricesFile,
  Settings,
  addDays,
  applyFilters,
  countryName,
  defaultCheckins,
  fmtDate,
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
    };
  }, [rows]);

  const fitKey = JSON.stringify(filters);
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
        <section className="list" aria-label="Ranked hotels">
          <div className="stats">
            <span><b>{stats.count.toLocaleString()}</b> hotels</span>
            <span><b>{stats.priced.toLocaleString()}</b> priced</span>
            <span><b>{stats.select}</b> with both credits</span>
            {stats.free > 0 && <span className="good"><b>{stats.free}</b> free after credits</span>}
            {stats.cheapest != null && <span>cheapest net <b>{usd(stats.cheapest)}</b></span>}
          </div>
          <ol>
            {rows.slice(0, limit).map((r, i) => (
              <Row key={r.hotel.id} r={r} rank={i + 1} home={data.homeAirport} active={r.hotel.id === selectedId} onClick={() => setSelectedId(r.hotel.id)} />
            ))}
          </ol>
          {rows.length > limit && (
            <button className="more" onClick={() => setLimit((l) => l + 200)}>
              Show more ({(rows.length - limit).toLocaleString()} left)
            </button>
          )}
          {rows.length === 0 && <p className="empty">No hotels match.</p>}
        </section>

        <section className="mapwrap">
          <MapView rows={rows} selectedId={selectedId} onSelect={setSelectedId} showHeat={showHeat} showPins={showPins} fitKey={fitKey} />
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
        Prices are public estimates (LiteAPI or Xotelo) and may differ from the Chase Travel prepaid rate; always confirm on Chase Travel.
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
