import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * A non-interactive Leaflet map centered on a single point, used as the profile
 * hero background.
 *
 * This replaces an <iframe> embed of openstreetmap.org/export/embed.html. That
 * iframe renders on localhost but is BLOCKED in production: the admin app is
 * served with `Cross-Origin-Embedder-Policy: credentialless` (required for the
 * PDF generator's SharedArrayBuffer), and a cross-origin iframe whose document
 * doesn't assert COEP is not allowed to load under cross-origin isolation.
 *
 * Leaflet renders its tiles as plain <img> elements instead, which COEP:
 * credentialless permits (they load in credentialless/no-credentials mode), so
 * this works in both environments. CircleMarker is inline SVG, so there's no
 * marker-image asset to break either.
 */
export function StaticLocationMap({
  lat,
  lng,
  zoom = 11,
  className,
}: {
  lat: number;
  lng: number;
  zoom?: number;
  className?: string;
}) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={zoom}
      className={className}
      zoomControl={false}
      attributionControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      keyboard={false}
      boxZoom={false}
      // Non-interactive background; pointer handling is owned by the parent.
      style={{ pointerEvents: 'none' }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <CircleMarker
        center={[lat, lng]}
        radius={8}
        pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#6366f1', fillOpacity: 1 }}
      />
    </MapContainer>
  );
}

export default StaticLocationMap;
