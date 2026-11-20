import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import type { LocalFrame } from '../geo/frame'
import { type MultiPoly, pointInRing } from '../geo/geom'
import type { Analysis, Road } from '../rules/engine'
import { MassingLayer, conceptGroup, envelopeGroup, plotFence } from '../three/massing'
import type * as THREE from 'three'

export type Mode = 'view' | 'draw' | 'edit'
export type EnvelopeMode = 'auto' | 'low' | 'high' | 'both' | 'off'
export type Basemap = 'map' | 'satellite'

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

  // ---- init once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: STYLE_URL,
      center: [100.5806, 13.72668],
      zoom: 17,
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

    map.on('load', () => {
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
      map.on('idle', () => hideBuildingsOnPlot())

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
    const ids = new Set<string | number>()
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
    if ((hideBuildingsOnPlot as unknown as { key?: string }).key === key) return
    ;(hideBuildingsOnPlot as unknown as { key?: string }).key = key
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

  function syncAll() {
    syncGeo()
    syncMassing()
    hideBuildingsOnPlot()
  }

  useEffect(() => {
    syncAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.plot, p.roads, p.frame, p.analysis, p.conceptId, p.envelopeMode, p.showConcept])

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
