import { describe, expect, it, vi } from 'vitest';

// A module with a normal route, an /admin route and a layout: 'bare' route.
vi.mock('virtual:gatewaze-modules', () => ({
  default: [
    {
      id: 'demo',
      adminRoutes: [
        { path: 'demo/:slug', component: async () => ({ default: () => null }), requiredFeature: 'demo', guard: 'none' },
        { path: 'demo/review/:id', component: async () => ({ default: () => null }), requiredFeature: 'demo', guard: 'none', layout: 'bare' },
        { path: 'demo-settings', component: async () => ({ default: () => null }), requiredFeature: 'demo', guard: 'admin' },
      ],
    },
  ],
}));

import type { RouteObject } from 'react-router';
import { moduleAdminRoutes, moduleBareRoutes, moduleRoutes } from '../moduleRoutes';

function paths(routes: RouteObject[], prefix = ''): string[] {
  return routes.flatMap((r) => {
    const here = r.index ? prefix : [prefix, r.path].filter(Boolean).join('/');
    return r.children ? paths(r.children, here) : [here];
  });
}

describe('module route layouts', () => {
  it('keeps layout: bare routes out of the app layout routes', () => {
    expect(paths(moduleRoutes)).toEqual(['demo/:slug']);
  });

  it('collects layout: bare routes on their own', () => {
    expect(paths(moduleBareRoutes)).toEqual(['demo/review/:id']);
  });

  it('leaves /admin routes unchanged', () => {
    expect(paths(moduleAdminRoutes)).toEqual(['demo-settings']);
  });
});
