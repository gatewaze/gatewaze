import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { ModulesProvider, useModulesContext, type ModulesContextType } from '@/app/contexts/modules/context';
import { filterNavigationByPermissions } from '@/utils/navigationPermissions';
import type { NavigationTree } from '@/@types/navigation';
import { EmbedModulesGate } from '../EmbedModulesProvider';

// The real wrapper fetches installed_modules and pulls in the build-time
// module list; the gate under test only needs a ModulesProvider ancestor.
vi.mock('@/app/contexts/modules/Provider', () => ({
  ModulesProviderWrapper: ({ children }: { children: unknown }) => children,
}));

// The DB has both modules enabled; the host overlay only narrows from there.
const base = {
  ready: true,
  rows: [],
  allModuleFeatures: new Set(['newsletters', 'broadcasts']),
  isModuleEnabled: () => true,
  isFeatureEnabled: (f: string) => f === 'newsletters' || f === 'broadcasts',
  activeThemeModule: null,
  refresh: async () => {},
  availableUpdates: [],
  checkUpdates: async () => {},
} satisfies ModulesContextType;

const nav: NavigationTree[] = [
  { id: 'module.newsletters..newsletters', type: 'item', path: '/newsletters', title: 'Newsletters', requiredFeature: 'newsletters' },
  { id: 'module.broadcasts..broadcasts', type: 'item', path: '/broadcasts', title: 'Broadcasts', requiredFeature: 'broadcasts' },
  { id: 'admin.settings', type: 'item', path: '/admin/settings', title: 'Settings', requiredFeature: 'settings' },
];

function VisibleTitles() {
  const { isFeatureEnabled, allModuleFeatures } = useModulesContext();
  const visible = filterNavigationByPermissions(nav, {}, true, isFeatureEnabled, allModuleFeatures);
  return <p>{visible.map((n) => n.title).join(',')}</p>;
}

describe('EmbedModulesGate', () => {
  it('hides nav items for module features the host did not enable', () => {
    const { container } = render(
      <ModulesProvider value={base}>
        <EmbedModulesGate overlay={{ moduleIds: ['newsletters'], features: ['newsletters'] }}>
          <VisibleTitles />
        </EmbedModulesGate>
      </ModulesProvider>,
    );
    // Broadcasts is enabled in the DB but not by the host; core items stay.
    expect(container.textContent).toBe('Newsletters,Settings');
  });
});
