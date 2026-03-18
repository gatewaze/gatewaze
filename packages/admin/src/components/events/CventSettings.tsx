// @ts-nocheck
import { useState, useEffect } from 'react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Button, Card, Input } from '@/components/ui-legacy';
import { supabase } from '@/lib/supabase';

interface CventConfig {
  cvent_event_id: string | null;
  cvent_event_code: string | null;
  cvent_admission_item_id: string | null;
  cvent_sync_enabled: boolean;
}

interface AdmissionItem {
  id: string;
  name: string;
  code?: string;
}

interface Registrant {
  id: string;
  email: string;
  name: string;
}

interface CventSettingsProps {
  eventId: string;
}

export function CventSettings({ eventId }: CventSettingsProps) {
  const [config, setConfig] = useState<CventConfig>({
    cvent_event_id: null,
    cvent_event_code: null,
    cvent_admission_item_id: null,
    cvent_sync_enabled: false,
  });
  const [admissionItems, setAdmissionItems] = useState<AdmissionItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{
    synced: number;
    already_exists: number;
    errors: string[];
    total: number;
  } | null>(null);

  // Test sync: single registrant
  const [registrants, setRegistrants] = useState<Registrant[]>([]);
  const [registrantSearch, setRegistrantSearch] = useState('');
  const [selectedRegistrantId, setSelectedRegistrantId] = useState('');
  const [testSyncing, setTestSyncing] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; action?: string; error?: string } | null>(null);

  // Load current config from the events table
  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('events')
        .select('cvent_event_id, cvent_event_code, cvent_admission_item_id, cvent_sync_enabled')
        .eq('event_id', eventId)
        .maybeSingle();

      if (error) {
        console.error('Failed to load Cvent config:', error);
        return;
      }
      if (data) {
        setConfig({
          cvent_event_id: data.cvent_event_id ?? null,
          cvent_event_code: data.cvent_event_code ?? null,
          cvent_admission_item_id: data.cvent_admission_item_id ?? null,
          cvent_sync_enabled: data.cvent_sync_enabled ?? false,
        });
      }
    }
    load();
  }, [eventId]);

  // Fetch admission items from Cvent via edge function
  async function fetchAdmissionItems() {
    if (!config.cvent_event_id) {
      toast.error('Enter a Cvent Event ID first');
      return;
    }
    setLoadingItems(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('cvent-sync', {
        body: { event_id: eventId, action: 'admission-items' },
      });

      if (error) throw error;

      if (result?.success && result.items?.length > 0) {
        setAdmissionItems(result.items);
      } else if (result?.success && result.items?.length === 0) {
        toast.warning('No admission items found — enter the ID manually (find it in Cvent → Event → Registration Setup → Admission Items)');
      } else {
        // Likely a token header size issue with Cvent's nginx proxy — guide user to enter manually
        toast.error(
          'Could not auto-fetch from Cvent API. Paste the Admission Item ID manually — find it in Cvent dashboard → your event → Registration Setup → Admission Items.'
        );
      }
    } catch (err: any) {
      toast.error('Failed to connect to Cvent: ' + err.message);
    } finally {
      setLoadingItems(false);
    }
  }

  // Search registrants by email/name for the test sync picker.
  // We search at the DB level (customers table) to avoid the "first 10 rows only" problem.
  useEffect(() => {
    if (registrantSearch.length < 2) {
      setRegistrants([]);
      return;
    }
    const term = registrantSearch.toLowerCase();
    const timer = setTimeout(async () => {
      // Step 1: find customers matching the search term by email or name attributes
      const { data: matchingCustomers } = await supabase
        .from('customers')
        .select('id, email, attributes')
        .or(
          `email.ilike.%${term}%,` +
          `attributes->>first_name.ilike.%${term}%,` +
          `attributes->>last_name.ilike.%${term}%`
        )
        .limit(20);

      if (!matchingCustomers?.length) {
        setRegistrants([]);
        return;
      }

      // Step 2: find their member_profiles
      const { data: profiles } = await supabase
        .from('member_profiles')
        .select('id, customer_id')
        .in('customer_id', matchingCustomers.map((c) => c.id));

      if (!profiles?.length) {
        setRegistrants([]);
        return;
      }

      // Step 3: find registrations for this event for those profiles
      const profileIds = profiles.map((p) => p.id);
      const { data: regs } = await supabase
        .from('event_registrations')
        .select('id, member_profile_id')
        .eq('event_id', eventId)
        .in('status', ['confirmed', 'pending', 'waitlist'])
        .in('member_profile_id', profileIds)
        .limit(10);

      if (regs?.length) {
        const profileMap = new Map(profiles.map((p) => [p.id, p.customer_id]));
        const customerMap = new Map(matchingCustomers.map((c) => [c.id, c]));

        const results = regs.map((reg) => {
          const customerId = profileMap.get(reg.member_profile_id);
          const customer = customerId ? customerMap.get(customerId) : null;
          const attrs = (customer?.attributes || {}) as Record<string, any>;
          const name = [attrs.first_name, attrs.last_name].filter(Boolean).join(' ') || customer?.email || '';
          return { id: reg.id, email: customer?.email || '', name };
        });
        setRegistrants(results);
      } else {
        setRegistrants([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [registrantSearch, eventId]);

  async function testSyncRegistrant() {
    if (!selectedRegistrantId) {
      toast.error('Select a registrant first');
      return;
    }
    setTestSyncing(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('cvent-sync', {
        body: { registration_id: selectedRegistrantId, force: true },
      });
      if (error) throw error;
      setTestResult({ success: data?.success, action: data?.action, error: data?.error });
      if (data?.success) {
        toast.success(data.action === 'already_exists' ? 'Already in Cvent ✓' : 'Synced to Cvent ✓');
      } else {
        toast.error(data?.error || 'Sync failed');
      }
    } catch (err: any) {
      toast.error('Test sync error: ' + err.message);
      setTestResult({ success: false, error: err.message });
    } finally {
      setTestSyncing(false);
    }
  }

  // Save config to the events table
  async function save() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('events')
        .update({
          cvent_event_id: config.cvent_event_id || null,
          cvent_event_code: config.cvent_event_code || null,
          cvent_admission_item_id: config.cvent_admission_item_id || null,
          cvent_sync_enabled: config.cvent_sync_enabled,
        })
        .eq('event_id', eventId);

      if (error) throw error;
      toast.success('Cvent settings saved');
    } catch (err: any) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  // Backfill all existing registrants to Cvent
  async function backfill() {
    if (!config.cvent_event_id) {
      toast.error('Save a Cvent Event ID first');
      return;
    }
    if (!config.cvent_admission_item_id) {
      toast.error('Select an admission item first');
      return;
    }

    setBackfilling(true);
    setBackfillResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('cvent-sync', {
        body: { event_id: eventId },
      });

      if (error) throw error;

      if (data?.success) {
        setBackfillResult({
          synced: data.synced ?? 0,
          already_exists: data.already_exists ?? 0,
          errors: data.errors ?? [],
          total: data.total ?? 0,
        });
        toast.success(data.message || 'Backfill complete');
      } else {
        toast.error(data?.error || 'Backfill failed');
      }
    } catch (err: any) {
      toast.error('Backfill error: ' + err.message);
    } finally {
      setBackfilling(false);
    }
  }

  const isConfigured = !!config.cvent_event_id && !!config.cvent_admission_item_id;

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="text-xl">🏷️</span>
            Cvent Badge Printing
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Sync registrants to Cvent for on-site badge printing
          </p>
        </div>
        <div className="flex items-center gap-2">
          {config.cvent_sync_enabled ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2.5 py-1 rounded-full">
              <CheckCircleIcon className="w-3.5 h-3.5" />
              Live sync on
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-full">
              Sync off
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Cvent Event ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Cvent Event ID
          </label>
          <Input
            value={config.cvent_event_id ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, cvent_event_id: e.target.value || null }))}
            placeholder="7685bda5-094c-47b1-a272-eaf5e6936587"
            className="font-mono text-sm"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            UUID from the Cvent event URL or event settings
          </p>
        </div>

        {/* Cvent Event Code */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Cvent Event Code
          </label>
          <Input
            value={config.cvent_event_code ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, cvent_event_code: e.target.value || null }))}
            placeholder="7CND3JC7G2G"
            className="font-mono text-sm"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Short code shown in Cvent (display only, not used in API calls)
          </p>
        </div>

        {/* Admission Item */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Admission Item
          </label>
          <div className="flex gap-2">
            {admissionItems.length > 0 ? (
              <select
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={config.cvent_admission_item_id ?? ''}
                onChange={(e) => setConfig((c) => ({ ...c, cvent_admission_item_id: e.target.value || null }))}
              >
                <option value="">— select admission item —</option>
                {admissionItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.code ? ` (${item.code})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={config.cvent_admission_item_id ?? ''}
                onChange={(e) => setConfig((c) => ({ ...c, cvent_admission_item_id: e.target.value || null }))}
                placeholder="Paste item ID, or click Fetch to load from Cvent"
                className="flex-1 font-mono text-sm"
              />
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={fetchAdmissionItems}
              isLoading={loadingItems}
              disabled={!config.cvent_event_id}
            >
              Fetch
            </Button>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            The ticket type registrants will be assigned in Cvent. Click Fetch to load from the event.
          </p>
        </div>

        {/* Live sync toggle */}
        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Live sync</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Automatically push new Luma registrations to Cvent in real time
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.cvent_sync_enabled}
            onClick={() => setConfig((c) => ({ ...c, cvent_sync_enabled: !c.cvent_sync_enabled }))}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
              config.cvent_sync_enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                config.cvent_sync_enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {!isConfigured && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl text-amber-700 dark:text-amber-400 text-xs">
            <InformationCircleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>Save a Cvent Event ID and select an admission item before enabling live sync or running a backfill.</span>
          </div>
        )}

        {/* Save button */}
        <Button onClick={save} isLoading={saving} className="w-full">
          Save Cvent Settings
        </Button>

        {/* Backfill section */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Backfill existing registrants</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Push all confirmed registrants for this event to Cvent now. Safe to run multiple times — duplicates are skipped.
              </p>
            </div>
          </div>

          {/* Test: sync a single registrant */}
          <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl space-y-2">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Test with a single registrant</p>
            <div className="relative">
              <Input
                value={registrantSearch}
                onChange={(e) => { setRegistrantSearch(e.target.value); setSelectedRegistrantId(''); setTestResult(null); }}
                placeholder="Search by email or name…"
                className="text-sm"
              />
              {registrants.length > 0 && !selectedRegistrantId && (
                <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {registrants.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
                      onClick={() => { setSelectedRegistrantId(r.id); setRegistrantSearch(`${r.name} <${r.email}>`); setRegistrants([]); }}
                    >
                      <span className="font-medium text-gray-900 dark:text-white">{r.name || r.email}</span>
                      {r.name && <span className="text-gray-500 dark:text-gray-400 ml-1 text-xs">{r.email}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={testSyncRegistrant}
              isLoading={testSyncing}
              disabled={!selectedRegistrantId || !isConfigured}
              className="w-full"
            >
              Test Sync to Cvent
            </Button>
            {testResult && (
              <div className={`text-xs px-2 py-1.5 rounded-lg flex items-center gap-1.5 ${
                testResult.success
                  ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                  : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
              }`}>
                {testResult.success
                  ? <><CheckCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />{testResult.action === 'already_exists' ? 'Already in Cvent' : 'Successfully synced to Cvent'}</>
                  : <><ExclamationCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />{testResult.error}</>
                }
              </div>
            )}
          </div>

          <Button
            variant="secondary"
            onClick={backfill}
            isLoading={backfilling}
            disabled={!isConfigured}
            className="w-full"
            icon={<ArrowPathIcon className="w-4 h-4" />}
          >
            {backfilling ? 'Syncing to Cvent…' : 'Backfill All Registrants'}
          </Button>

          {backfillResult && (
            <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                <CheckCircleIcon className="w-4 h-4 text-green-500" />
                Backfill complete — {backfillResult.total} registrants processed
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5 pl-6">
                <p>✓ {backfillResult.synced} newly synced to Cvent</p>
                <p>↩ {backfillResult.already_exists} already existed in Cvent</p>
                {backfillResult.errors.length > 0 && (
                  <div className="mt-1">
                    <p className="text-red-500 dark:text-red-400 font-medium flex items-center gap-1">
                      <ExclamationCircleIcon className="w-3.5 h-3.5" />
                      {backfillResult.errors.length} error{backfillResult.errors.length !== 1 ? 's' : ''}:
                    </p>
                    <ul className="mt-0.5 space-y-0.5">
                      {backfillResult.errors.slice(0, 5).map((e, i) => (
                        <li key={i} className="text-red-400 dark:text-red-500">{e}</li>
                      ))}
                      {backfillResult.errors.length > 5 && (
                        <li className="text-gray-400">…and {backfillResult.errors.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
