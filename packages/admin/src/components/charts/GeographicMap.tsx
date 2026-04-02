import { useState, useMemo } from 'react';

interface LocationData {
  country: string;
  city: string;
  lat: number;
  lng: number;
  count: number;
}

interface GeographicMapProps {
  claimed: LocationData[];
  registered: LocationData[];
  attended: LocationData[];
}

type ViewType = 'claimed' | 'registered' | 'attended';

export function GeographicMap({
  claimed,
  registered,
  attended
}: GeographicMapProps) {
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

  // Calculate map bounds
  const getBounds = () => {
    if (currentData.length === 0) {
      // Default world view
      return {
        minLat: -60,
        maxLat: 70,
        minLng: -180,
        maxLng: 180,
        centerLat: 20,
        centerLng: 0,
        zoom: 2
      };
    }

    const lats = currentData.map(d => d.lat);
    const lngs = currentData.map(d => d.lng);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;

    // Calculate appropriate zoom level based on bounds
    const latDiff = maxLat - minLat;
    const lngDiff = maxLng - minLng;
    const maxDiff = Math.max(latDiff, lngDiff);

    let zoom = 2;
    if (maxDiff < 1) zoom = 10;
    else if (maxDiff < 5) zoom = 7;
    else if (maxDiff < 10) zoom = 5;
    else if (maxDiff < 50) zoom = 3;

    return {
      minLat: minLat - 1,
      maxLat: maxLat + 1,
      minLng: minLng - 1,
      maxLng: maxLng + 1,
      centerLat,
      centerLng,
      zoom
    };
  };

  const bounds = getBounds();

  // Create an SVG overlay for the map with circles
  const createMapOverlay = () => {
    if (currentData.length === 0) return null;

    // Calculate circle sizes based on percentage of total
    const maxPercentage = Math.max(...currentData.map(loc => (loc.count / totalCodes) * 100));
    const scale = 50 / Math.sqrt(maxPercentage); // Scale factor for circle sizes

    return currentData.map((location, index) => {
      const percentage = (location.count / totalCodes) * 100;
      const radius = Math.sqrt(percentage) * scale;

      // Convert lat/lng to pixel coordinates (simplified projection)
      const x = ((location.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
      const y = ((bounds.maxLat - location.lat) / (bounds.maxLat - bounds.minLat)) * 100;

      return {
        x: `${x}%`,
        y: `${y}%`,
        radius: Math.max(3, Math.min(30, radius)),
        count: location.count,
        city: location.city,
        country: location.country,
        percentage: percentage.toFixed(1)
      };
    });
  };

  const mapOverlayData = createMapOverlay();

  // Create the map URL without markers (we'll overlay our own)
  const mapUrl = currentData.length > 0
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${bounds.minLng},${bounds.minLat},${bounds.maxLng},${bounds.maxLat}&layer=mapnik`
    : `https://www.openstreetmap.org/export/embed.html?bbox=-180,-60,180,70&layer=mapnik`;

  // Summary stats
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
            <div className="relative w-full h-96 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
              <iframe
                width="100%"
                height="100%"
                frameBorder="0"
                scrolling="no"
                marginHeight={0}
                marginWidth={0}
                src={mapUrl}
                className="w-full h-full"
              />
              {/* SVG Overlay for circles */}
              {mapOverlayData && (
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{ zIndex: 10 }}
                >
                  {mapOverlayData.map((marker, index) => (
                    <g key={index}>
                      <circle
                        cx={marker.x}
                        cy={marker.y}
                        r={marker.radius}
                        fill={
                          viewType === 'attended' ? 'rgba(16, 185, 129, 0.5)' :
                          viewType === 'registered' ? 'rgba(139, 92, 246, 0.5)' :
                          'rgba(59, 130, 246, 0.5)'
                        }
                        stroke={
                          viewType === 'attended' ? '#10B981' :
                          viewType === 'registered' ? '#8B5CF6' :
                          '#3B82F6'
                        }
                        strokeWidth="2"
                      />
                      <title>
                        {marker.city}, {marker.country}
                        {'\n'}Count: {marker.count}
                        {'\n'}Percentage: {marker.percentage}%
                      </title>
                    </g>
                  ))}
                </svg>
              )}
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