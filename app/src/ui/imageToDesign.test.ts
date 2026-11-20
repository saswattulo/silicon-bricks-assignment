import { describe, it, expect } from 'vitest'
import { readPlan, readSide, type Pixels } from './imageToDesign'

function img(W: number, H: number, paint: (x: number, y: number) => number | null): Pixels {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = paint(x, y)
      const i = (y * W + x) * 4
      const c = v === null ? [235, 240, 245] : [v, v, v]
      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
      data[i + 3] = 255
    }
  return { width: W, height: H, data }
}

describe('picture to draft', () => {
  it('recognises a drawn circle', () => {
    const r = readPlan(img(200, 200, (x, y) => (Math.hypot(x - 100, y - 100) < 70 ? 60 : null)), 30)
    expect(r.ok).toBe(true)
    expect(r.draft.shape).toBe('circle')
  })
  it('recognises a rectangle and its proportions', () => {
    const r = readPlan(img(240, 160, (x, y) => (x > 20 && x < 220 && y > 40 && y < 120 ? 80 : null)), 50)
    expect(r.draft.shape).toBe('rect')
    expect(r.draft.depth).toBeCloseTo(50 * (79 / 199), 0)
  })
  it('traces an L-shaped plan', () => {
    const r = readPlan(img(200, 200, (x, y) => ((x > 20 && x < 180 && y > 120 && y < 180) || (x > 20 && x < 80 && y > 20 && y < 180) ? 70 : null)), 40)
    expect(r.draft.shape).toBe('custom')
    expect(r.draft.outline!.length).toBeGreaterThanOrEqual(6)
    expect(r.draft.outline!.length).toBeLessThanOrEqual(10)
  })
  it('counts floors and finds a podium in a side view', () => {
    // 20-floor shaft with dark window bands every 12 px on a wider 3-floor podium
    const r = readSide(
      img(220, 320, (x, y) => {
        const inShaft = x >= 70 && x < 150 && y >= 20 && y < 260
        const inPod = x >= 30 && x < 190 && y >= 260 && y < 296
        if (!inShaft && !inPod) return null
        return y % 12 < 4 ? 40 : 150
      }),
      30,
      3,
    )
    expect(r.ok).toBe(true)
    expect(r.draft.podiumFloors).toBeGreaterThanOrEqual(2)
    const total = (r.draft.towerFloors ?? 0) + (r.draft.podiumFloors ?? 0)
    expect(Math.abs(total - 23)).toBeLessThanOrEqual(2)
  })
  it('reads a taper', () => {
    const r = readSide(img(200, 300, (x, y) => {
      const half = 60 - (40 * (y - 20)) / 260 // wide at top? no: narrow at top
      const hw = 20 + ((y - 20) / 260) * 40
      void half
      return y >= 20 && y < 280 && Math.abs(x - 100) < hw ? 120 : null
    }), 30, 3)
    expect(r.draft.taper).toBeGreaterThan(30)
  })
})
