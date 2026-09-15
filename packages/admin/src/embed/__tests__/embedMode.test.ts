import { beforeEach, describe, expect, it } from 'vitest'

import { isEmbedded, setEmbeddedMode } from '../embedMode'

describe('embed mode', () => {
  beforeEach(() => setEmbeddedMode(false))

  it('is false until a mount declares otherwise', () => {
    expect(isEmbedded()).toBe(false)
  })

  it('clears on unmount rather than latching', () => {
    // The module survives an unmount, so a stale `true` would make a later
    // standalone render drop chrome it still needs.
    setEmbeddedMode(true)
    setEmbeddedMode(false)

    expect(isEmbedded()).toBe(false)
  })
})
