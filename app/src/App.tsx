import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import MapView, { type Basemap, type EnvelopeMode, type Mode } from './map/MapView'
import { LocalFrame } from './geo/frame'
import { ensureCCW, signedArea } from './geo/geom'
import { analyse, type BuildingType, type Road } from './rules/engine'
import { detectRoads } from './map/roads'
import Panel from './ui/Panel'
import './App.css'

// Demo plot: east side of Thong Lo (Sukhumvit Soi 55), zone ย.8-23. Footprint of low shophouses today.
const DEMO_PLOT: [number, number][] = [
  [100.580276, 13.72645],
  [100.58085, 13.72645],
  [100.58085, 13.7269],
  [100.580556, 13.7269],
]
const DEMO_ROADS: (Road | null)[] = [null, null, null, { width: 25, name: 'Thong Lo (Sukhumvit 55)' }]

function centroidLL(r: [number, number][]): [number, number] {
  return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]
}

function toCCW(ring: [number, number][]): [number, number][] {
  const f = new LocalFrame(centroidLL(ring))
  const local = f.ringToLocal(ring)
  return signedArea(local) < 0 ? [...ring].reverse() : ring
}

export default function App() {
  const [plot, setPlot] = useState<[number, number][]>(DEMO_PLOT)
  const [roads, setRoads] = useState<(Road | null)[]>(DEMO_ROADS)
  const [type, setType] = useState<BuildingType>('condo')
  const [nearStation, setNearStation] = useState(true)
  const [bonusPct, setBonusPct] = useState(0)
  const [mode, setMode] = useState<Mode>('view')
  const [conceptId, setConceptId] = useState('tower')
  const [envelopeMode, setEnvelopeMode] = useState<EnvelopeMode>('auto')
  const [showConcept, setShowConcept] = useState(true)
  const [basemap, setBasemap] = useState<Basemap>('map')
  const mapRef = useRef<maplibregl.Map | null>(null)

  const frame = useMemo(() => new LocalFrame(centroidLL(plot)), [plot])
  const inputs = useMemo(
    () => ({ plot: ensureCCW(frame.ringToLocal(plot)), roads, zone: 'ย.8' as const, type, nearStation, bonusPct }),
    [frame, plot, roads, type, nearStation, bonusPct],
  )
  const bundle = useMemo(() => ({ inputs, frame }), [inputs, frame])
  const deferred = useDeferredValue(bundle)
  const analysis = useMemo(() => {
    try {
      return analyse(deferred.inputs)
    } catch (e) {
      console.error(e)
      return null
    }
  }, [deferred])
  // The analysis must be paired with the frame it was computed in.
  const analysisFrame = deferred.frame

  const onPlotChange = useCallback((ll: [number, number][], fromDraw: boolean) => {
    const ring = toCCW(ll)
    setPlot((prev) => {
      if (!fromDraw && prev.length === ring.length) return ring
      return ring
    })
    if (fromDraw) {
      // auto-detect roads after the map has the new area rendered
      setRoads(ring.map(() => null))
      const map = mapRef.current
      if (map) {
        const run = () => {
          const f = new LocalFrame(centroidLL(ring))
          const det = detectRoads(map, f, f.ringToLocal(ring))
          setRoads(det)
        }
        map.once('idle', run)
        map.triggerRepaint()
      }
    } else {
      setRoads((prev) => (prev.length === ring.length ? prev : ring.map((_, i) => prev[i] ?? null)))
    }
  }, [])

  const autoDetect = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const f = new LocalFrame(centroidLL(plot))
    setRoads(detectRoads(map, f, f.ringToLocal(plot)))
  }, [plot])

  const resetDemo = useCallback(() => {
    setPlot(DEMO_PLOT)
    setRoads(DEMO_ROADS)
    setNearStation(true)
    setMode('view')
    mapRef.current?.flyTo({ center: [100.5806, 13.72668], zoom: 17.3, pitch: 60, bearing: -28 })
  }, [])

  const toggleRoad = useCallback((i: number) => {
    setRoads((prev) => prev.map((r, k) => (k === i ? (r ? null : { width: 10, name: 'Public road' }) : r)))
  }, [])

  return (
    <div className="app">
      <Panel
        analysis={analysis}
        plotArea={Math.abs(signedArea(inputs.plot))}
        plot={inputs.plot}
        roads={roads}
        setRoads={setRoads}
        type={type}
        setType={setType}
        nearStation={nearStation}
        setNearStation={setNearStation}
        bonusPct={bonusPct}
        setBonusPct={setBonusPct}
        mode={mode}
        setMode={setMode}
        conceptId={conceptId}
        setConceptId={setConceptId}
        resetDemo={resetDemo}
        autoDetect={autoDetect}
        stale={deferred !== bundle}
      />
      <div className="stage">
        <MapView
          plot={plot}
          roads={roads}
          frame={analysisFrame}
          analysis={analysis}
          conceptId={conceptId}
          showConcept={showConcept}
          envelopeMode={envelopeMode}
          basemap={basemap}
          mode={mode}
          onPlotChange={onPlotChange}
          onModeChange={setMode}
          onEdgeClick={toggleRoad}
          onMapReady={(m) => (mapRef.current = m)}
        />
        <div className="overlay top-right">
          <div className="seg">
            {(['auto', 'low', 'high', 'both', 'off'] as EnvelopeMode[]).map((m) => (
              <button key={m} className={envelopeMode === m ? 'on' : ''} onClick={() => setEnvelopeMode(m)}>
                {m === 'auto' ? 'Envelope: concept' : m === 'low' ? 'Low-rise' : m === 'high' ? 'High-rise' : m === 'both' ? 'Both' : 'Off'}
              </button>
            ))}
          </div>
          <div className="seg">
            <button className={showConcept ? 'on' : ''} onClick={() => setShowConcept((v) => !v)}>
              Massing
            </button>
            <button className={basemap === 'map' ? 'on' : ''} onClick={() => setBasemap('map')}>
              Map
            </button>
            <button className={basemap === 'satellite' ? 'on' : ''} onClick={() => setBasemap('satellite')}>
              Satellite
            </button>
          </div>
          <div className="legend">
            <span><i style={{ background: '#0e9f6e' }} />Low-rise envelope (&lt;23 m)</span>
            <span><i style={{ background: '#2563eb' }} />High-rise envelope (2:1 road plane)</span>
            <span><i style={{ background: '#f4efe6', border: '1px solid #8a7f72' }} />Homes / rooms / offices</span>
            <span><i style={{ background: '#9aa3ad' }} />Parking</span>
            <span><i style={{ background: '#d9c49a' }} />Lobby</span>
          </div>
        </div>
        {mode !== 'view' && (
          <div className="overlay bottom-center hint">
            {mode === 'draw' ? 'Click to place corners. Click the first corner (or double-click) to close the plot.' : 'Drag corners to reshape. Drag a midpoint to add a corner. Right-click a corner to delete it.'}
            <button onClick={() => setMode('view')}>{mode === 'draw' ? 'Cancel' : 'Done'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
