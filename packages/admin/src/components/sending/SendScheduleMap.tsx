import { useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { ScheduleBreakdownRow } from './types';
import { TZ_COORDS } from './tzCoords';

/**
 * World map of a scheduled send's delivery — one marker per timezone cohort,
 * placed at a representative city, sized by recipient volume, and coloured by
 * WHEN that cohort is dispatched (a single-hue sequential ramp: earliest = light,
 * latest = dark). A staggered send reads as a light→dark sweep across longitudes;
 * an all-at-once blast reads as a single flat colour. Complements the list view.
 */

function fmtUtc(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' UTC';
}

// Sequential single-hue (blue) ramp, light (early) → dark (late). Kept in-hue
// per the sequential-colour rule; a stroke ring gives contrast on the tiles.
const RAMP_LIGHT: [number, number, number] = [191, 219, 254]; // blue-200
const RAMP_DARK: [number, number, number] = [30, 58, 138];    // blue-900
function rampColor(f: number): string {
  const t = Math.max(0, Math.min(1, f));
  const c = RAMP_LIGHT.map((lo, i) => Math.round(lo + (RAMP_DARK[i] - lo) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

interface Point {
  timezone: string;
  recipients: number;
  send_at: string;
  lat: number;
  lng: number;
  color: string;
  radius: number;
}

export function SendScheduleMap({ rows }: { rows: ScheduleBreakdownRow[] }) {
  const { points, unmapped, first, last } = useMemo(() => {
    const times = rows.map((r) => new Date(r.send_at).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const span = Math.max(1, maxT - minT);
    const maxRecip = Math.max(1, ...rows.map((r) => r.recipients));

    const pts: Point[] = [];
    let missing = 0;
    for (const r of rows) {
      const coord = TZ_COORDS[r.timezone];
      if (!coord) { missing += r.recipients; continue; }
      const f = (new Date(r.send_at).getTime() - minT) / span;
      pts.push({
        timezone: r.timezone,
        recipients: r.recipients,
        send_at: r.send_at,
        lat: coord[0],
        lng: coord[1],
        color: rampColor(f),
        // area ∝ recipients (radius ∝ sqrt), clamped to a legible band.
        radius: Math.max(4, Math.min(24, Math.sqrt(r.recipients / maxRecip) * 24)),
      });
    }
    // Draw larger cohorts first so small ones land on top and stay clickable.
    pts.sort((a, b) => b.radius - a.radius);
    return {
      points: pts,
      unmapped: missing,
      first: rows.length ? fmtUtc(new Date(minT).toISOString()) : '—',
      last: rows.length ? fmtUtc(new Date(maxT).toISOString()) : '—',
    };
  }, [rows]);

  return (
    <div>
      <div className="w-full h-80 rounded-lg overflow-hidden border border-[var(--gray-a5)]">
        <MapContainer center={[25, 5]} zoom={1} minZoom={1} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false} worldCopyJump>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {points.map((p) => (
            <CircleMarker
              key={p.timezone}
              center={[p.lat, p.lng]}
              radius={p.radius}
              fillColor={p.color}
              fillOpacity={0.85}
              color="#ffffff"
              weight={1.5}
            >
              <Tooltip>
                <div className="text-xs">
                  <strong>{p.timezone}</strong><br />
                  {p.recipients.toLocaleString()} recipient{p.recipients === 1 ? '' : 's'}<br />
                  {fmtUtc(p.send_at)}
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      {/* Time legend (sequential ramp) */}
      <div className="mt-3 flex items-center gap-3 text-xs text-[var(--gray-10)]">
        <span className="whitespace-nowrap">{first}</span>
        <div
          className="h-2 flex-1 rounded-full"
          style={{ background: `linear-gradient(to right, ${rampColor(0)}, ${rampColor(0.5)}, ${rampColor(1)})` }}
        />
        <span className="whitespace-nowrap">{last}</span>
      </div>
      <p className="mt-1 text-xs text-[var(--gray-9)]">
        Marker colour = delivery time (light → dark), size = recipients.
        {unmapped > 0 && ` ${unmapped.toLocaleString()} recipient(s) in unmapped zones aren't shown.`}
      </p>
    </div>
  );
}

export default SendScheduleMap;
