import { useState, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPinIcon } from '@heroicons/react/24/outline';

interface PersonLocation {
  country: string;
  city: string;
  lat: number;
  lng: number;
  count: number;
}

interface PersonLocationMapProps {
  locations: PersonLocation[];
  loading?: boolean;
}

export function PersonLocationMap({ locations, loading = false }: PersonLocationMapProps) {
  // Calculate total for percentages
  const totalMembers = useMemo(() =>
    locations.reduce((sum, loc) => sum + loc.count, 0),
    [locations]
  );

  // Calculate map bounds and center
  const mapConfig = useMemo(() => {
    if (locations.length === 0) {
      return {
        center: [20, 0] as [number, number],
        zoom: 2
      };
    }

    const lats = locations.map(d => d.lat);
    const lngs = locations.map(d => d.lng);

    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

    // Calculate appropriate zoom level based on spread
    const latDiff = Math.max(...lats) - Math.min(...lats);
    const lngDiff = Math.max(...lngs) - Math.min(...lngs);
    const maxDiff = Math.max(latDiff, lngDiff);

    let zoom = 2;
    if (maxDiff < 1) zoom = 10;
    else if (maxDiff < 5) zoom = 7;
    else if (maxDiff < 10) zoom = 5;
    else if (maxDiff < 50) zoom = 3;

    return {
      center: [centerLat, centerLng] as [number, number],
      zoom
    };
  }, [locations]);

  // Calculate circle sizes
  const getMarkerRadius = (count: number) => {
    const percentage = (count / totalMembers) * 100;
    // Base size on square root of percentage for better visual distribution
    return Math.max(5, Math.min(40, Math.sqrt(percentage) * 8));
  };

  const uniqueCountries = new Set(locations.map(d => d.country)).size;
  const uniqueCities = locations.length;
  const topLocation = locations[0];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading people locations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">People Locations</h3>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {totalMembers.toLocaleString()} people with location data
        </div>
      </div>

      {/* Interactive Map */}
      <div>
        <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          Geographic Distribution - Circle size represents people concentration
        </h4>
        <div className="bg-white dark:bg-gray-800 p-2 rounded-lg">
          {locations.length > 0 ? (
            <div className="w-full h-96 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
              <MapContainer
                center={mapConfig.center}
                zoom={mapConfig.zoom}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom={false}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {locations.map((location, index) => (
                  <CircleMarker
                    key={index}
                    center={[location.lat, location.lng]}
                    radius={getMarkerRadius(location.count)}
                    fillColor="#3B82F6"
                    fillOpacity={0.6}
                    color="#3B82F6"
                    weight={2}
                  >
                    <Tooltip>
                      <div>
                        <strong>{location.city || 'Unknown City'}</strong>
                        <br />
                        {location.country || 'Unknown Country'}
                        <br />
                        People: {location.count}
                        <br />
                        Percentage: {((location.count / totalMembers) * 100).toFixed(1)}%
                      </div>
                    </Tooltip>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-96 bg-gray-50 dark:bg-gray-900 rounded-lg text-gray-500">
              <MapPinIcon className="h-12 w-12 text-gray-400 mb-3" />
              <p className="text-sm font-medium text-gray-900 dark:text-white">No location data available</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                People need city and country to appear on the map
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Top Locations List */}
      {locations.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Top Locations</h4>
          <div className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-400">Location</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-600 dark:text-gray-400">People</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-600 dark:text-gray-400">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {locations.slice(0, 15).map((location, index) => (
                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-900">
                      <td className="px-4 py-2 text-sm">
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">
                            {location.city || 'Unknown City'}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {location.country || 'Unknown Country'}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-sm text-right text-gray-900 dark:text-white">
                        {location.count}
                      </td>
                      <td className="px-4 py-2 text-sm text-right text-gray-500 dark:text-gray-400">
                        {((location.count / totalMembers) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Geographic Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Countries</div>
          <div className="text-2xl font-bold mt-1">{uniqueCountries}</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Locations</div>
          <div className="text-2xl font-bold mt-1">{uniqueCities}</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Top Location</div>
          <div className="text-lg font-bold mt-1">
            {topLocation ? (topLocation.city || 'Unknown') : 'N/A'}
          </div>
          {topLocation && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {topLocation.count} people ({((topLocation.count / totalMembers) * 100).toFixed(1)}%)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
