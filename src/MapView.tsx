import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Priced, heatWeight, priceColor, usd } from './lib';

// leaflet.heat is a classic plugin that expects a global L.
(window as unknown as { L: typeof L }).L = L;
const heatReady = import('leaflet.heat');

type HeatLayer = L.Layer & { setLatLngs(p: [number, number, number][]): void };

interface Props {
  rows: Priced[];
  selectedId: string | null;
  onSelect(id: string): void;
  showHeat: boolean;
  showPins: boolean;
  fitKey: string;
}

export default function MapView({ rows, selectedId, onSelect, showHeat, showPins, fitKey }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);
  const heat = useRef<HeatLayer | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { worldCopyJump: true, zoomControl: true }).setView([30, -20], 2);
    // OpenStreetMap's standard tiles: no API key, fine for light personal use.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    pins.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Heat layer
  useEffect(() => {
    let cancelled = false;
    heatReady.then(() => {
      const m = map.current;
      if (cancelled || !m) return;
      const pts = rows.map((r) => [r.hotel.lat, r.hotel.lng, heatWeight(r.net)] as [number, number, number]);
      if (!heat.current) {
        const factory = (L as unknown as { heatLayer(p: unknown[], o: object): HeatLayer }).heatLayer;
        heat.current = factory(pts, {
          radius: 28,
          blur: 22,
          maxZoom: 9,
          minOpacity: 0.25,
          gradient: { 0.15: '#c5d4f5', 0.45: '#4dabf7', 0.75: '#20c997', 1: '#0b7a3e' },
        });
      } else heat.current.setLatLngs(pts);
      if (showHeat && !m.hasLayer(heat.current)) heat.current.addTo(m);
      if (!showHeat && m.hasLayer(heat.current)) m.removeLayer(heat.current);
    });
    return () => {
      cancelled = true;
    };
  }, [rows, showHeat]);

  // Pins
  useEffect(() => {
    const g = pins.current;
    if (!g) return;
    g.clearLayers();
    if (!showPins) return;
    for (const r of rows) {
      const h = r.hotel;
      const sel = h.id === selectedId;
      const color = priceColor(r.net).startsWith('var') ? '#8a94a6' : priceColor(r.net);
      const mk = L.circleMarker([h.lat, h.lng], {
        radius: sel ? 10 : h.selectBrand ? 7 : 5,
        color: h.selectBrand ? '#1c3faa' : '#ffffff',
        weight: h.selectBrand ? 2.5 : 1,
        fillColor: color,
        fillOpacity: 0.95,
      });
      mk.bindTooltip(
        `<b>${escapeHtml(h.name)}</b><br>${escapeHtml(h.city)} · net ${usd(r.net)}${h.selectBrand ? ' · +$250 ' + escapeHtml(h.selectBrand) : ''}`,
      );
      mk.on('click', () => onSelectRef.current(h.id));
      mk.addTo(g);
      if (sel) mk.bringToFront();
    }
  }, [rows, selectedId, showPins]);

  // Fit to results when the search or filters change.
  useEffect(() => {
    const m = map.current;
    if (!m || rows.length === 0) return;
    if (rows.length > 600) {
      m.setView([30, -20], 2);
      return;
    }
    const b = L.latLngBounds(rows.map((r) => [r.hotel.lat, r.hotel.lng] as [number, number]));
    m.fitBounds(b.pad(0.2), { maxZoom: 12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Pan to the selected hotel.
  useEffect(() => {
    const m = map.current;
    const r = rows.find((x) => x.hotel.id === selectedId);
    if (m && r) m.panTo([r.hotel.lat, r.hotel.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return <div ref={el} className="map" />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
