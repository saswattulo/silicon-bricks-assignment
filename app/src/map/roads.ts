// Suggest which plot edges face a public road, using the road network already
// rendered in the basemap (OpenStreetMap via OpenFreeMap vector tiles).
import type * as maplibregl from 'maplibre-gl'
import type { LocalFrame } from '../geo/frame'
import { inwardNormal, type Pt, type Ring } from '../geo/geom'
import type { Road } from '../rules/engine'

// Typical Bangkok right-of-way by OSM class: a starting guess the user must confirm.
const CLASS_WIDTH: Record<string, number> = {
  motorway: 40,
  trunk: 40,
  primary: 30,
  secondary: 20,
  tertiary: 16,
  minor: 10,
  residential: 10,
  unclassified: 10,
}

export function detectRoads(map: maplibregl.Map, frame: LocalFrame, plot: Ring): (Road | null)[] {
  const style = map.getStyle()
  const roadLayers = (style?.layers ?? [])
    .filter((l) => 'source-layer' in l && (l as { 'source-layer'?: string })['source-layer'] === 'transportation')
    .map((l) => l.id)
  const nameLayers = (style?.layers ?? [])
    .filter((l) => 'source-layer' in l && (l as { 'source-layer'?: string })['source-layer'] === 'transportation_name')
    .map((l) => l.id)
  if (!roadLayers.length) return plot.map(() => null)

  return plot.map((a, i) => {
    const b = plot[(i + 1) % plot.length]
    const n = inwardNormal(a, b)
    const out: Pt = [-n[0], -n[1]]
    let best = null as { cls: string; d: number; name?: string } | null
    for (const t of [0.25, 0.5, 0.75]) {
      const m: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      for (const d of [3, 6, 10, 14, 18]) {
        const q: Pt = [m[0] + out[0] * d, m[1] + out[1] * d]
        const px = map.project(frame.toLngLat(q) as [number, number])
        const feats = map.queryRenderedFeatures(
          [
            [px.x - 4, px.y - 4],
            [px.x + 4, px.y + 4],
          ],
          { layers: [...roadLayers, ...nameLayers] },
        )
        for (const f of feats) {
          const cls = String(f.properties?.class ?? '')
          if (!(cls in CLASS_WIDTH)) continue
          if (!best || d < best.d || CLASS_WIDTH[cls] > CLASS_WIDTH[best.cls]) {
            best = { cls, d, name: (f.properties?.['name:en'] as string) || (f.properties?.name as string) || best?.name }
          }
        }
        if (best) break
      }
    }
    if (!best) return null
    return { width: CLASS_WIDTH[best.cls], name: best.name ? best.name : `${best.cls} road` }
  })
}
