import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import type { LocalFrame } from '../geo/frame'
import { type MultiPoly, type Pt, ensureCCW, pointInRing, union } from '../geo/geom'
import { prismShadow, shadowVector, type Sun } from '../geo/sun'
import type { Analysis, Road } from '../rules/engine'
import { MassingLayer, conceptGroup, envelopeGroup, plotFence } from '../three/massing'
import type * as THREE from 'three'

export type Mode = 'view' | 'draw' | 'edit'
export type EnvelopeMode = 'auto' | 'low' | 'high' | 'both' | 'off'
export type Basemap = 'map' | 'satellite'
export type View = '3d' | 'top'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const ENV_COLOURS = { low: 0x0e9f6e, high: 0x2563eb }

interface Props {
  plot: [number, number][]
  roads: (Road | null)[]
  frame: LocalFrame
  analysis: Analysis | null
  conceptId: string
  showConcept: boolean
  envelopeMode: EnvelopeMode
  basemap: Basemap
  mode: Mode
  sun: Sun | null // null = shadows off
  showContext: boolean
  view: View
  onPlotChange: (ll: [number, number][], fromDraw: boolean) => void
  onModeChange: (m: Mode) => void
  onEdgeClick: (i: number) => void
  onMapReady: (map: maplibregl.Map) => void
}

function mpToGeo(mp: MultiPoly, frame: LocalFrame) {
  return mp.map((poly) => poly.map((r) => [...r, r[0]].map((p) => frame.toLngLat(p))))
}

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const layerRef = useRef<MassingLayer | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  const readyRef = useRef(false)
  const props = useRef(p)
  props.current = p
  const bldLayers = useRef<{ id: string; filter: unknown }[]>([])
  // Context buildings already hidden for the current plot. Only grows while the plot is
  // unchanged: once hidden, a building no longer shows up in queries, so recomputing from
  // scratch would un-hide it and loop forever.
  const hidden = useRef<{ plot: string; ids: Set<string | number>; applied: string }>({ plot: '', ids: new Set(), applied: '' })

  // ---- init once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: STYLE_URL,
      center: [100.5806, 13.72668],
      zoom: window.innerWidth < 860 ? 16.2 : 17,
      pitch: 58,
      bearing: -28,
      maxPitch: 78,
      canvasContextAttributes: { antialias: true },
      attributionControl: { compact: true },
    })
    mapRef.current = map
    ;(window as unknown as { __map?: maplibregl.Map }).__map = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    // style.load fires once the style is parsed, without waiting for every tile, so the
    // plot and massing appear immediately even on a slow connection.
    map.once('style.load', () => {
      const style = map.getStyle()
      // Real 3D city: tone the basemap buildings to a neutral context grey.
      for (const l of style.layers) {
        if (l.type === 'fill-extrusion') {
          map.setPaintProperty(l.id, 'fill-extrusion-color', '#d9d6d0')
          map.setPaintProperty(l.id, 'fill-extrusion-opacity', 0.92)
          bldLayers.current.push({ id: l.id, filter: map.getFilter(l.id) })
        }
      }
      const firstSymbol = style.layers.find((l) => l.type === 'symbol')?.id
      // Shadows sit on the ground: below the 3D buildings, above roads and land.
      const firstBuilding = bldLayers.current[0]?.id ?? firstSymbol
      for (const s of ['shadow-context', 'shadow-concept'] as const)
        map.addSource(s, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'shadow-context', type: 'fill', source: 'shadow-context', paint: { 'fill-color': '#334155', 'fill-opacity': 0.22 } }, firstBuilding)
      map.addLayer({ id: 'shadow-concept', type: 'fill', source: 'shadow-concept', paint: { 'fill-color': '#1e1b4b', 'fill-opacity': 0.38 } }, firstBuilding)
      map.addSource('sat', { type: 'raster', tiles: [SAT_URL], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' })
      map.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } }, firstSymbol)

      const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection
      for (const s of ['plot', 'edges', 'ground'] as const) map.addSource(s, { type: 'geojson', data: empty })
      map.addLayer({ id: 'plot-fill', type: 'fill', source: 'plot', paint: { 'fill-color': '#f97316', 'fill-opacity': 0.1 } })
      map.addLayer({
        id: 'ground-fill',
        type: 'fill',
        source: 'ground',
        paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.12 },
      })
      map.addLayer({
        id: 'ground-line',
        type: 'line',
        source: 'ground',
        paint: { 'line-color': ['get', 'colour'], 'line-width': 1.5, 'line-dasharray': [3, 2] },
      })
      const layer = new MassingLayer()
      layerRef.current = layer
      ;(window as unknown as { __massing?: MassingLayer }).__massing = layer
      map.addLayer(layer)
      map.addLayer({
        id: 'edges-hit',
        type: 'line',
        source: 'edges',
        paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 },
      })
      map.addLayer({
        id: 'edges',
        type: 'line',
        source: 'edges',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': ['case', ['get', 'road'], '#e8590c', '#7c2d12'],
          'line-width': ['case', ['get', 'road'], 6, 2.5],
          'line-opacity': 0.95,
        },
      })
      map.addLayer({
        id: 'edge-labels',
        type: 'symbol',
        source: 'edges',
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-offset': [0, -1.1],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#7c2d12', 'text-halo-color': '#fff', 'text-halo-width': 2 },
      })
      map.on('click', 'edges-hit', (e) => {
        if (props.current.mode !== 'view') return
        const i = e.features?.[0]?.properties?.i
        if (typeof i === 'number') props.current.onEdgeClick(i)
      })
      map.on('mouseenter', 'edges-hit', () => {
        if (props.current.mode === 'view') map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'edges-hit', () => (map.getCanvas().style.cursor = ''))
      map.on('idle', () => {
        hideBuildingsOnPlot()
        syncContextShadows()
      })

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({ styles: { fillColor: '#f97316', fillOpacity: 0.15, outlineColor: '#e8590c', outlineWidth: 2 } }),
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } },
              },
            },
            styles: {
              selectedPolygonColor: '#f97316',
              selectedPolygonFillOpacity: 0.12,
              selectedPolygonOutlineColor: '#e8590c',
              selectionPointColor: '#ffffff',
              selectionPointOutlineColor: '#e8590c',
              selectionPointWidth: 6,
              midPointColor: '#e8590c',
            },
          }),
        ],
      })
      draw.start()
      draw.on('finish', (id) => {
        const f = draw.getSnapshotFeature(id)
        if (!f || f.geometry.type !== 'Polygon') return
        const ring = (f.geometry.coordinates[0] as [number, number][]).slice(0, -1)
        if (props.current.mode === 'draw') {
          props.current.onPlotChange(ring, true)
          props.current.onModeChange('view')
        }
      })
      draw.on('change', (ids, type) => {
        if (props.current.mode !== 'edit' || type === 'delete') return
        const f = draw.getSnapshotFeature(ids[0])
        if (!f || f.geometry.type !== 'Polygon') return
        const ring = (f.geometry.coordinates[0] as [number, number][]).slice(0, -1)
        if (ring.length >= 3) props.current.onPlotChange(ring, false)
      })
      drawRef.current = draw
      readyRef.current = true
      props.current.onMapReady(map)
      syncAll()
    })
    return () => {
      map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function hideBuildingsOnPlot() {
    const map = mapRef.current
    if (!map || !bldLayers.current.length) return
    const { plot, frame } = props.current
    const ring = plot.map((q) => frame.toLocal(q))
    const plotKey = JSON.stringify(plot)
    if (hidden.current.plot !== plotKey) hidden.current = { plot: plotKey, ids: new Set(), applied: hidden.current.applied }
    const ids = hidden.current.ids
    for (const { id } of bldLayers.current) {
      for (const f of map.queryRenderedFeatures({ layers: [id] })) {
        if (f.id === undefined) continue
        const g = f.geometry
        const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((c) => c[0]) : []
        for (const r of rings) {
          const pts = r.slice(0, -1) as [number, number][]
          if (!pts.length) continue
          const c: [number, number] = [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length]
          if (pointInRing(frame.toLocal(c), ring)) ids.add(f.id)
        }
      }
    }
    const key = [...ids].sort().join(',')
    if (hidden.current.applied === key) return
    hidden.current.applied = key
    for (const { id, filter } of bldLayers.current) {
      const hide = ['!', ['in', ['id'], ['literal', [...ids]]]]
      map.setFilter(id, (filter ? ['all', filter, hide] : hide) as maplibregl.FilterSpecification)
    }
  }

  function syncGeo() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const { plot, roads, frame, analysis, envelopeMode, conceptId } = props.current
    const closed = [...plot, plot[0]]
    ;(map.getSource('plot') as maplibregl.GeoJSONSource).setData({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [closed] },
      properties: {},
    })
    const local = plot.map((q) => frame.toLocal(q))
    ;(map.getSource('edges') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: plot.map((a, i) => {
        const b = plot[(i + 1) % plot.length]
        const len = Math.hypot(local[(i + 1) % plot.length][0] - local[i][0], local[(i + 1) % plot.length][1] - local[i][1])
        const r = roads[i]
        return {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [a, b] },
          properties: { i, road: !!r, label: r ? `${i + 1} · ${r.width} m road` : `${i + 1} · ${len.toFixed(1)} m` },
        }
      }),
    })
    const feats: GeoJSON.Feature[] = []
    if (analysis && envelopeMode !== 'off') {
      const concept = analysis.concepts.find((c) => c.id === conceptId)
      const want = envelopeMode === 'auto' ? [concept?.cls ?? 'high'] : envelopeMode === 'both' ? ['low', 'high'] : [envelopeMode]
      for (const cls of want) {
        const env = cls === 'low' ? analysis.low : analysis.high
        if (!env) continue
        const colour = cls === 'low' ? '#0e9f6e' : '#2563eb'
        feats.push({
          type: 'Feature',
          geometry: { type: 'MultiPolygon', coordinates: mpToGeo(env.bands[0].region, frame) },
          properties: { colour },
        })
      }
    }
    ;(map.getSource('ground') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: feats })
  }

  function syncMassing() {
    const layer = layerRef.current
    if (!layer) return
    const { analysis, frame, conceptId, envelopeMode, showConcept, plot } = props.current
    layer.setFrame(frame)
    const groups: THREE.Object3D[] = [plotFence(plot.map((q) => frame.toLocal(q)))]
    if (analysis) {
      const concept = analysis.concepts.find((c) => c.id === conceptId)
      if (concept && showConcept) groups.push(conceptGroup(concept))
      if (envelopeMode !== 'off') {
        const want = envelopeMode === 'auto' ? [concept?.cls ?? 'high'] : envelopeMode === 'both' ? ['low', 'high'] : [envelopeMode]
        for (const cls of want) {
          const env = cls === 'low' ? analysis.low : analysis.high
          if (env) groups.push(envelopeGroup(env, cls === 'low' ? ENV_COLOURS.low : ENV_COLOURS.high))
        }
      }
    }
    layer.setContent(groups)
  }

  function shadowFC(mp: MultiPoly, frame: LocalFrame): GeoJSON.FeatureCollection {
    return mp.length
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: mpToGeo(mp, frame) }, properties: {} }] }
      : { type: 'FeatureCollection', features: [] }
  }

  /** Shadow of the selected concept, floor by floor (so a tower on a podium casts the right shape). */
  function syncConceptShadow() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const { analysis, frame, conceptId, showConcept, sun } = props.current
    const v = sun ? shadowVector(sun) : null
    const concept = analysis?.concepts.find((c) => c.id === conceptId)
    let mp: MultiPoly = []
    if (v && concept && showConcept) {
      const parts: MultiPoly[] = []
      for (const b of concept.blocks) for (const f of b.floors) parts.push(prismShadow(f.plate, f.z0, f.z1, v))
      mp = union(...parts)
    }
    ;(map.getSource('shadow-concept') as maplibregl.GeoJSONSource).setData(shadowFC(mp, frame))
    layerRef.current?.setSun(sun)
  }

  /** Shadows of the real surrounding buildings, from their OSM heights, within ~400 m of the plot. */
  const ctxKey = useRef('')
  function syncContextShadows() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const { frame, sun, showContext } = props.current
    const v = sun && showContext ? shadowVector(sun) : null
    const parts: MultiPoly[] = []
    let sig = 0
    if (v) {
      const seen = new Set<string>()
      for (const { id } of bldLayers.current) {
        for (const f of map.queryRenderedFeatures({ layers: [id] })) {
          if (f.id !== undefined && hidden.current.ids.has(f.id)) continue
          const h = Number(f.properties?.render_height ?? f.properties?.height ?? 0)
          const h0 = Number(f.properties?.render_min_height ?? f.properties?.min_height ?? 0)
          if (!(h > h0)) continue
          const g = f.geometry
          const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
          for (const poly of polys) {
            const outer = (poly[0] as [number, number][]).slice(0, -1)
            if (outer.length < 3) continue
            const local = outer.map((q) => frame.toLocal(q))
            const c: Pt = [local.reduce((s, q) => s + q[0], 0) / local.length, local.reduce((s, q) => s + q[1], 0) / local.length]
            if (Math.hypot(c[0], c[1]) > 400) continue
            const key = `${c[0].toFixed(1)},${c[1].toFixed(1)},${h}`
            if (seen.has(key)) continue
            seen.add(key)
            sig += c[0] * 0.37 + c[1] * 0.61 + h
            parts.push(prismShadow([[ensureCCW(local)]], h0, h, v))
          }
        }
      }
    }
    const key = `${frame.origin.join(',')}|${v ? v.map((x) => x.toFixed(4)).join(',') : 'off'}|${parts.length}|${sig.toFixed(2)}`
    if (key === ctxKey.current) return
    ctxKey.current = key
    ;(map.getSource('shadow-context') as maplibregl.GeoJSONSource).setData(shadowFC(union(...parts), frame))
  }

  function syncAll() {
    syncGeo()
    syncMassing()
    hideBuildingsOnPlot()
    syncConceptShadow()
    syncContextShadows()
  }

  useEffect(() => {
    syncAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.plot, p.roads, p.frame, p.analysis, p.conceptId, p.envelopeMode, p.showConcept])

  useEffect(() => {
    syncConceptShadow()
    syncContextShadows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.sun, p.showContext])

  // Surrounding buildings on/off (the plot's own context is always hidden).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    for (const { id } of bldLayers.current) map.setLayoutProperty(id, 'visibility', p.showContext ? 'visible' : 'none')
  }, [p.showContext])

  // Bird's-eye (straight down, north up) or the 3D street view, framed on the plot.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const pts = props.current.plot
    const b = new maplibregl.LngLatBounds(pts[0], pts[0])
    for (const q of pts) b.extend(q)
    const c = b.getCenter()
    if (p.view === 'top') {
      const cam = map.cameraForBounds(b, { padding: 120, bearing: 0, pitch: 0 })
      map.easeTo({ center: c, zoom: Math.min(17.8, (cam?.zoom ?? 17.5) - 1.4), pitch: 0, bearing: 0, duration: 900 })
    } else {
      map.easeTo({ center: c, zoom: window.innerWidth < 860 ? 16.2 : 17, pitch: 58, bearing: -28, duration: 900 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.view])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.setLayoutProperty('sat', 'visibility', p.basemap === 'satellite' ? 'visible' : 'none')
  }, [p.basemap])

  // ---- draw / edit modes
  useEffect(() => {
    const draw = drawRef.current
    if (!draw || !readyRef.current) return
    const map = mapRef.current!
    if (p.mode === 'draw') {
      draw.clear()
      draw.setMode('polygon')
      map.setLayoutProperty('edges', 'visibility', 'none')
      map.setLayoutProperty('edge-labels', 'visibility', 'none')
    } else if (p.mode === 'edit') {
      draw.clear()
      draw.setMode('select')
      const ring = [...props.current.plot, props.current.plot[0]]
      const res = draw.addFeatures([
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { mode: 'polygon' } },
      ])
      const id = res[0]?.id
      if (id !== undefined && res[0].valid) draw.selectFeature(id)
      map.setLayoutProperty('edges', 'visibility', 'none')
      map.setLayoutProperty('edge-labels', 'visibility', 'none')
    } else {
      draw.clear()
      draw.setMode('static')
      map.setLayoutProperty('edges', 'visibility', 'visible')
      map.setLayoutProperty('edge-labels', 'visibility', 'visible')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.mode])

  return <div ref={el} className="map" />
}
