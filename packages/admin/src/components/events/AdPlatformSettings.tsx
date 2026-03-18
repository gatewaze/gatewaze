// @ts-nocheck
import { useState, useEffect } from 'react';
import {
  Cog6ToothIcon,
  CheckCircleIcon,
  XCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  InformationCircleIcon,
  ClipboardDocumentIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Button, Card, Input } from '@/components/ui-legacy';
import { supabase } from '@/lib/supabase';
import { getBrandId } from '@/utils/brandUtils';

interface AdPlatformConfig {
  id: string;
  platform: string;
  credentials: Record<string, string>;
  is_active: boolean;
  attribution_window_days: number;
  event_mapping: Record<string, string>;
}

interface AdPlatformSettingsProps {
  eventId?: string;
  accountId?: string;
  eventSlug?: string | null;
}

const PLATFORMS = [
  {
    id: 'meta',
    name: 'Meta (Facebook/Instagram)',
    description: 'Send conversions to Meta Conversions API',
    fields: [
      { key: 'pixel_id', label: 'Pixel ID', placeholder: '123456789012345', type: 'text' },
      { key: 'access_token', label: 'Access Token', placeholder: 'EAA...', type: 'password' },
      { key: 'test_event_code', label: 'Test Event Code (Optional)', placeholder: 'TEST12345', type: 'text' },
    ],
    helpUrl: 'https://developers.facebook.com/docs/marketing-api/conversions-api/get-started',
    urlTemplate: (baseUrl: string) =>
      `${baseUrl}?utm_source={{site_source_name}}&utm_medium=cpm&utm_campaign={{campaign.name}}&utm_content={{adset.name}}%7C{{ad.name}}`,
    urlParamLabel: 'Ad URL Parameters',
    urlParamDescription: 'Paste this into the "URL parameters" field at the ad level in Meta Ads Manager.',
    urlParamsOnly: (baseUrl: string) =>
      `utm_source={{site_source_name}}&utm_medium=cpm&utm_campaign={{campaign.name}}&utm_content={{adset.name}}%7C{{ad.name}}`,
  },
  {
    id: 'google',
    name: 'Google Ads',
    description: 'Coming soon - Google Ads offline conversions',
    fields: [],
    disabled: true,
    urlTemplate: (baseUrl: string) =>
      `${baseUrl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignname}&utm_content={creative}&utm_term={keyword}&gclid={gclid}`,
    urlParamLabel: 'Tracking Template',
    urlParamDescription: 'Set this as the tracking template at the campaign or ad level in Google Ads.',
    urlParamsOnly: (baseUrl: string) =>
      `utm_source=google&utm_medium=cpc&utm_campaign={campaignname}&utm_content={creative}&utm_term={keyword}&gclid={gclid}`,
  },
  {
    id: 'reddit',
    name: 'Reddit',
    description: 'Send conversions to Reddit Conversions API',
    fields: [
      { key: 'pixel_id', label: 'Pixel ID', placeholder: 't2_abc123def', type: 'text' },
      { key: 'access_token', label: 'Conversion Access Token', placeholder: 'eyJ...', type: 'password' },
    ],
    helpUrl: 'https://business.reddithelp.com/s/article/Conversions-API',
    urlTemplate: (baseUrl: string) =>
      `${baseUrl}?utm_source=reddit&utm_medium=cpc&utm_campaign={{CAMPAIGN_NAME}}&utm_content={{AD_NAME}}`,
    urlParamLabel: 'URL Parameters',
    urlParamDescription: 'Add these parameters to your ad destination URL in Reddit Ads.',
    urlParamsOnly: (baseUrl: string) =>
      `utm_source=reddit&utm_medium=cpc&utm_campaign={{CAMPAIGN_NAME}}&utm_content={{AD_NAME}}`,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Coming soon - LinkedIn Conversions API',
    fields: [],
    disabled: true,
    urlTemplate: (baseUrl: string) =>
      `${baseUrl}?utm_source=linkedin&utm_medium=cpc&utm_campaign={{CAMPAIGN_NAME}}&utm_content={{CREATIVE_NAME}}&li_fat_id={{CLICK_ID}}`,
    urlParamLabel: 'URL Parameters',
    urlParamDescription: 'Add these parameters to your ad destination URL in LinkedIn Campaign Manager.',
    urlParamsOnly: (baseUrl: string) =>
      `utm_source=linkedin&utm_medium=cpc&utm_campaign={{CAMPAIGN_NAME}}&utm_content={{CREATIVE_NAME}}&li_fat_id={{CLICK_ID}}`,
  },
];

export function AdPlatformSettings({ eventId, accountId, eventSlug }: AdPlatformSettingsProps) {
  const [configs, setConfigs] = useState<Record<string, AdPlatformConfig | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('meta');
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Form state for each platform
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({});

  const brandId = getBrandId();
  const portalDomain = brandId === 'mlops' ? 'app.mlops.community' : 'app.tech.tickets';
  const eventPath = eventSlug || eventId;
  const baseEventUrl = eventPath ? `https://${portalDomain}/e/${eventPath}` : null;

  // Fetch existing configs
  const fetchConfigs = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('ad_platform_configs')
        .select('*')
        .eq('brand_id', brandId)
        .eq('is_active', true);

      if (eventId) {
        query = query.eq('event_id', eventId);
      } else if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Convert to lookup by platform
      const configsByPlatform: Record<string, AdPlatformConfig | null> = {};
      const formDataByPlatform: Record<string, Record<string, string>> = {};

      for (const platform of PLATFORMS) {
        const config = data?.find((c) => c.platform === platform.id);
        configsByPlatform[platform.id] = config || null;

        // Initialize form data
        formDataByPlatform[platform.id] = {};
        for (const field of platform.fields) {
          formDataByPlatform[platform.id][field.key] = config?.credentials?.[field.key] || '';
        }
      }

      setConfigs(configsByPlatform);
      setFormData(formDataByPlatform);
    } catch (error) {
      console.error('Error fetching ad platform configs:', error);
      toast.error('Failed to load ad platform settings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, [eventId, accountId]);

  // Save config for a platform
  const handleSave = async (platformId: string) => {
    const platform = PLATFORMS.find((p) => p.id === platformId);
    if (!platform) return;

    // Validate required fields
    const credentials = formData[platformId] || {};
    const requiredFields = platform.fields.filter((f) => !f.key.includes('Optional'));

    for (const field of requiredFields) {
      if (!credentials[field.key]?.trim()) {
        toast.error(`${field.label} is required`);
        return;
      }
    }

    setIsSaving(true);
    try {
      const existingConfig = configs[platformId];

      if (existingConfig) {
        // Update existing
        const { error } = await supabase
          .from('ad_platform_configs')
          .update({
            credentials,
            is_active: true,
          })
          .eq('id', existingConfig.id);

        if (error) throw error;
      } else {
        // Create new
        const { error } = await supabase.from('ad_platform_configs').insert({
          brand_id: brandId,
          event_id: eventId || null,
          account_id: accountId || null,
          platform: platformId,
          credentials,
          is_active: true,
          attribution_window_days: 7,
          event_mapping: { registration: 'Lead' },
        });

        if (error) throw error;
      }

      toast.success(`${platform.name} settings saved`);
      fetchConfigs();
    } catch (error) {
      console.error('Error saving ad platform config:', error);
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  // Disable config for a platform
  const handleDisable = async (platformId: string) => {
    const config = configs[platformId];
    if (!config) return;

    if (!confirm('Are you sure you want to disable this integration?')) return;

    try {
      const { error } = await supabase
        .from('ad_platform_configs')
        .update({ is_active: false })
        .eq('id', config.id);

      if (error) throw error;

      toast.success('Integration disabled');
      fetchConfigs();
    } catch (error) {
      console.error('Error disabling ad platform config:', error);
      toast.error('Failed to disable integration');
    }
  };

  // Update form field
  const updateField = (platformId: string, fieldKey: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [platformId]: {
        ...(prev[platformId] || {}),
        [fieldKey]: value,
      },
    }));
  };

  // Toggle password visibility
  const togglePasswordVisibility = (fieldKey: string) => {
    setShowPasswords((prev) => ({
      ...prev,
      [fieldKey]: !prev[fieldKey],
    }));
  };

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto"></div>
        </div>
      </Card>
    );
  }

  const activePlatform = PLATFORMS.find((p) => p.id === activeTab);

  // Count connected platforms
  const connectedCount = Object.values(configs).filter((c) => c?.is_active).length;

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div
        className={`px-4 py-3 cursor-pointer select-none ${isExpanded ? 'border-b border-gray-200 dark:border-gray-700' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <ChevronDownIcon className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
          <Cog6ToothIcon className="w-5 h-5 text-gray-500" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">Ad Platform Settings</h3>
          {!isExpanded && connectedCount > 0 && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              ({connectedCount} connected)
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Configure conversion tracking for ad platforms
        </p>
      </div>

      {isExpanded && (
      <div className="flex">
        {/* Platform tabs */}
        <div className="w-48 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          {PLATFORMS.map((platform) => {
            const config = configs[platform.id];
            const isActive = config?.is_active;

            return (
              <button
                key={platform.id}
                onClick={() => setActiveTab(platform.id)}
                className={`w-full px-4 py-3 text-left text-sm flex items-center justify-between transition-colors cursor-pointer
                  ${activeTab === platform.id ? 'bg-white dark:bg-gray-900 border-l-2 border-primary-500' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}
                `}
              >
                <span className={activeTab === platform.id ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}>
                  {platform.name.split(' ')[0]}
                </span>
                {isActive && <CheckCircleIcon className="w-4 h-4 text-green-500" />}
              </button>
            );
          })}
        </div>

        {/* Platform settings panel */}
        <div className="flex-1 p-4">
          {activePlatform && (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-md font-medium text-gray-900 dark:text-white">{activePlatform.name}</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{activePlatform.description}</p>
                </div>
                {configs[activeTab] && (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                      <CheckCircleIcon className="w-4 h-4" />
                      Connected
                    </span>
                  </div>
                )}
              </div>

              {/* URL Template */}
              {baseEventUrl && activePlatform.urlTemplate && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {activePlatform.urlParamLabel}
                    </label>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(activePlatform.urlParamsOnly(baseEventUrl));
                          toast.success('URL parameters copied');
                        }}
                        className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                      >
                        <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                        Params only
                      </button>
                      <span className="text-gray-300 dark:text-gray-600">|</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(activePlatform.urlTemplate(baseEventUrl));
                          toast.success('Full URL copied');
                        }}
                        className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                      >
                        <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                        Full URL
                      </button>
                    </div>
                  </div>
                  <code className="block text-xs text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 rounded p-2 break-all font-mono border border-gray-200 dark:border-gray-700">
                    {activePlatform.urlTemplate(baseEventUrl)}
                  </code>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                    {activePlatform.urlParamDescription}
                  </p>
                </div>
              )}

              {activePlatform.disabled ? (
                <div className="py-4 text-center text-gray-500">
                  <InformationCircleIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Conversion API integration coming soon.</p>
                </div>
              ) : (
                <>
                  {/* Fields */}
                  <div className="space-y-3">
                    {activePlatform.fields.map((field) => (
                      <div key={field.key}>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {field.label}
                        </label>
                        <div className="relative">
                          <input
                            type={field.type === 'password' && !showPasswords[field.key] ? 'password' : 'text'}
                            placeholder={field.placeholder}
                            value={formData[activeTab]?.[field.key] || ''}
                            onChange={(e) => updateField(activeTab, field.key, e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm
                              focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-800 dark:text-white"
                          />
                          {field.type === 'password' && (
                            <button
                              type="button"
                              onClick={() => togglePasswordVisibility(field.key)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                            >
                              {showPasswords[field.key] ? (
                                <EyeSlashIcon className="w-4 h-4" />
                              ) : (
                                <EyeIcon className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Help link */}
                  {activePlatform.helpUrl && (
                    <a
                      href={activePlatform.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
                    >
                      <InformationCircleIcon className="w-4 h-4" />
                      How to get these values
                    </a>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                    {configs[activeTab] ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDisable(activeTab)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        Disable Integration
                      </Button>
                    ) : (
                      <div />
                    )}
                    <Button onClick={() => handleSave(activeTab)} disabled={isSaving}>
                      {isSaving ? 'Saving...' : configs[activeTab] ? 'Update Settings' : 'Enable Integration'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      )}
    </Card>
  );
}
