import { useState, useEffect, useCallback, useMemo } from 'react';
import { ModulesProvider as ContextProvider } from './context';
import type { ModuleUpdateInfo, ActiveThemeModule } from './context';
import { supabase } from '@/lib/supabase';
import modules from 'virtual:gatewaze-modules';
import type { InstalledModuleRow } from '@gatewaze/shared/modules';
import { ModuleService } from '@/utils/moduleService';

interface Props {
  children: React.ReactNode;
}

/**
 * Provides runtime module-enabled state from the installed_modules DB table.
 *
 * On mount it fetches the DB rows. For any bundled module that does not yet
 * have a row, it inserts one with status 'disabled' (the admin can then
 * enable it from the Modules page).
 */
export function ModulesProviderWrapper({ children }: Props) {
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<InstalledModuleRow[]>([]);
  const [availableUpdates, setAvailableUpdates] = useState<ModuleUpdateInfo[]>([]);

  const fetchAndSeed = useCallback(async () => {
    // 1. Check for an active session — skip if not authenticated
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setRows([]);
      setReady(true);
      return;
    }

    // 2. Fetch current DB state
    const { data, error } = await supabase
      .from('installed_modules')
      .select('*');

    if (error) {
      console.error('[modules] Failed to fetch installed_modules:', error);
      // Fall back to empty — all modules disabled
      setRows([]);
      setReady(true);
      return;
    }

    const existing = (data ?? []) as InstalledModuleRow[];
    const existingIds = new Set(existing.map((r) => r.id));

    // 3. Seed any bundled modules that are missing from the DB
    const missing = modules.filter((m) => !existingIds.has(m.id));

    if (missing.length > 0) {
      const newRows = missing.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        features: m.features,
        status: 'disabled' as const,
        config: {},
        type: m.type ?? 'feature',
        source: 'bundled',
        visibility: m.visibility ?? 'public',
        description: m.description,
      }));

      const { data: inserted, error: insertError } = await supabase
        .from('installed_modules')
        .upsert(newRows, { onConflict: 'id' })
        .select('*');

      if (insertError) {
        console.error('[modules] Failed to seed modules:', insertError);
      }

      if (inserted) {
        existing.push(...(inserted as InstalledModuleRow[]));
      }
    }

    setRows(existing);
    setReady(true);
  }, []);

  useEffect(() => {
    fetchAndSeed();
  }, [fetchAndSeed]);

  const enabledIds = useMemo(
    () => new Set(rows.filter((r) => r.status === 'enabled').map((r) => r.id)),
    [rows],
  );

  const enabledFeatures = useMemo(() => {
    const features = new Set<string>();
    for (const mod of modules) {
      if (enabledIds.has(mod.id)) {
        for (const f of mod.features) {
          features.add(f);
        }
      }
    }
    return features;
  }, [enabledIds]);

  const activeThemeModule = useMemo<ActiveThemeModule | null>(() => {
    for (const mod of modules) {
      if (mod.type === 'theme' && enabledIds.has(mod.id) && mod.themeOverrides) {
        return { id: mod.id, name: mod.name, themeOverrides: mod.themeOverrides };
      }
    }
    return null;
  }, [enabledIds]);

  const checkUpdates = useCallback(async () => {
    try {
      const { updates } = await ModuleService.checkUpdates();
      setAvailableUpdates(updates);
    } catch {
      // Silently fail — update checks are non-critical
    }
  }, []);

  // Check for updates after initial load
  useEffect(() => {
    if (ready && rows.length > 0) {
      checkUpdates();
    }
  }, [ready, rows.length, checkUpdates]);

  const isModuleEnabled = useCallback(
    (moduleId: string) => enabledIds.has(moduleId),
    [enabledIds],
  );

  const isFeatureEnabled = useCallback(
    (feature: string) => enabledFeatures.has(feature),
    [enabledFeatures],
  );

  const value = useMemo(
    () => ({
      ready,
      isModuleEnabled,
      isFeatureEnabled,
      activeThemeModule,
      refresh: async () => { await fetchAndSeed(); await checkUpdates(); },
      availableUpdates,
      checkUpdates,
    }),
    [ready, isModuleEnabled, isFeatureEnabled, activeThemeModule, fetchAndSeed, availableUpdates, checkUpdates],
  );

  return <ContextProvider value={value}>{children}</ContextProvider>;
}
