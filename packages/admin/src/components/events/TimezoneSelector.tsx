import React from 'react';

// Common IANA timezone identifiers grouped by region
const TIMEZONES = [
  // UTC
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)', offset: '+00:00' },

  // Americas
  { value: 'America/New_York', label: 'America/New York (Eastern Time)', offset: '-05:00' },
  { value: 'America/Chicago', label: 'America/Chicago (Central Time)', offset: '-06:00' },
  { value: 'America/Denver', label: 'America/Denver (Mountain Time)', offset: '-07:00' },
  { value: 'America/Phoenix', label: 'America/Phoenix (Mountain Time - no DST)', offset: '-07:00' },
  { value: 'America/Los_Angeles', label: 'America/Los Angeles (Pacific Time)', offset: '-08:00' },
  { value: 'America/Anchorage', label: 'America/Anchorage (Alaska Time)', offset: '-09:00' },
  { value: 'Pacific/Honolulu', label: 'Pacific/Honolulu (Hawaii Time)', offset: '-10:00' },
  { value: 'America/Toronto', label: 'America/Toronto (Eastern Time)', offset: '-05:00' },
  { value: 'America/Vancouver', label: 'America/Vancouver (Pacific Time)', offset: '-08:00' },
  { value: 'America/Mexico_City', label: 'America/Mexico City', offset: '-06:00' },
  { value: 'America/Sao_Paulo', label: 'America/Sao Paulo', offset: '-03:00' },
  { value: 'America/Buenos_Aires', label: 'America/Buenos Aires', offset: '-03:00' },

  // Europe
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)', offset: '+00:00' },
  { value: 'Europe/Dublin', label: 'Europe/Dublin (GMT/IST)', offset: '+00:00' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)', offset: '+01:00' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET/CEST)', offset: '+01:00' },
  { value: 'Europe/Amsterdam', label: 'Europe/Amsterdam (CET/CEST)', offset: '+01:00' },
  { value: 'Europe/Brussels', label: 'Europe/Brussels (CET/CEST)', offset: '+01:00' },
  { value: 'Europe/Madrid', label: 'Europe/Madrid (CET/CEST)', offset: '+01:00' },
  { value: 'Europe/Rome', label: 'Europe/Rome (CET/CEST)', offset: '+01:00' },
  { value: 'Europe/Zurich', label: 'Europe/Zurich (CET/CEST)', offset: '+01:00' },
  { value: 'Europe/Stockholm', label: 'Europe/Stockholm (CET/CEST)', offset: '+01:00' },
  { value: 'Europe/Warsaw', label: 'Europe/Warsaw (CET/CEST)', offset: '+01:00' },
  { value: 'Europe/Athens', label: 'Europe/Athens (EET/EEST)', offset: '+02:00' },
  { value: 'Europe/Helsinki', label: 'Europe/Helsinki (EET/EEST)', offset: '+02:00' },
  { value: 'Europe/Istanbul', label: 'Europe/Istanbul (TRT)', offset: '+03:00' },
  { value: 'Europe/Moscow', label: 'Europe/Moscow (MSK)', offset: '+03:00' },

  // Asia
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)', offset: '+04:00' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)', offset: '+05:30' },
  { value: 'Asia/Bangkok', label: 'Asia/Bangkok (ICT)', offset: '+07:00' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)', offset: '+08:00' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong Kong (HKT)', offset: '+08:00' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)', offset: '+08:00' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)', offset: '+09:00' },
  { value: 'Asia/Seoul', label: 'Asia/Seoul (KST)', offset: '+09:00' },
  { value: 'Asia/Taipei', label: 'Asia/Taipei (CST)', offset: '+08:00' },
  { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB)', offset: '+07:00' },

  // Australia & Pacific
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)', offset: '+10:00' },
  { value: 'Australia/Melbourne', label: 'Australia/Melbourne (AEST/AEDT)', offset: '+10:00' },
  { value: 'Australia/Brisbane', label: 'Australia/Brisbane (AEST)', offset: '+10:00' },
  { value: 'Australia/Perth', label: 'Australia/Perth (AWST)', offset: '+08:00' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT)', offset: '+12:00' },

  // Africa & Middle East
  { value: 'Africa/Cairo', label: 'Africa/Cairo (EET)', offset: '+02:00' },
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST)', offset: '+02:00' },
  { value: 'Africa/Nairobi', label: 'Africa/Nairobi (EAT)', offset: '+03:00' },
  { value: 'Africa/Lagos', label: 'Africa/Lagos (WAT)', offset: '+01:00' },
];

interface TimezoneSelectorProps {
  value?: string;
  onChange: (timezone: string) => void;
  error?: string;
  disabled?: boolean;
}

export const TimezoneSelector: React.FC<TimezoneSelectorProps> = ({
  value = 'UTC',
  onChange,
  error,
  disabled = false,
}) => {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        Timezone
      </label>
      <select
        value={value || 'UTC'}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white
          ${error ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          focus:ring-2 focus:ring-primary-500 focus:border-transparent`}
      >
        <optgroup label="UTC">
          <option value="UTC">UTC (Coordinated Universal Time) +00:00</option>
        </optgroup>

        <optgroup label="Americas">
          {TIMEZONES.filter(tz => tz.value.startsWith('America/') || tz.value.startsWith('Pacific/Honolulu')).map(tz => (
            <option key={tz.value} value={tz.value}>
              {tz.label} {tz.offset}
            </option>
          ))}
        </optgroup>

        <optgroup label="Europe">
          {TIMEZONES.filter(tz => tz.value.startsWith('Europe/')).map(tz => (
            <option key={tz.value} value={tz.value}>
              {tz.label} {tz.offset}
            </option>
          ))}
        </optgroup>

        <optgroup label="Asia">
          {TIMEZONES.filter(tz => tz.value.startsWith('Asia/')).map(tz => (
            <option key={tz.value} value={tz.value}>
              {tz.label} {tz.offset}
            </option>
          ))}
        </optgroup>

        <optgroup label="Australia & Pacific">
          {TIMEZONES.filter(tz => tz.value.startsWith('Australia/') || tz.value.startsWith('Pacific/Auckland')).map(tz => (
            <option key={tz.value} value={tz.value}>
              {tz.label} {tz.offset}
            </option>
          ))}
        </optgroup>

        <optgroup label="Africa & Middle East">
          {TIMEZONES.filter(tz => tz.value.startsWith('Africa/')).map(tz => (
            <option key={tz.value} value={tz.value}>
              {tz.label} {tz.offset}
            </option>
          ))}
        </optgroup>
      </select>
      {error && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
};
