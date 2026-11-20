// Sun position (NOAA low-precision formulae, good to ~0.5°) and the ground shadow it casts.
import { ensureCCW, union, type MultiPoly, type Pt } from './geom'

const RAD = Math.PI / 180

export interface Sun {
  altitude: number // radians above the horizon
  azimuth: number // radians clockwise from north
}

export function sunPosition(date: Date, lat: number, lng: number): Sun {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const eps = (23.439 - 0.0000004 * n) * RAD
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24
  const H = (gmst * 15 + lng) * RAD - ra
  const phi = lat * RAD
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
  let azimuth = Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(H))
  if (azimuth < 0) azimuth += 2 * Math.PI
  return { altitude, azimuth }
}

/** Bangkok local time (UTC+7, no DST) to a Date. month is 0-11. */
export function bangkokDate(year: number, month: number, day: number, hour: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0) + (hour - 7) * 3600000)
}

/** Ground offset (east, north metres) of the shadow of a point 1 m high. Null when the sun is down. */
export function shadowVector(s: Sun): Pt | null {
  if (s.altitude <= 2 * RAD) return null
  const k = 1 / Math.tan(s.altitude)
  return [-Math.sin(s.azimuth) * k, -Math.cos(s.azimuth) * k]
}

/** Shadow on flat ground of a vertical prism (footprint mp, from height z0 to z1). Exact for any polygon. */
export function prismShadow(mp: MultiPoly, z0: number, z1: number, v: Pt): MultiPoly {
  const t = (p: Pt, z: number): Pt => [p[0] + v[0] * z, p[1] + v[1] * z]
  const parts: MultiPoly[] = [
    mp.map((poly) => poly.map((r) => r.map((p) => t(p, z0)))),
    mp.map((poly) => poly.map((r) => r.map((p) => t(p, z1)))),
  ]
  for (const poly of mp)
    for (const r of poly)
      for (let i = 0; i < r.length; i++) {
        const a = r[i]
        const b = r[(i + 1) % r.length]
        const q = ensureCCW([t(a, z0), t(b, z0), t(b, z1), t(a, z1)])
        if (Math.abs((q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1])) > 1e-6) parts.push([[q]])
      }
  return union(...parts)
}
