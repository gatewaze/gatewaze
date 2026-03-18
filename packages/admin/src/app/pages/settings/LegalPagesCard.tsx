import { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Loader2, Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { getSupabase } from '@/lib/supabase';
import { RichTextEditor } from '@/components/ui-legacy/RichTextEditor';

const LEGAL_KEYS = ['privacy_policy_html', 'terms_of_service_html', 'do_not_sell_html'] as const;
type LegalKey = typeof LEGAL_KEYS[number];

const TAB_LABELS: Record<LegalKey, string> = {
  privacy_policy_html: 'Privacy Policy',
  terms_of_service_html: 'Terms of Service',
  do_not_sell_html: 'Do Not Sell',
};

export function LegalPagesCard() {
  const [content, setContent] = useState<Record<LegalKey, string>>({
    privacy_policy_html: '',
    terms_of_service_html: '',
    do_not_sell_html: '',
  });
  const [original, setOriginal] = useState<Record<LegalKey, string>>({
    privacy_policy_html: '',
    terms_of_service_html: '',
    do_not_sell_html: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [activeTab, setActiveTab] = useState<LegalKey>('privacy_policy_html');

  const loadContent = useCallback(async () => {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', [...LEGAL_KEYS]);

    if (data) {
      const loaded = { ...content };
      for (const row of data) {
        if (row.key in loaded) {
          (loaded as Record<string, string>)[row.key] = row.value;
        }
      }
      setContent(loaded);
      setOriginal(loaded);
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadContent(); }, [loadContent]);

  const hasChanges = JSON.stringify(content) !== JSON.stringify(original);

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setSaveError(null);

    try {
      const supabase = getSupabase();

      // Only save keys that changed
      const changedEntries = LEGAL_KEYS.filter(k => content[k] !== original[k]);

      const rows = changedEntries.map(key => ({ key, value: content[key] }));
      const { error } = await Promise.race([
        supabase.from('app_settings').upsert(rows, { onConflict: 'key' }),
        new Promise<{ error: { message: string }; data: null }>(resolve =>
          setTimeout(() => resolve({ error: { message: 'Save timed out. Please try again.' }, data: null }), 10000)
        ),
      ]);

      if (error) {
        setSaveError(`Failed to save: ${error.message}`);
        return;
      }

      setOriginal({ ...content });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Legal Pages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Legal Pages
        </CardTitle>
        <CardDescription>
          Edit the content of your Privacy Policy, Terms of Service, and Do Not Sell pages.
          Leave empty to show a placeholder message on the portal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LegalKey)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="privacy_policy_html">Privacy Policy</TabsTrigger>
            <TabsTrigger value="terms_of_service_html">Terms of Service</TabsTrigger>
            <TabsTrigger value="do_not_sell_html">Do Not Sell</TabsTrigger>
          </TabsList>

          {LEGAL_KEYS.map(key => (
            <TabsContent key={key} value={key}>
              <div className="rounded-lg border">
                <RichTextEditor
                  content={content[key]}
                  onChange={(html) => setContent(prev => ({ ...prev, [key]: html }))}
                  placeholder={`Enter your ${TAB_LABELS[key]} content here...`}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                This content will be displayed on a dark background on the portal. Text colors will be automatically inverted.
              </p>
            </TabsContent>
          ))}
        </Tabs>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={!hasChanges || saving}>
            {saving ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
            ) : saved ? (
              <><Check className="mr-2 h-4 w-4" /> Saved</>
            ) : (
              'Save Changes'
            )}
          </Button>
          {hasChanges && !saving && !saveError && (
            <span className="text-xs text-muted-foreground">You have unsaved changes</span>
          )}
          {saveError && (
            <span className="text-xs text-red-500">Error: {saveError}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
