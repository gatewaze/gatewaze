import { useState, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface LocationData {
  country: string;
  city: string;
  lat: number;
  lng: number;
  count: number;
}

interface GeographicMapLeafletProps {
  claimed: LocationData[];
  registered: LocationData[];
  attended: LocationData[];
}

type ViewType = 'claimed' | 'registered' | 'attended';

export function GeographicMapLeaflet({
  claimed,
  registered,
  attended
}: GeographicMapLeafletProps) {
  const [viewType, setViewType] = useState<ViewType>('claimed');

  const getDataForView = () => {
    switch (viewType) {
      case 'claimed':
        return claimed;
      case 'registered':
        return registered;
      case 'attended':
        return attended;
      default:
        return claimed;
    }
  };

  const currentData = getDataForView();

  // Calculate total for percentages
  const totalCodes = useMemo(() =>
    currentData.reduce((sum, loc) => sum + loc.count, 0),
    [currentData]
  );

  // Calculate map bounds and center
  const mapConfig = useMemo(() => {
    if (currentData.length === 0) {
      return {
        center: [20, 0] as [number, number],
        zoom: 2
      };
    }

    const lats = currentData.map(d => d.lat);
    const lngs = currentData.map(d => d.lng);

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
  }, [currentData]);

  // Calculate circle sizes
  const getMarkerRadius = (count: number) => {
    const percentage = (count / totalCodes) * 100;
    // Base size on square root of percentage for better visual distribution
    return Math.max(5, Math.min(40, Math.sqrt(percentage) * 8));
  };

  // Get color based on view type
  const getColor = () => {
    switch (viewType) {
      case 'attended':
        return '#10B981';
      case 'registered':
        return '#8B5CF6';
      default:
        return '#3B82F6';
    }
  };

  const uniqueCountries = new Set(currentData.map(d => d.country)).size;
  const uniqueCities = currentData.length;
  const topLocation = currentData[0];

  return (
    <div className="space-y-6">
      {/* View Type Selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Geographic Map</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setViewType('claimed')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              viewType === 'claimed'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            Claimed ({claimed.reduce((sum, l) => sum + l.count, 0)})
          </button>
          <button
            onClick={() => setViewType('registered')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              viewType === 'registered'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            Registered ({registered.reduce((sum, l) => sum + l.count, 0)})
          </button>
          <button
            onClick={() => setViewType('attended')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              viewType === 'attended'
                ? 'bg-green-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            Attended ({attended.reduce((sum, l) => sum + l.count, 0)})
          </button>
        </div>
      </div>

      {/* Interactive Map */}
      <div>
        <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          Location Distribution - Circle size represents concentration
        </h4>
        <div className="bg-white dark:bg-gray-800 p-2 rounded-lg">
          {currentData.length > 0 ? (
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
                {currentData.map((location, index) => (
                  <CircleMarker
                    key={index}
                    center={[location.lat, location.lng]}
                    radius={getMarkerRadius(location.count)}
                    fillColor={getColor()}
                    fillOpacity={0.6}
                    color={getColor()}
                    weight={2}
                  >
                    <Tooltip>
                      <div>
                        <strong>{location.city || 'Unknown City'}</strong>
                        <br />
                        {location.country || 'Unknown Country'}
                        <br />
                        Count: {location.count}
                        <br />
                        Percentage: {((location.count / totalCodes) * 100).toFixed(1)}%
                      </div>
                    </Tooltip>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-96 bg-gray-50 dark:bg-gray-900 rounded-lg text-gray-500">
              No location data available with coordinates
            </div>
          )}
        </div>
      </div>

      {/* Top Locations List */}
      {currentData.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Top Locations</h4>
          <div className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-400">Location</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-600 dark:text-gray-400">Codes</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-600 dark:text-gray-400">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {currentData.slice(0, 15).map((location, index) => (
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
                        {((location.count / totalCodes) * 100).toFixed(1)}%
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
              {topLocation.count} codes ({((topLocation.count / totalCodes) * 100).toFixed(1)}%)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}