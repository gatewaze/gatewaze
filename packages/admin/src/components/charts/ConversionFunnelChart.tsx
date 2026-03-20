import ReactApexChart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';
import { useEffect } from 'react';

interface ConversionFunnelChartProps {
  total: number;
  claimed: number;
  registered: number;
  attended: number;
}

export function ConversionFunnelChart({
  total,
  claimed,
  registered,
  attended
}: ConversionFunnelChartProps) {

  // Calculate percentages and drop-offs
  const registeredRate = claimed > 0 ? (registered / claimed) * 100 : 0;
  const attendedRate = registered > 0 ? (attended / registered) * 100 : 0;
  const overallConversion = claimed > 0 ? (attended / claimed) * 100 : 0;

  const claimedToRegisteredDrop = 100 - registeredRate;
  const registeredToAttendedDrop = 100 - attendedRate;

  // Funnel chart configuration
  const funnelOptions: ApexOptions = {
    chart: {
      type: 'bar',
      height: 350,
      toolbar: {
        show: false
      },
      fontFamily: 'inherit',
      zoom: {
        enabled: false
      },
      events: {
        mounted: function(chartContext: any, config: any) {
          // Disable mouse wheel events to prevent interference with page scrolling
          const chartElement = document.querySelector('.funnel-chart-white-labels');
          if (chartElement) {
            chartElement.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
          }
        }
      }
    },
    plotOptions: {
      bar: {
        borderRadius: 0,
        horizontal: true,
        barHeight: '80%',
        isFunnel: true,
        distributed: true,
        dataLabels: {
          position: 'center'
        }
      }
    },
    colors: ['#3B82F6', '#8B5CF6', '#10B981'],
    dataLabels: {
      enabled: true,
      textAnchor: 'middle',
      distributed: false,
      formatter: function(val, opt) {
        const labels = ['Claimed', 'Registered', 'Attended'];
        const values = [claimed, registered, attended];
        const currentValue = values[opt.dataPointIndex];
        const percent = claimed > 0 ? (currentValue / claimed * 100).toFixed(1) : '0';

        return labels[opt.dataPointIndex] + ': ' + currentValue + ' (' + percent + '%)';
      },
      style: {
        fontSize: '14px',
        fontFamily: 'inherit',
        fontWeight: 'bold',
        colors: undefined // Let it inherit default behavior
      },
      offsetY: 0,
      dropShadow: {
        enabled: false
      }
    },
    fill: {
      opacity: 1
    },
    xaxis: {
      categories: ['Claimed', 'Registered', 'Attended'],
      labels: {
        show: false
      }
    },
    yaxis: {
      labels: {
        style: {
          fontSize: '12px'
        }
      }
    },
    grid: {
      borderColor: '#f1f1f1',
      padding: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
      }
    },
    legend: {
      show: false
    },
    tooltip: {
      enabled: true,
      y: {
        formatter: function(value, { dataPointIndex }) {
          const stages = [
            { name: 'Claimed', prev: null, current: claimed },
            { name: 'Registered', prev: claimed, current: registered },
            { name: 'Attended', prev: registered, current: attended }
          ];

          const stage = stages[dataPointIndex];
          const dropOff = stage.prev !== null ? stage.prev - stage.current : 0;
          const conversionRate = stage.prev !== null && stage.prev > 0
            ? ((stage.current / stage.prev) * 100).toFixed(1)
            : '100';
          const dropOffRate = stage.prev !== null && stage.prev > 0
            ? ((dropOff / stage.prev) * 100).toFixed(1)
            : '0';

          return stage.prev !== null
            ? `${value} codes | Conversion: ${conversionRate}% | Drop-off: ${dropOffRate}%`
            : `${value} codes (Starting point)`;
        }
      },
      custom: undefined
    }
  };

  const funnelSeries = [{
    name: 'Conversion Funnel',
    data: [claimed, registered, attended]
  }];

  useEffect(() => {
    // Force white text color on data labels after chart renders
    const style = document.createElement('style');
    style.textContent = `
      .funnel-chart-white-labels .apexcharts-text.apexcharts-datalabel-value {
        fill: #ffffff !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Funnel Visualization */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Conversion Funnel</h4>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg funnel-chart-white-labels">
          <ReactApexChart
            options={funnelOptions}
            series={funnelSeries}
            type="bar"
            height={300}
          />
        </div>
      </div>

      {/* Conversion Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
          <div className="text-xs font-medium text-purple-700 dark:text-purple-300 uppercase">
            Registration Rate
          </div>
          <div className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-1">
            {registeredRate.toFixed(1)}%
          </div>
          <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">
            {registered} of {claimed} claimed
          </div>
        </div>

        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
          <div className="text-xs font-medium text-green-700 dark:text-green-300 uppercase">
            Attendance Rate
          </div>
          <div className="text-2xl font-bold text-green-900 dark:text-green-100 mt-1">
            {attendedRate.toFixed(1)}%
          </div>
          <div className="text-xs text-green-600 dark:text-green-400 mt-1">
            {attended} of {registered} registered
          </div>
        </div>
      </div>
    </div>
  );
}