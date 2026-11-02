import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real config/brand pulls in @gatewaze/shared, which vitest here cannot
// resolve. Only the two exports getEventTypeOptions reads are needed.
const clientConfig: { eventTypes?: { value: string; label: string }[] } = {}
vi.mock('@/config/brand', () => ({
  DEFAULT_EVENT_TYPES: [
    { value: 'conference', label: 'Conference' },
    { value: 'workshop', label: 'Workshop' },
  ],
  getClientBrandConfig: () => clientConfig,
}))

import { getEventTypeOptions } from '../useEventFilters'

// getEventTypeOptions must use the event types it is given (the server-provided
// brandConfig) rather than reading the client brand config, which is the
// defaults during SSR and the real brand in the browser. Otherwise the server
// and the client render different filter pills and hydration fails.
describe('getEventTypeOptions', () => {
  beforeEach(() => {
    delete clientConfig.eventTypes
  })

  it('uses the event types passed in, not the client brand config', () => {
    clientConfig.eventTypes = [{ value: 'workshop', label: 'workshop' }]
    const options = getEventTypeOptions([{ value: 'virtual', label: 'virtual event' }])
    expect(options).toEqual([{ value: 'virtual', label: 'Virtual events', slug: 'virtuals' }])
  })

  it('falls back to the defaults when the passed list is empty', () => {
    clientConfig.eventTypes = [{ value: 'meetup', label: 'meetup' }]
    expect(getEventTypeOptions([]).map((o) => o.value)).toEqual(['conference', 'workshop'])
  })

  it('reads the client brand config when nothing is passed', () => {
    clientConfig.eventTypes = [{ value: 'meetup', label: 'meetup' }]
    expect(getEventTypeOptions().map((o) => o.value)).toEqual(['meetup'])
  })
})
