import { describe, expect, it } from 'vitest'
import { decodeShared, encodeShared, type Shared } from './share'
import { DEFAULT_DESIGN } from './rules/engine'

const s: Shared = {
  v: 1,
  plot: [[100.58, 13.726], [100.581, 13.726], [100.581, 13.727]],
  roads: [{ width: 25, name: 'ทองหล่อ Thong Lo' }, null, null],
  type: 'condo', systemId: 'rc', nearStation: true, bonusPct: 5, conceptId: 'design',
  design: { ...DEFAULT_DESIGN, shape: 'L' },
  deed: { unit: 'thai', rai: 1, ngan: 1, wah: 86, sqm: 0 },
}

describe('share links', () => {
  it('round-trips the setup, Thai text included', () => {
    const code = encodeShared(s)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeShared(code)).toEqual(s)
  })
  it('rejects broken or hostile codes', () => {
    expect(decodeShared('not-base64!!')).toBeNull()
    expect(decodeShared(encodeShared({ ...s, plot: [[0, 0]] }))).toBeNull()
    expect(decodeShared(encodeShared({ ...s, type: 'casino' as never }))).toBeNull()
    expect(decodeShared(encodeShared({ ...s, roads: [{ width: 999, name: 'x' }, null, null] }))!.roads[0]!.width).toBe(80)
  })
})
