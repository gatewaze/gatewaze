import { useState, useMemo } from 'react';
import { Tabs } from '@/components/ui';
import { Page } from '@/components/shared/Page';
import { EmailLogsTab } from './EmailLogsTab';
import { EmailTemplatesTab } from './EmailTemplatesTab';
import { TopicLabelsTab } from './TopicLabelsTab';
import { useHasModule } from '@/hooks/useModuleFeature';

type TabType = 'logs' | 'templates' | 'topics';

export default function EmailsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('logs');
  const hasBulkEmailing = useHasModule('bulk-emailing');

  const tabs = useMemo(() => {
    const base = [
      { id: 'logs' as TabType, label: 'Email Logs' },
      { id: 'templates' as TabType, label: 'Templates' },
    ];
    if (hasBulkEmailing) {
      base.push({ id: 'topics' as TabType, label: 'Topic Labels' });
    }
    return base;
  }, [hasBulkEmailing]);

  return (
    <Page title="Emails">
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
            Email Management
          </h1>
          <p className="text-[var(--gray-11)] mt-1">
            View email history, manage templates, and track email engagement
          </p>
        </div>

        {/* Tab Navigation */}
        <Tabs
          value={activeTab}
          onChange={(tab) => setActiveTab(tab as TabType)}
          tabs={tabs}
          className="mb-6"
        />

        {/* Tab Content */}
        {activeTab === 'logs' && <EmailLogsTab />}
        {activeTab === 'templates' && <EmailTemplatesTab />}
        {activeTab === 'topics' && hasBulkEmailing && <TopicLabelsTab />}
      </div>
    </Page>
  );
}
