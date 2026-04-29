import ReactApexChart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';
import { useState } from 'react';

interface LocationData {
  country: string;
  city: string;
  lat?: number;
  lng?: number;
  count: number;
}

interface GeographicHeatmapProps {
  claimed: LocationData[];
  registered: LocationData[];
  attended: LocationData[];
}

type ViewType = 'claimed' | 'registered' | 'attended';

export function GeographicHeatmap({
  claimed,
  registered,
  attended
}: GeographicHeatmapProps) {
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

  // Group by country for treemap
  const countryData = currentData.reduce((acc, item) => {
    const country = item.country || 'Unknown Country';
    if (!acc[country]) {
      acc[country] = {
        total: 0,
        cities: []
      };
    }
    acc[country].total += item.count;
    acc[country].cities.push({
      city: item.city || 'Unknown City',
      count: item.count
    });
    return acc;
  }, {} as Record<string, { total: number; cities: { city: string; count: number }[] }>);

  // Prepare treemap series data
  const treemapSeries = [{
    data: Object.entries(countryData).map(([country, data]) => ({
      x: country,
      y: data.total
    }))
  }];

  const treemapOptions: ApexOptions = {
    chart: {
      type: 'treemap',
      height: 400,
      toolbar: {
        show: false
      },
      zoom: {
        enabled: false
      }
    },
    colors: viewType === 'attended' ? ['#10B981'] : viewType === 'registered' ? ['#8B5CF6'] : ['#3B82F6'],
    plotOptions: {
      treemap: {
        distributed: false,
        enableShades: true,
        shadeIntensity: 0.5,
        dataLabels: {
          format: 'scale'
        }
      }
    },
    dataLabels: {
      enabled: true,
      style: {
        fontSize: '12px',
        colors: ['#fff']
      },
      formatter: function(text: string | number) {
        // In ApexCharts treemaps, the text is the x value (country name)
        // and we need to look up the y value (count) from the series data
        const country = (text as string) || 'Unknown Country';
        let count = 0;

        // Get the count directly from the series data we created
        const seriesData = treemapSeries[0].data;
        const dataPoint = seriesData.find(d => d.x === country);
        if (dataPoint) {
          count = dataPoint.y;
        }

        // Get city information
        const data = countryData[country];
        if (data && data.cities && data.cities.length > 0) {
          const topCity = data.cities.sort((a, b) => b.count - a.count)[0];
          const cityName = topCity.city || 'Unknown City';
          return [country, `${count} codes`, `Top: ${cityName}`];
        }
        return [country, `${count} codes`];
      },
      offsetY: -4
    },
    tooltip: {
      custom: function({ dataPointIndex }) {
        const country = Object.keys(countryData)[dataPointIndex];
        const data = countryData[country];

        if (!data) return '';

        const sortedCities = data.cities
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        return `
          <div class="p-3 bg-white dark:bg-gray-800 rounded shadow-lg">
            <div class="font-semibold mb-2">${country}</div>
            <div class="text-sm mb-2">Total: ${data.total} codes</div>
            <div class="text-xs space-y-1">
              <div class="font-medium">Top Cities:</div>
              ${sortedCities.map(city =>
                `<div class="pl-2">• ${city.city}: ${city.count}</div>`
              ).join('')}
            </div>
          </div>
        `;
      }
    }
  };

  // Create heatmap for top cities
  const topCities = currentData
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const heatmapOptions: ApexOptions = {
    chart: {
      type: 'bar',
      height: 350,
      toolbar: {
        show: false
      },
      zoom: {
        enabled: false
      }
    },
    plotOptions: {
      bar: {
        horizontal: true,
        distributed: true,
        dataLabels: {
          position: 'bottom'
        }
      }
    },
    colors: viewType === 'attended'
      ? ['#064E3B', '#065F46', '#047857', '#059669', '#10B981', '#34D399', '#6EE7B7', '#A7F3D0', '#D1FAE5']
      : viewType === 'registered'
      ? ['#4C1D95', '#5B21B6', '#6D28D9', '#7C3AED', '#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE', '#EDE9FE']
      : ['#1E3A8A', '#1E40AF', '#1D4ED8', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE'],
    dataLabels: {
      enabled: true,
      formatter: function(val: string | number) {
        return val + ' codes';
      },
      style: {
        colors: ['#fff'],
        fontSize: '11px'
      }
    },
    xaxis: {
      categories: topCities.map(c => {
        const city = c.city || 'Unknown City';
        const country = c.country || 'Unknown Country';
        return `${city}, ${country}`;
      }),
      labels: {
        style: {
          fontSize: '11px'
        }
      }
    },
    yaxis: {
      labels: {
        style: {
          fontSize: '11px'
        }
      }
    },
    grid: {
      xaxis: {
        lines: {
          show: true
        }
      }
    },
    tooltip: {
      y: {
        formatter: function(val: number) {
          return val + ' codes';
        }
      }
    }
  };

  const heatmapSeries = [{
    name: viewType === 'attended' ? 'Attended' : viewType === 'registered' ? 'Registered' : 'Claimed',
    data: topCities.map(c => c.count)
  }];

  return (
    <div className="space-y-6">
      {/* View Type Selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Geographic Distribution</h3>
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

      {/* Country Treemap */}
      <div>
        <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Distribution by Country</h4>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
          {currentData.length > 0 ? (
            <ReactApexChart
              options={treemapOptions}
              series={treemapSeries}
              type="treemap"
              height={400}
            />
          ) : (
            <div className="flex items-center justify-center h-[400px] text-gray-500">
              No location data available
            </div>
          )}
        </div>
      </div>

      {/* Top Cities Bar Chart */}
      {topCities.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Top 15 Cities</h4>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
            <ReactApexChart
              options={heatmapOptions}
              series={heatmapSeries}
              type="bar"
              height={350}
            />
          </div>
        </div>
      )}

      {/* Geographic Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Countries</div>
          <div className="text-2xl font-bold mt-1">{Object.keys(countryData).length}</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Cities</div>
          <div className="text-2xl font-bold mt-1">
            {new Set(currentData.map(d => d.city)).size}
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Top Country</div>
          <div className="text-lg font-bold mt-1">
            {Object.entries(countryData).sort((a, b) => b[1].total - a[1].total)[0]?.[0] || 'N/A'}
          </div>
        </div>
      </div>
    </div>
  );
}