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
  { slug: 'rsvp', moduleId: 'event-invites', label: 'RSVP', icon: 'envelope', order: 90, requiresLocalStorage: 'invite_short_code', component: () => import('/premium-gatewaze-modules/modules/event-invites/portal/event-pages/rsvp') },
]

export function findEventModulePage(slug: string): EventModulePage | undefined {
  return eventModulePages.find(p => p.slug === slug)
}
