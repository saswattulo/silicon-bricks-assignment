// Shareable links: the whole setup is packed into the URL hash (#s=...), so no server is needed.
import type { BuildingType, Design, Road } from './rules/engine'
import type { CustomBuilding } from './rules/systems'
import type { Deed } from './rules/deed'

export interface Shared {
  v: 1
  plot: [number, number][]
  roads: (Road | null)[]
  type: BuildingType
  systemId: string
  custom?: CustomBuilding // the selected custom building, so the link works on another computer
  nearStation: boolean
  bonusPct: number
  conceptId: string
  design: Design
  deed?: Deed
}

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

export function encodeShared(s: Shared): string {
  return b64url(JSON.stringify(s))
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Read and sanity-check a shared state; anything malformed gives null (the app then starts as usual). */
export function decodeShared(code: string): Shared | null {
  try {
    const s = JSON.parse(unb64url(code)) as Shared
    if (s?.v !== 1) return null
    if (!Array.isArray(s.plot) || s.plot.length < 3 || s.plot.length > 200) return null
    if (!s.plot.every((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) return null
    if (!Array.isArray(s.roads) || s.roads.length !== s.plot.length) return null
    s.roads = s.roads.map((r) => (r && isNum(r.width) ? { width: Math.max(2, Math.min(80, r.width)), name: String(r.name ?? 'Public road').slice(0, 80) } : null))
    if (!['condo', 'hotel', 'office'].includes(s.type)) return null
    if (typeof s.design !== 'object' || !s.design) return null
    s.nearStation = !!s.nearStation
    s.bonusPct = isNum(s.bonusPct) ? Math.max(0, Math.min(20, s.bonusPct)) : 0
    s.systemId = String(s.systemId ?? 'rc')
    s.conceptId = String(s.conceptId ?? 'tower')
    return s
  } catch {
    return null
  }
}

export function readSharedFromHash(hash = location.hash): Shared | null {
  const m = /[#&]s=([A-Za-z0-9_-]+)/.exec(hash)
  return m ? decodeShared(m[1]) : null
}

export function shareUrl(s: Shared): string {
  return `${location.origin}${location.pathname}#s=${encodeShared(s)}`
}
