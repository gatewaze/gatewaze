import { useSearchParams } from 'react-router';
import { WorkspaceLayout } from '@/components/ui';
import { Page } from '@/components/shared/Page';
import { ApiKeysTab } from './ApiKeysTab';
import { McpGroupsTab } from './McpGroupsTab';
import { McpPeopleTab } from './McpPeopleTab';
import { McpSessionsTab } from './McpSessionsTab';
import { McpActivityTab } from './McpActivityTab';

const TABS = [
  { id: 'keys', label: 'API Keys' },
  { id: 'groups', label: 'MCP Groups' },
  { id: 'people', label: 'MCP People' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'activity', label: 'Activity' },
];

const TAB_IDS = TABS.map((t) => t.id);

/**
 * "API & MCP Access" — API keys for headless automation, plus the MCP
 * access-control surface (groups, per-person grants, sessions, activity)
 * from the MCP LFID-access spec. Tab selection is URL-driven (?tab=…) so
 * person pages can deep-link into e.g. the Activity tab pre-filtered.
 */
export default function ApiMcpAccessPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') ?? 'keys';
  const activeTab = TAB_IDS.includes(tabParam) ? tabParam : 'keys';

  const handleTabChange = (tabId: string) => {
    const next = new URLSearchParams(searchParams);
    if (tabId === 'keys') next.delete('tab');
    else next.set('tab', tabId);
    // Cross-tab filters (e.g. Activity's person_id) shouldn't leak between tabs.
    if (tabId !== 'activity') next.delete('person_id');
    setSearchParams(next);
  };

  return (
    <Page title="API & MCP Access">
      <WorkspaceLayout
        title="API & MCP Access"
        tabs={TABS}
        activeTabId={activeTab}
        onTabChange={handleTabChange}
      >
        {activeTab === 'keys' && <ApiKeysTab />}
        {activeTab === 'groups' && <McpGroupsTab />}
        {activeTab === 'people' && <McpPeopleTab />}
        {activeTab === 'sessions' && <McpSessionsTab />}
        {activeTab === 'activity' && <McpActivityTab />}
      </WorkspaceLayout>
    </Page>
  );
}
