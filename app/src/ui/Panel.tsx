import { useState } from 'react'
import type { Ring } from '../geo/geom'
import { dist } from '../geo/geom'
import {
  type Analysis,
  type BuildingType,
  type Concept,
  type Road,
  type SystemSpec,
  type Design,
  HIGH_RISE_M,
  TYPES,
  fmt,
  roadSetback,
} from '../rules/engine'
import { FAR_TABLE } from '../rules/zones'
import type { CustomBuilding } from '../rules/systems'
import BuildingSystem from './BuildingSystem'
import DesignEditor from './DesignEditor'
import Builder from './Builder'
import DeedInput from './DeedInput'
import type { Deed } from '../rules/deed'
import type { Mode } from '../map/MapView'

interface Props {
  analysis: Analysis | null
  plotArea: number
  plot: Ring
  roads: (Road | null)[]
  setRoads: (f: (r: (Road | null)[]) => (Road | null)[]) => void
  type: BuildingType
  setType: (t: BuildingType) => void
  nearStation: boolean
  setNearStation: (v: boolean) => void
  bonusPct: number
  setBonusPct: (v: number) => void
  mode: Mode
  setMode: (m: Mode) => void
  conceptId: string
  setConceptId: (id: string) => void
  resetDemo: () => void
  autoDetect: () => void
  stale: boolean
  system: SystemSpec
  systemId: string
  setSystemId: (id: string) => void
  customs: CustomBuilding[]
  setCustoms: (c: CustomBuilding[]) => void
  design: Design
  setDesign: (d: Design) => void
  deed: Deed
  setDeed: (d: Deed) => void
  onShare: () => void
  onPdf: () => void
  busy: string
}

const rai = (m2: number) => {
  const r = Math.floor(m2 / 1600)
  const ngan = Math.floor((m2 - r * 1600) / 400)
  const wah = (m2 - r * 1600 - ngan * 400) / 4
  return `${r}-${ngan}-${wah.toFixed(0)} rai`
}

type Tab = 'plot' | 'building' | 'rules' | 'designs'
const TAB_KEY = 'plot-envelope.tab.v1'
const TABS: { id: Tab; label: string }[] = [
  { id: 'plot', label: 'Plot & roads' },
  { id: 'building', label: 'Building' },
  { id: 'rules', label: 'Rules' },
  { id: 'designs', label: 'Designs' },
]

export default function Panel(p: Props) {
  const a = p.analysis
  const L = a?.limits
  const spec = TYPES[p.type]
  const [tab, setTabRaw] = useState<Tab>(() => {
    try {
      const t = localStorage.getItem(TAB_KEY) as Tab | null
      return t && TABS.some((x) => x.id === t) ? t : 'plot'
    } catch {
      return 'plot'
    }
  })
  const [building, setBuilding] = useState(false)
  const openBuilder = () => {
    p.setConceptId('design')
    setBuilding(true)
    document.querySelector('.panel')?.scrollTo({ top: 0 })
  }
  const setTab = (t: Tab) => {
    setBuilding(false)
    setTabRaw(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* ignore */
    }
    document.querySelector('.panel')?.scrollTo({ top: 0 })
  }
  const roadsCount = p.roads.filter(Boolean).length
  const active = a?.concepts.find((c) => c.id === p.conceptId)
  const fails = active ? active.checks.filter((k) => k.pass === false).length : 0
  const next = (t: Tab, label: string) => (
    <div className="nextrow">
      <button className="next" onClick={() => setTab(t)}>
        {label} →
      </button>
    </div>
  )

  return (
    <aside className="panel">
      <header className="brand">
        <div className="logo">▲</div>
        <div className="brandtext">
          <h1>Plot Envelope · Bangkok</h1>
          <p>Zoning envelope and concepts in 3D</p>
        </div>
        <div className="exports">
          <button onClick={p.onShare} disabled={!!p.busy} title="Copy a link that opens this exact setup">
            Share
          </button>
          <button className="primary" onClick={p.onPdf} disabled={!!p.busy || !a || !!a.error} title="Download a PDF report of this plot and all concepts">
            {p.busy === 'pdf' ? 'Making PDF…' : 'PDF report'}
          </button>
        </div>
        <div className="summary">
          <button onClick={() => setTab('plot')}>
            <span>Plot</span>
            <b>{fmt(p.plotArea)} m²</b>
          </button>
          <button onClick={() => setTab('rules')}>
            <span>Max floor</span>
            <b>{L ? `${fmt(L.gfaCap)} m²` : '–'}</b>
          </button>
          <button onClick={() => setTab('designs')}>
            <span>{active ? active.name.replace('Your design: ', 'Yours: ') : 'Design'}</span>
            <b className={active?.infeasible || fails ? 'bad' : 'good'}>{!active ? '–' : active.infeasible ? "Doesn't fit" : fails ? `${fails} rule${fails > 1 ? 's' : ''} fail` : 'All rules pass'}</b>
          </button>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t, i) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              <span className="step">{i + 1}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {building && (
        <Builder design={p.design} setDesign={p.setDesign} floorH={p.system.typH} concept={a?.concepts.find((c) => c.id === 'design')} onClose={() => setBuilding(false)} />
      )}

      {!building && tab === 'plot' && (
        <>
          <section>
            <h2>Your plot</h2>
            <div className="zone">
              <div className="chip" style={{ background: '#8B5A2B' }}>ย.8</div>
              <div>
                <b>Very high-density residential</b>
                <div className="muted">
                  FAR 6 · open space 5% ·{' '}
                  <a href="https://cityplangis.bangkok.go.th/" target="_blank" rel="noreferrer">
                    check zone on BMA map
                  </a>
                </div>
              </div>
            </div>
            <div className="stats">
              <div>
                <span>Area</span>
                <b>{fmt(p.plotArea)} m²</b>
                <em>{rai(p.plotArea)}</em>
              </div>
              <div>
                <span>Corners</span>
                <b>{p.plot.length}</b>
                <em>any shape</em>
              </div>
            </div>
            <div className="row">
              <button className={p.mode === 'draw' ? 'primary on' : 'primary'} onClick={() => p.setMode(p.mode === 'draw' ? 'view' : 'draw')}>
                {p.mode === 'draw' ? 'Cancel drawing' : 'Draw a new plot'}
              </button>
              <button className={p.mode === 'edit' ? 'on' : ''} onClick={() => p.setMode(p.mode === 'edit' ? 'view' : 'edit')}>
                {p.mode === 'edit' ? 'Done editing' : 'Edit corners'}
              </button>
              <button onClick={p.resetDemo}>Demo plot</button>
            </div>
            <details className="fold" open={p.deed.rai + p.deed.ngan + p.deed.wah + p.deed.sqm > 0}>
              <summary>Check against the title deed</summary>
              <DeedInput deed={p.deed} setDeed={p.setDeed} drawnM2={p.plotArea} farCap={L?.farCap ?? null} />
            </details>
          </section>

          <section>
            <h2>
              Road frontage <span className="count">{roadsCount ? `${roadsCount} road${roadsCount > 1 ? 's' : ''}` : 'none yet'}</span>
            </h2>
            <p className="muted small">
              Tick each edge that faces a public road and enter the road width (boundary to boundary). You can also click an edge on the map.{' '}
              <button className="link" onClick={p.autoDetect}>
                Detect from map
              </button>
            </p>
            <div className="edges">
              {p.plot.map((pt, i) => {
                const r = p.roads[i]
                const len = dist(pt, p.plot[(i + 1) % p.plot.length])
                return (
                  <div key={i} className={r ? 'edge road' : 'edge'}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!r}
                        onChange={() => p.setRoads((prev) => prev.map((x, k) => (k === i ? (x ? null : { width: 10, name: 'Public road' }) : x)))}
                      />
                      <b>Edge {i + 1}</b> <span className="muted">{len.toFixed(1)} m</span>
                      {r && <span className="muted small ellipsis rname">{r.name}</span>}
                    </label>
                    {r && (
                      <div className="roadin">
                        <input
                          type="number"
                          min={2}
                          max={80}
                          step={0.5}
                          value={r.width}
                          onChange={(e) => {
                            const w = Math.max(2, Math.min(80, Number(e.target.value) || 2))
                            p.setRoads((prev) => prev.map((x, k) => (k === i && x ? { ...x, width: w } : x)))
                          }}
                        />
                        <span className="muted">m wide · setback {fmt(roadSetback(r.width), 1)} m</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {next('building', 'Next: the building')}
          </section>
        </>
      )}

      {!building && tab === 'building' && (
        <section>
          <h2>What you want to build</h2>
          <div className="seg wide">
            {(['condo', 'hotel', 'office'] as BuildingType[]).map((t) => (
              <button key={t} className={p.type === t ? 'on' : ''} onClick={() => p.setType(t)}>
                {TYPES[t].label}
              </button>
            ))}
          </div>
          <BuildingSystem
            type={p.type}
            setType={p.setType}
            system={p.system}
            systemId={p.systemId}
            setSystemId={p.setSystemId}
            customs={p.customs}
            setCustoms={p.setCustoms}
          />
          <label className="check">
            <input type="checkbox" checked={p.nearStation} onChange={(e) => p.setNearStation(e.target.checked)} />
            Within 500 m of a BTS/MRT platform
          </label>
          <label className="slider">
            <span>
              FAR bonus claimed <b>{p.bonusPct}%</b>
            </span>
            <input type="range" min={0} max={20} step={5} value={p.bonusPct} onChange={(e) => p.setBonusPct(Number(e.target.value))} />
            <em className="muted">For rainwater retention or green building (cl.55-57), up to 20%.</em>
          </label>
          {next('rules', 'Next: what the rules allow')}
        </section>
      )}

      {a?.error && <div className="error">{a.error}</div>}
      {!a && <div className="error">This plot shape could not be analysed. Try moving a corner.</div>}

      {!building && tab === 'rules' && a && L && !a.error && (
        <section>
          <h2>What the rules allow</h2>
          <div className="bigstat">
            <span>Max floor area</span>
            <b>{fmt(L.gfaCap)} m²</b>
            <em>{L.gfaCapReason}</em>
          </div>
          <table className="rules">
            <tbody>
              <tr>
                <td>Open space</td>
                <td>
                  At least {L.zone.osrPct}% of floor area, <b>{fmt((L.zone.osrPct / 100) * L.gfaCap)} m²</b> at full FAR, half of it planted
                  <div className="muted small">and 30% of the largest floor ({spec.residential ? 'residential' : '10% non-residential'}, MR55 cl.33)</div>
                </td>
              </tr>
              <tr>
                <td>Height</td>
                <td>
                  Up to 2 × the distance to the far side of the {fmt(L.plane!.width, 1)} m road
                  <div className="muted small">
                    {fmt(2 * L.plane!.width, 0)} m at the frontage, up to {fmt(a.high?.maxHeight ?? 0, 0)} m further back
                  </div>
                </td>
              </tr>
              <tr>
                <td>Low-rise</td>
                <td>
                  Under {HIGH_RISE_M} m and 10,000 m²: road setback {fmt(Math.max(2, ...p.roads.filter(Boolean).map((r) => roadSetback(r!.width))), 1)} m, sides 2 m (3 m above 9 m)
                  <div className="muted small">BKK Ord. cl.50, 54, 55</div>
                </td>
              </tr>
              <tr>
                <td>High-rise</td>
                <td>
                  {HIGH_RISE_M} m or taller, or 10,000 m² or more: 6 m clear on every side, 12 m frontage on a road at least 10 m wide
                  <div className="muted small">MR33 cl.2, 4</div>
                </td>
              </tr>
              <tr>
                <td>Buildable ground</td>
                <td>
                  <span className="dot" style={{ background: '#0e9f6e' }} />
                  low-rise {fmt(a.low?.groundArea ?? 0)} m² · <span className="dot" style={{ background: '#2563eb' }} />
                  high-rise {fmt(a.high?.groundArea ?? 0)} m²
                </td>
              </tr>
            </tbody>
          </table>
          <details className="fold">
            <summary>Compare with nearby zones</summary>
            <div className="fartable">
              {FAR_TABLE.map((z) => (
                <span key={z.code} className={z.code === 'ย.8' ? 'on' : ''}>
                  {z.code} FAR {z.far} · OSR {z.osr}%
                </span>
              ))}
            </div>
          </details>
          {next('designs', 'Next: see the designs')}
        </section>
      )}

      {!building && tab === 'designs' && a && L && !a.error && (
        <section>
          <h2>Pick a design {p.stale && <span className="muted small">updating…</span>}</h2>
          <div className="concepts">
            {a.concepts.map((c) => (
              <ConceptCard key={c.id} c={c} plotArea={p.plotArea} active={c.id === p.conceptId} onClick={() => p.setConceptId(c.id)} type={p.type} />
            ))}
          </div>
          {p.conceptId !== 'design' && (
            <button className="buildcta" onClick={openBuilder}>
              <b>+ Build your own from scratch</b>
              <span className="muted small">Draw the floor plan, cut a courtyard, stack the floors.</span>
            </button>
          )}
          {p.conceptId === 'design' && <DesignEditor design={p.design} setDesign={p.setDesign} floorH={p.system.typH} onBuild={openBuilder} />}
          {a.concepts
            .filter((c) => c.id === p.conceptId)
            .map((c) => (
              <ConceptDetail key={c.id} c={c} plotArea={p.plotArea} />
            ))}
        </section>
      )}

      <footer className="muted small">
        Pre-design feasibility only, not a permit check. Rules: Bangkok Comprehensive Plan 2013, BMA Building Control Ordinance 2544,
        Ministerial Regulations 33 and 55. Context: © OpenStreetMap contributors, OpenFreeMap.{' '}
        <a href="https://github.com/saswattulo/silicon-bricks-assignment/blob/HEAD/docs/DECISIONS.md" target="_blank" rel="noreferrer">
          Sources and decisions
        </a>
      </footer>
    </aside>
  )
}

function ConceptCard({ c, plotArea, active, onClick, type }: { c: Concept; plotArea: number; active: boolean; onClick: () => void; type: BuildingType }) {
  const fails = c.checks.filter((k) => k.pass === false).length
  const passes = c.checks.filter((k) => k.pass === true).length
  return (
    <button className={active ? 'card on' : 'card'} onClick={onClick} aria-pressed={active}>
      <div className="cardhead">
        <b>{c.name}</b>
        {c.infeasible ? <span className="badge fail">Doesn't fit</span> : fails ? <span className="badge fail">{fails} fail</span> : <span className="badge pass">All {passes} pass</span>}
      </div>
      {!c.infeasible && (
        <div className="cardline muted small">
          {fmt(c.gfa)} m² · FAR {fmt(c.gfa / plotArea, 2)} · {fmt(c.height, 1)} m · {type === 'office' ? `${c.floors} floors` : `${fmt(c.units)} ${type === 'hotel' ? 'rooms' : 'units'}`}
        </div>
      )}
    </button>
  )
}

function ConceptDetail({ c, plotArea }: { c: Concept; plotArea: number }) {
  const [showAll, setShowAll] = useState(false)
  if (c.infeasible) return <div className="error">{c.infeasible}</div>
  const floors = c.blocks.flatMap((b) => b.floors.map((f) => ({ ...f, block: b.name }))).sort((x, y) => x.z0 - y.z0 || x.block.localeCompare(y.block))
  const failing = c.checks.filter((k) => k.pass === false)
  const shown = showAll || failing.length === 0 ? c.checks : failing
  return (
    <div className="detail">
      <p className="muted small tagline">{c.tagline}</p>
      <div className="kpis">
        <div>
          <span>Floor area</span>
          <b>{fmt(c.gfa)} m²</b>
        </div>
        <div>
          <span>FAR</span>
          <b>{fmt(c.gfa / plotArea, 2)}</b>
        </div>
        <div>
          <span>Height</span>
          <b>{fmt(c.height, 1)} m</b>
        </div>
        <div>
          <span>Floors</span>
          <b>{c.floors}</b>
        </div>
      </div>
      <h3>
        <span>
          Rule check{' '}
          <span className={failing.length ? 'count bad' : 'count good'}>
            {failing.length ? `${failing.length} of ${c.checks.filter((k) => k.pass !== null).length} fail` : `all ${c.checks.filter((k) => k.pass).length} pass`}
          </span>
        </span>
        {failing.length > 0 && (
          <button className="link" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'show only failures' : `show all ${c.checks.length}`}
          </button>
        )}
      </h3>
      {!showAll && failing.length === 0 ? (
        <details className="fold">
          <summary>See all {c.checks.length} checks with clause references</summary>
          <CheckList checks={c.checks} />
        </details>
      ) : (
        <CheckList checks={shown} />
      )}
      <details className="fold">
        <summary>Area schedule, floor by floor</summary>
        <AreaSchedule c={c} plotArea={plotArea} floors={floors} />
      </details>
    </div>
  )
}

function CheckList({ checks }: { checks: Concept['checks'] }) {
  return (
      <ul className="checks">
        {checks.map((k) => (
          <li key={k.id} className={k.pass === null ? 'info' : k.pass ? 'pass' : 'fail'}>
            <span className="mark">{k.pass === null ? 'i' : k.pass ? '✓' : '✕'}</span>
            <div>
              <div className="cl">
                <b>{k.label}</b>
                <span className="src">{k.source}</span>
              </div>
              <div className="small">
                <span className="muted">Rule:</span> {k.required}
              </div>
              <div className="small">
                <span className="muted">Design:</span> {k.actual}
              </div>
            </div>
          </li>
        ))}
      </ul>
  )
}

type FloorRow = { z0: number; z1: number; area: number; use: string; block: string }

function AreaSchedule({ c, plotArea, floors }: { c: Concept; plotArea: number; floors: FloorRow[] }) {
  const [showFloors, setShowFloors] = useState(false)
  return (
    <>
      <button className="link" onClick={() => setShowFloors((v) => !v)}>
        {showFloors ? 'group similar floors' : `list all ${floors.length} floors`}
      </button>
      <table className="sched">
        <thead>
          <tr>
            <th>Level</th>
            <th>Use</th>
            <th>Height</th>
            <th className="r">Area m²</th>
          </tr>
        </thead>
        <tbody>
          {(showFloors ? floors.map((f, i) => ({ ...f, label: `L${i + 1}` })) : summarise(floors)).map((f, i) => (
            <tr key={i}>
              <td>{f.label}</td>
              <td>{f.use}</td>
              <td>
                {fmt(f.z0, 1)}–{fmt(f.z1, 1)} m
              </td>
              <td className="r">{fmt(f.area)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>
              Total floor area (FAR {fmt(c.gfa / plotArea, 2)})
            </td>
            <td className="r">{fmt(c.gfa)}</td>
          </tr>
          <tr>
            <td colSpan={3}>Ground covered by building</td>
            <td className="r">{fmt(c.footprint)}</td>
          </tr>
          <tr>
            <td colSpan={3}>Open space (plot − covered)</td>
            <td className="r">{fmt(c.openSpace)}</td>
          </tr>
          <tr>
            <td colSpan={3}>Parking spaces required / provided</td>
            <td className="r">
              {c.parkingRequired} / {c.parkingProvided}
            </td>
          </tr>
        </tfoot>
      </table>
    </>
  )
}

type Row = { label: string; use: string; z0: number; z1: number; area: number }

function summarise(floors: { z0: number; z1: number; area: number; use: string; block: string }[]): Row[] {
  // group consecutive floors with the same use and (rounded) area
  const rows: Row[] = []
  let i = 0
  while (i < floors.length) {
    let j = i
    while (j + 1 < floors.length && floors[j + 1].use === floors[i].use && Math.abs(floors[j + 1].area - floors[i].area) < 1) j++
    const n = j - i + 1
    const area = floors.slice(i, j + 1).reduce((s, f) => s + f.area, 0)
    rows.push({
      label: n === 1 ? `L${i + 1}` : `L${i + 1}–${j + 1} (${n}×${fmt(floors[i].area)})`,
      use: floors[i].use,
      z0: floors[i].z0,
      z1: floors[j].z1,
      area,
    })
    i = j + 1
  }
  return rows
}
