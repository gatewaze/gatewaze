import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

interface AppSettings {
  appName: string;
  isLoading: boolean;
}

// VITE_APP_NAME env var overrides the DB value (set via GW_APP_NAME in docker-compose)
const envAppName = import.meta.env.VITE_APP_NAME || null;
let cachedAppName: string | null = envAppName;

export function useAppSettings(): AppSettings {
  const [appName, setAppName] = useState(cachedAppName ?? 'Gatewaze');
  const [isLoading, setIsLoading] = useState(cachedAppName === null);

  useEffect(() => {
    // If env var or cache is set, skip DB query
    if (cachedAppName !== null) return;

    const fetchSettings = async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'app_name')
          .maybeSingle();

        const name = data?.value ?? 'Gatewaze';
        cachedAppName = name;
        setAppName(name);
      } catch {
        cachedAppName = 'Gatewaze';
        setAppName('Gatewaze');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, []);

  return { appName, isLoading };
}
