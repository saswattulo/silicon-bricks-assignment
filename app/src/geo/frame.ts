import * as maplibregl from 'maplibre-gl'
import type { Pt, Ring } from './geom'

/**
 * Local east-north metric frame anchored at a lng/lat origin, built on Web Mercator
 * so geometry and the three.js layer share exactly the same projection.
 */
export class LocalFrame {
  readonly origin: [number, number]
  readonly ox: number
  readonly oy: number
  readonly s: number // mercator units per metre at origin

  constructor(origin: [number, number]) {
    this.origin = origin
    const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: origin[0], lat: origin[1] }, 0)
    this.ox = mc.x
    this.oy = mc.y
    this.s = mc.meterInMercatorCoordinateUnits()
  }

  toLocal([lng, lat]: [number, number]): Pt {
    const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0)
    return [(mc.x - this.ox) / this.s, -(mc.y - this.oy) / this.s]
  }

  toLngLat([x, y]: Pt): [number, number] {
    const mc = new maplibregl.MercatorCoordinate(this.ox + x * this.s, this.oy - y * this.s, 0)
    const ll = mc.toLngLat()
    return [ll.lng, ll.lat]
  }

  ringToLocal(r: [number, number][]): Ring {
    return r.map((p) => this.toLocal(p))
  }
}
