// Title deed (chanote) area, in Thai units or square metres, compared with the drawn plot.
// 1 rai = 4 ngan = 400 square wah = 1,600 m²; 1 square wah = 4 m².
export interface Deed {
  unit: 'thai' | 'sqm'
  rai: number
  ngan: number
  wah: number // square wah, may have decimals
  sqm: number
}

export const EMPTY_DEED: Deed = { unit: 'thai', rai: 0, ngan: 0, wah: 0, sqm: 0 }

const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0)

export function deedArea(d: Deed): number {
  return d.unit === 'sqm' ? n(d.sqm) : n(d.rai) * 1600 + n(d.ngan) * 400 + n(d.wah) * 4
}

export interface DeedCheck {
  deedM2: number
  drawnM2: number
  diffPct: number // (drawn - deed) / deed, in %
  level: 'match' | 'over' | 'under'
  message: string
}

/** Within ±1% is a match: the drawing is close enough to the survey. */
export const DEED_TOLERANCE_PCT = 1

export function checkDeed(d: Deed, drawnM2: number): DeedCheck | null {
  const deedM2 = deedArea(d)
  if (deedM2 <= 0 || drawnM2 <= 0) return null
  const diffPct = ((drawnM2 - deedM2) / deedM2) * 100
  const abs = Math.abs(diffPct).toFixed(1)
  if (Math.abs(diffPct) <= DEED_TOLERANCE_PCT)
    return { deedM2, drawnM2, diffPct, level: 'match', message: `The drawn plot matches the deed (within ${DEED_TOLERANCE_PCT}%).` }
  if (diffPct > 0)
    return {
      deedM2,
      drawnM2,
      diffPct,
      level: 'over',
      message: `The drawn plot is ${abs}% larger than the deed. Floor area and open space are worked out from the drawing, so they are overstated. Move the corners to match the survey plan.`,
    }
  return {
    deedM2,
    drawnM2,
    diffPct,
    level: 'under',
    message: `The drawn plot is ${abs}% smaller than the deed. The results are on the safe side, but you may be leaving floor area unused.`,
  }
}
