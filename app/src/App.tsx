import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import MapView, { type Basemap, type EnvelopeMode, type Mode, type View } from './map/MapView'
import { bangkokDate, shadowVector, sunPosition } from './geo/sun'
import { clampCustom, presetsFor, type CustomBuilding } from './rules/systems'

const CUSTOM_KEY = 'plot-envelope.custom-buildings.v1'
function loadCustoms(): CustomBuilding[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((c) => c && typeof c.id === 'string' && ['condo', 'hotel', 'office'].includes(c.use)).map(clampCustom) : []
  } catch {
    return []
  }
}
import { LocalFrame } from './geo/frame'
import { ensureCCW, signedArea } from './geo/geom'
import { DEFAULT_DESIGN, analyse, type BuildingType, type Design, type Road } from './rules/engine'
import { detectRoads } from './map/roads'
import Panel from './ui/Panel'
import { readSharedFromHash, shareUrl, type Shared } from './share'
import { checkDeed, EMPTY_DEED, type Deed } from './rules/deed'
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

// A shared link (#s=...) opens with that exact setup.
const SHARED = readSharedFromHash()

export default function App() {
  const sh = SHARED
  const [plot, setPlot] = useState<[number, number][]>(sh?.plot ?? DEMO_PLOT)
  const [roads, setRoads] = useState<(Road | null)[]>(sh?.roads ?? DEMO_ROADS)
  const [type, setTypeRaw] = useState<BuildingType>(sh?.type ?? 'condo')
  const [systemId, setSystemId] = useState(sh?.systemId ?? 'rc')
  const [customs, setCustomsRaw] = useState<CustomBuilding[]>(() => {
    const own = loadCustoms()
    return sh?.custom && !own.some((c) => c.id === sh.custom!.id) ? [...own, clampCustom(sh.custom)] : own
  })
  const [deed, setDeed] = useState<Deed>(sh?.deed ? { ...EMPTY_DEED, ...sh.deed } : EMPTY_DEED)
  const [busy, setBusy] = useState('')
  const [theme, setThemeRaw] = useState<'light' | 'dark'>(() => {
    try {
      const t = localStorage.getItem('plot-envelope.theme.v1')
      if (t === 'light' || t === 'dark') return t
    } catch {
      /* ignore */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const setTheme = (t: 'light' | 'dark') => {
    setThemeRaw(t)
    try {
      localStorage.setItem('plot-envelope.theme.v1', t)
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const [toast, setToast] = useState<{ text: string; link?: string } | null>(null)
  const setCustoms = useCallback((c: CustomBuilding[]) => {
    setCustomsRaw(c)
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(c))
    } catch {
      /* private mode: keep for this session only */
    }
  }, [])
  // Picking a use keeps a standard structure, but leaves a custom building made for another use.
  const setType = useCallback(
    (t: BuildingType) => {
      setTypeRaw(t)
      setSystemId((id) => {
        const c = customs.find((x) => x.id === id)
        return c && c.use !== t ? 'rc' : id
      })
    },
    [customs],
  )
  const system = useMemo(
    () => customs.find((c) => c.id === systemId && c.use === type) ?? presetsFor(type).find((s) => s.id === systemId) ?? presetsFor(type)[0],
    [customs, systemId, type],
  )
  const [nearStation, setNearStation] = useState(sh?.nearStation ?? true)
  const [bonusPct, setBonusPct] = useState(sh?.bonusPct ?? 0)
  const [mode, setMode] = useState<Mode>('view')
  const [conceptId, setConceptId] = useState(sh?.conceptId ?? 'tower')
  const [envelopeMode, setEnvelopeMode] = useState<EnvelopeMode>('auto')
  const [showConcept, setShowConcept] = useState(true)
  const [basemap, setBasemap] = useState<Basemap>('map')
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [view, setView] = useState<View>('3d')
  const [design, setDesign] = useState<Design>(sh?.design ? { ...DEFAULT_DESIGN, ...sh.design } : DEFAULT_DESIGN)
  const [showContext, setShowContext] = useState(true)
  const [shadowsOn, setShadowsOn] = useState(true)
  const [month, setMonth] = useState(11) // 21 December: longest shadows of the year
  const [hour, setHour] = useState(15)

  const frame = useMemo(() => new LocalFrame(centroidLL(plot)), [plot])
  const inputs = useMemo(
    () => ({ plot: ensureCCW(frame.ringToLocal(plot)), roads, zone: 'ย.8' as const, type, nearStation, bonusPct, system, design }),
    [frame, plot, roads, type, nearStation, bonusPct, system, design],
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
    mapRef.current?.flyTo({ center: [100.5806, 13.72668], zoom: 17, pitch: 58, bearing: -28 })
  }, [])

  const shared = (): Shared => ({
    v: 1,
    plot,
    roads,
    type,
    systemId,
    custom: customs.find((c) => c.id === systemId),
    nearStation,
    bonusPct,
    conceptId,
    design,
    deed: checkDeed(deed, 1) ? deed : undefined,
  })

  const flash = (text: string, link?: string) => {
    setToast({ text, link })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), link ? 12000 : 3500)
  }

  const onShare = async () => {
    const url = shareUrl(shared())
    try {
      await navigator.clipboard.writeText(url)
      flash('Link copied. Anyone with it sees this plot, roads, building and design.')
    } catch {
      flash('Copy this link to share this setup:', url)
    }
  }

  // Snapshot of the 3D view for each concept, then the PDF (jsPDF is loaded only when asked for).
  const onPdf = async () => {
    const map = mapRef.current
    if (!analysis || analysis.error) return
    setBusy('pdf')
    const was = conceptId
    const shots: Record<string, string> = {}
    try {
      const cam = map && { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }
      if (map) {
        // frame the plot the same way for every snapshot
        map.jumpTo({ center: centroidLL(plot), zoom: 18.2, pitch: 55, bearing: -28 })
        await new Promise<void>((r) => {
          const t = window.setTimeout(r, 4000)
          map.once('idle', () => (window.clearTimeout(t), r()))
        })
        for (const c of analysis.concepts) {
          setConceptId(c.id)
          await new Promise((r) => window.setTimeout(r, 900))
          shots[c.id] = await new Promise<string>((res) => {
            const t = window.setTimeout(() => res(''), 3000)
            map.once('render', () => {
              window.clearTimeout(t)
              try {
                res(map.getCanvas().toDataURL('image/jpeg', 0.88))
              } catch {
                res('')
              }
            })
            map.triggerRepaint()
          })
        }
      }
      setConceptId(was)
      if (map && cam) map.jumpTo(cam)
      const { buildReport } = await import('./report')
      const doc = buildReport({
        analysis,
        plot: inputs.plot,
        plotLL: plot,
        plotArea: Math.abs(signedArea(inputs.plot)),
        roads,
        type,
        system,
        nearStation,
        bonusPct,
        deed: checkDeed(deed, Math.abs(signedArea(inputs.plot))),
        shareLink: shareUrl(shared()),
        shots: Object.fromEntries(Object.entries(shots).filter(([, v]) => v.startsWith('data:image'))),
      })
      doc.save(`plot-envelope-${new Date().toISOString().slice(0, 10)}.pdf`)
      flash('PDF report downloaded.')
    } catch (e) {
      console.error(e)
      setConceptId(was)
      flash('The PDF could not be made. Please try again.')
    }
    setBusy('')
  }

  const sunLL = centroidLL(plot)
  const sun = useMemo(() => sunPosition(bangkokDate(2026, month, 21, hour), sunLL[1], sunLL[0]), [month, hour, sunLL[0], sunLL[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  const sv = shadowVector(sun)
  const compass = (a: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((a * 180) / Math.PI) / 45) % 8]

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
        system={system}
        systemId={systemId}
        setSystemId={setSystemId}
        customs={customs}
        setCustoms={setCustoms}
        design={design}
        setDesign={setDesign}
        deed={deed}
        setDeed={setDeed}
        onShare={onShare}
        onPdf={onPdf}
        busy={busy}
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
          sun={shadowsOn ? sun : null}
          showContext={showContext}
          view={view}
          dark={theme === 'dark'}
          onPlotChange={onPlotChange}
          onModeChange={setMode}
          onEdgeClick={toggleRoad}
          onMapReady={(m) => {
            mapRef.current = m
            if (sh) m.jumpTo({ center: centroidLL(sh.plot) })
          }}
        />
        <button className="overlay top-left themebtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
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
          <div className="seg">
            <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>
              3D view
            </button>
            <button className={view === 'top' ? 'on' : ''} onClick={() => setView('top')}>
              Bird's-eye
            </button>
            <button className={showContext ? 'on' : ''} onClick={() => setShowContext((v) => !v)} title="Show or hide the surrounding buildings">
              Surroundings
            </button>
          </div>
          <details className="legend" open={window.innerWidth > 1100}>
            <summary>Legend</summary>
            <div className="legitems">
            <span><i style={{ background: '#0e9f6e' }} />Low-rise envelope (&lt;23 m)</span>
            <span><i style={{ background: '#2563eb' }} />High-rise envelope (2:1 road plane)</span>
            <span><i style={{ background: '#f4efe6', border: '1px solid #8a7f72' }} />Homes / rooms / offices</span>
            <span><i style={{ background: '#9aa3ad' }} />Parking</span>
            <span><i style={{ background: '#d9c49a' }} />Lobby</span>
            {shadowsOn && <span><i style={{ background: '#1e1b4b', opacity: 0.6 }} />Shadow of the design</span>}
            {shadowsOn && showContext && <span><i style={{ background: '#334155', opacity: 0.4 }} />Shadow of surroundings</span>}
          </div>
          </details>
        </div>
        <div className="overlay bottom-left sunbox">
          <label className="sunhead">
            <input type="checkbox" checked={shadowsOn} onChange={(e) => setShadowsOn(e.target.checked)} />
            <b>Sun &amp; shadows</b>
          </label>
          {shadowsOn && (
            <>
              <div className="seg small">
                {[
                  [2, 'Mar'],
                  [5, 'Jun'],
                  [8, 'Sep'],
                  [11, 'Dec'],
                ].map(([m, l]) => (
                  <button key={m} className={month === m ? 'on' : ''} onClick={() => setMonth(m as number)}>
                    21 {l}
                  </button>
                ))}
              </div>
              <div className="sunrow">
                <input type="range" min={7} max={18} step={0.25} value={hour} onChange={(e) => setHour(Number(e.target.value))} aria-label="Time of day" />
                <span className="time">
                  {String(Math.floor(hour)).padStart(2, '0')}:{String(Math.round((hour % 1) * 60)).padStart(2, '0')}
                </span>
              </div>
              <div className="muted small">
                {sv
                  ? `Sun ${Math.round((sun.altitude * 180) / Math.PI)}° high in the ${compass(sun.azimuth)}; a 10 m wall casts ${(10 * Math.hypot(sv[0], sv[1])).toFixed(1)} m of shadow.`
                  : 'Sun is down or too low for a shadow.'}
              </div>
            </>
          )}
        </div>
        {toast && (
          <div className="toast" role="status">
            {toast.text}
            {toast.link && <input readOnly value={toast.link} onFocus={(e) => e.target.select()} />}
          </div>
        )}
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
