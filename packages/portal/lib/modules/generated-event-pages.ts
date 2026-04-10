// AUTO-GENERATED — do not edit manually
// Run: npx tsx scripts/generate-module-registry.ts

import type { ComponentType } from 'react'

export interface EventModulePage {
  slug: string
  moduleId: string
  label: string
  icon: string
  order: number
  requiresLocalStorage?: string
  component: () => Promise<{ default: ComponentType<any> }>
}

export const eventModulePages: EventModulePage[] = [
  { slug: 'open-rsvp', moduleId: 'event-invites', label: 'Open RSVP', icon: 'envelope', order: 91, requiresLocalStorage: 'open_rsvp_code', component: () => import('/Users/dan/Git/gatewaze/premium-gatewaze-modules/modules/event-invites/portal/event-pages/open-rsvp') },
  { slug: 'rsvp', moduleId: 'event-invites', label: 'RSVP', icon: 'envelope', order: 90, requiresLocalStorage: 'invite_short_code', component: () => import('/Users/dan/Git/gatewaze/premium-gatewaze-modules/modules/event-invites/portal/event-pages/rsvp') },
  { slug: 'live', moduleId: 'virtual-events', label: 'Live', icon: 'play', order: 5, requiresLocalStorage: undefined, component: () => import('/Users/dan/Git/gatewaze/premium-gatewaze-modules/modules/virtual-events/portal/event-pages/live') },
]

export function findEventModulePage(slug: string): EventModulePage | undefined {
  return eventModulePages.find(p => p.slug === slug)
}
