// Re-export shim. The actual implementation lives in the events module at
// gatewaze-modules/modules/events/admin/utils/eventService.ts. This shim
// keeps the legacy `@/utils/eventService` import path working for the few
// core-admin pages that still reference it (e.g. home dashboard) without
// pulling the events module into admin's package.json deps.
//
// Path: from packages/admin/src/utils/ → up 4 to project root → sibling
// gatewaze-modules → modules/events/admin/utils/eventService.
// eslint-disable-next-line import/no-relative-parent-imports
export * from '../../../../../gatewaze-modules/modules/events/admin/utils/eventService';
// eslint-disable-next-line import/no-relative-parent-imports
export type { Event } from '../../../../../gatewaze-modules/modules/events/admin/utils/eventService';
