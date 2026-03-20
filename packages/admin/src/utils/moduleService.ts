import { supabase } from '@/lib/supabase';
import type { InstalledModuleRow, ModuleSourceRow } from '@gatewaze/shared/modules';

export interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  features: string[];
  status: 'enabled' | 'disabled' | 'not_installed';
  installed_at?: string;
  updated_at?: string;
}

export class ModuleService {
  static async getInstalledModules(): Promise<{
    modules: InstalledModuleRow[] | null;
    error: string | null;
  }> {
    try {
      const { data, error } = await supabase
        .from('installed_modules')
        .select('*')
        .order('installed_at', { ascending: false });

      if (error) {
        console.error('Error fetching installed modules:', error);
        return { modules: null, error: error.message };
      }

      return { modules: data as InstalledModuleRow[], error: null };
    } catch (error) {
      console.error('Error fetching installed modules:', error);
      return {
        modules: null,
        error: error instanceof Error ? error.message : 'Failed to fetch modules',
      };
    }
  }

  static async enableModule(
    moduleId: string
  ): Promise<{ success: boolean; migrationsApplied?: string[]; edgeFunctionsDeployed?: string[]; error?: string }> {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiUrl}/api/modules/${moduleId}/enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, error: body.error ?? `Failed (${res.status})` };
      }

      return {
        success: true,
        migrationsApplied: body.migrationsApplied,
        edgeFunctionsDeployed: body.edgeFunctionsDeployed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to enable module',
      };
    }
  }

  static async installCustomModule(module: {
    id: string;
    name: string;
    description: string;
    version: string;
    type: string;
    visibility: string;
    features: string[];
    source: string;
    config?: Record<string, unknown>;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('installed_modules')
        .upsert(
          {
            id: module.id,
            name: module.name,
            description: module.description,
            version: module.version,
            type: module.type,
            visibility: module.visibility,
            features: module.features,
            source: module.source,
            status: 'enabled',
            config: module.config ?? {},
          },
          { onConflict: 'id' }
        );

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to install module',
      };
    }
  }

  /**
   * Trigger server-side module reconciliation.
   * Applies pending migrations and runs lifecycle hooks.
   */
  static async reconcileModules(): Promise<{
    success: boolean;
    modules?: { id: string; name: string; status: string }[];
    error?: string;
  }> {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiUrl}/api/modules/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return {
          success: false,
          error: body.error ?? `Reconciliation failed (${res.status})`,
        };
      }

      const body = await res.json();
      return { success: true, modules: body.modules };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reconcile modules',
      };
    }
  }

  static async disableModule(
    moduleId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiUrl}/api/modules/${moduleId}/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, error: body.error ?? `Failed (${res.status})` };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disable module',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Module Updates
  // ---------------------------------------------------------------------------

  static async checkUpdates(): Promise<{
    updates: { id: string; name: string; installedVersion: string; availableVersion: string; minPlatformVersion?: string; platformCompatible: boolean }[];
    platformVersion?: string;
    error: string | null;
  }> {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiUrl}/api/modules/check-updates`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { updates: [], error: body.error ?? `Failed (${res.status})` };
      }
      return { updates: body.updates ?? [], platformVersion: body.platformVersion, error: null };
    } catch (error) {
      return {
        updates: [],
        error: error instanceof Error ? error.message : 'Failed to check updates',
      };
    }
  }

  static async updateModule(moduleId: string): Promise<{
    success: boolean;
    newVersion?: string;
    previousVersion?: string;
    edgeFunctionsDeployed?: string[];
    error?: string;
  }> {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiUrl}/api/modules/${moduleId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, error: body.error ?? `Failed (${res.status})` };
      }

      return {
        success: true,
        newVersion: body.module?.newVersion,
        previousVersion: body.module?.previousVersion,
        edgeFunctionsDeployed: body.edgeFunctionsDeployed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update module',
      };
    }
  }

  static async updateAllModules(): Promise<{
    success: boolean;
    updated?: { id: string; name: string; previousVersion: string; newVersion: string }[];
    edgeFunctionsDeployed?: string[];
    error?: string;
  }> {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiUrl}/api/modules/update-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, error: body.error ?? `Failed (${res.status})` };
      }

      return {
        success: true,
        updated: body.updated,
        edgeFunctionsDeployed: body.edgeFunctionsDeployed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update modules',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Module Sources
  // ---------------------------------------------------------------------------

  static async getModuleSources(): Promise<{
    sources: ModuleSourceRow[] | null;
    error: string | null;
  }> {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiUrl}/api/modules/sources`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { sources: null, error: body.error ?? `Failed (${res.status})` };
      }
      const body = await res.json();
      return { sources: body.sources, error: null };
    } catch (error) {
      return {
        sources: null,
        error: error instanceof Error ? error.message : 'Failed to fetch sources',
      };
    }
  }

  static async addModuleSource(source: {
    url: string;
    path?: string;
    branch?: string;
    label?: string;
  }): Promise<{ success: boolean; source?: ModuleSourceRow; error?: string }> {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiUrl}/api/modules/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(source),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { success: false, error: body.error ?? `Failed (${res.status})` };
      }

      const body = await res.json();
      return { success: true, source: body.source };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add source',
      };
    }
  }

  static async removeModuleSource(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiUrl}/api/modules/sources/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { success: false, error: body.error ?? `Failed (${res.status})` };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove source',
      };
    }
  }

  static async saveModuleConfig(
    moduleId: string,
    config: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiUrl}/api/modules/${moduleId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, error: body.error ?? `Failed (${res.status})` };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save config',
      };
    }
  }

  static async uploadModule(
    file: File
  ): Promise<{ success: boolean; slug?: string; error?: string }> {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${apiUrl}/api/modules/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { success: false, error: body.error ?? `Upload failed (${res.status})` };
      }

      const body = await res.json();
      return { success: true, slug: body.slug };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }
}
