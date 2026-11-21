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

export default function Panel(p: Props) {
  const a = p.analysis
  const L = a?.limits
  const spec = TYPES[p.type]
  return (
    <aside className="panel">
      <header className="brand">
        <div className="logo">▲</div>
        <div>
          <h1>Plot Envelope · Bangkok</h1>
          <p>What can you build on this plot, before you hire an architect.</p>
        </div>
        <div className="exports">
          <button onClick={p.onShare} disabled={!!p.busy} title="Copy a link that opens this exact setup">
            Share link
          </button>
          <button className="primary" onClick={p.onPdf} disabled={!!p.busy || !a || !!a.error} title="Download a PDF report of this plot and all concepts">
            {p.busy === 'pdf' ? 'Making PDF…' : 'PDF report'}
          </button>
        </div>
      </header>

      <section>
        <h2>
          <span className="step">1</span>Plot
        </h2>
        <div className="zone">
          <div className="chip" style={{ background: '#8B5A2B' }}>ย.8</div>
          <div>
            <b>Very high-density residential (brown)</b>
            <div className="muted">
              Bangkok Comprehensive Plan 2013, cl.15 · FAR 6 · OSR 5% ·{' '}
              <a href="https://cityplangis.bangkok.go.th/" target="_blank" rel="noreferrer">
                confirm zone on BMA map
              </a>
            </div>
          </div>
        </div>
        <div className="stats">
          <div>
            <span>Plot area</span>
            <b>{fmt(p.plotArea)} m²</b>
            <em>{rai(p.plotArea)}</em>
          </div>
          <div>
            <span>Corners</span>
            <b>{p.plot.length}</b>
            <em>any shape</em>
          </div>
        </div>
        <DeedInput deed={p.deed} setDeed={p.setDeed} drawnM2={p.plotArea} farCap={L?.farCap ?? null} />
        <div className="row">
          <button className={p.mode === 'draw' ? 'primary on' : 'primary'} onClick={() => p.setMode(p.mode === 'draw' ? 'view' : 'draw')}>
            {p.mode === 'draw' ? 'Cancel drawing' : 'Draw a new plot'}
          </button>
          <button className={p.mode === 'edit' ? 'on' : ''} onClick={() => p.setMode(p.mode === 'edit' ? 'view' : 'edit')}>
            {p.mode === 'edit' ? 'Done editing' : 'Edit corners'}
          </button>
          <button onClick={p.resetDemo}>Demo plot</button>
        </div>
      </section>

      <section>
        <h2>
          <span className="step">2</span>Road frontage
        </h2>
        <p className="muted small">
          Mark every edge that faces a public road and enter its right-of-way width (boundary to boundary). Click an edge on the
          map to toggle it.{' '}
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
                    <div className="muted small ellipsis">{r.name}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h2>
          <span className="step">3</span>Building
        </h2>
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
          Within 500 m of a BTS/MRT platform <span className="muted">(demo plot: BTS Thong Lo)</span>
        </label>
        <label className="slider">
          <span>
            FAR bonus claimed <b>{p.bonusPct}%</b>
            <em className="muted"> rainwater retention / green building, cl.55-57, max 20%</em>
          </span>
          <input type="range" min={0} max={20} step={5} value={p.bonusPct} onChange={(e) => p.setBonusPct(Number(e.target.value))} />
        </label>
      </section>

      {a?.error && <div className="error">{a.error}</div>}
      {!a && <div className="error">This plot shape could not be analysed. Try moving a corner.</div>}

      {a && L && !a.error && (
        <>
          <section>
            <h2>
              <span className="step">4</span>What the rules allow
            </h2>
            <table className="rules">
              <tbody>
                <tr>
                  <td>Max floor area</td>
                  <td>
                    <b>{fmt(L.gfaCap)} m²</b>
                    <div className="muted small">{L.gfaCapReason}</div>
                  </td>
                </tr>
                <tr>
                  <td>Open space</td>
                  <td>
                    ≥ {L.zone.osrPct}% of floor area → <b>{fmt((L.zone.osrPct / 100) * L.gfaCap)} m²</b> at full FAR, half planted
                    <div className="muted small">and ≥30% of the largest floor ({spec.residential ? 'residential' : '10% non-residential'}, MR55 cl.33)</div>
                  </td>
                </tr>
                <tr>
                  <td>Height</td>
                  <td>
                    ≤ 2 × distance to far side of the {fmt(L.plane!.width, 1)} m road
                    <div className="muted small">
                      at the frontage: {fmt(2 * L.plane!.width, 0)} m; envelope peaks at {fmt(a.high?.maxHeight ?? 0, 0)} m
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>Low-rise setbacks</td>
                  <td>
                    Road {fmt(Math.max(2, ...p.roads.filter(Boolean).map((r) => roadSetback(r!.width))), 1)} m · sides 2 m to 9 m high, 3 m above
                    <div className="muted small">below {HIGH_RISE_M} m and 10,000 m² · BKK Ord. cl.50, 54, 55</div>
                  </td>
                </tr>
                <tr>
                  <td>High-rise setbacks</td>
                  <td>
                    6 m from every boundary and the road
                    <div className="muted small">≥{HIGH_RISE_M} m or ≥10,000 m² · MR33 cl.4; needs 12 m frontage on a ≥10 m road</div>
                  </td>
                </tr>
                <tr>
                  <td>Ground buildable</td>
                  <td>
                    <span className="dot" style={{ background: '#0e9f6e' }} />
                    low-rise {fmt(a.low?.groundArea ?? 0)} m² · <span className="dot" style={{ background: '#2563eb' }} />
                    high-rise {fmt(a.high?.groundArea ?? 0)} m²
                  </td>
                </tr>
              </tbody>
            </table>
            <details className="small">
              <summary>Nearby zones for comparison</summary>
              <div className="fartable">
                {FAR_TABLE.map((z) => (
                  <span key={z.code} className={z.code === 'ย.8' ? 'on' : ''}>
                    {z.code} FAR {z.far} · OSR {z.osr}%
                  </span>
                ))}
              </div>
            </details>
          </section>

          <section>
            <h2>
              <span className="step">5</span>Concept designs {p.stale && <span className="muted small">updating…</span>}
            </h2>
            <div className="concepts">
              {a.concepts.map((c) => (
                <ConceptCard key={c.id} c={c} plotArea={p.plotArea} active={c.id === p.conceptId} onClick={() => p.setConceptId(c.id)} type={p.type} />
              ))}
            </div>
            {p.conceptId === 'design' && <DesignEditor design={p.design} setDesign={p.setDesign} floorH={p.system.typH} />}
            {a.concepts
              .filter((c) => c.id === p.conceptId)
              .map((c) => (
                <ConceptDetail key={c.id} c={c} plotArea={p.plotArea} />
              ))}
          </section>
        </>
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
    <button className={active ? 'card on' : 'card'} onClick={onClick}>
      <div className="cardhead">
        <b>{c.name}</b>
        {c.infeasible ? <span className="badge fail">Doesn't fit</span> : fails ? <span className="badge fail">{fails} fail</span> : <span className="badge pass">All {passes} pass</span>}
      </div>
      <div className="muted small">{c.tagline}</div>
      {!c.infeasible && (
        <div className="kpis">
          <div>
            <span>Floor area</span>
            <b>{fmt(c.gfa)} m²</b>
          </div>
          <div>
            <span>FAR used</span>
            <b>{fmt(c.gfa / plotArea, 2)}</b>
          </div>
          <div>
            <span>Height</span>
            <b>{fmt(c.height, 1)} m</b>
          </div>
          <div>
            <span>{type === 'condo' ? 'Units' : type === 'hotel' ? 'Rooms' : 'Floors'}</span>
            <b>{type === 'office' ? c.floors : fmt(c.units)}</b>
          </div>
        </div>
      )}
    </button>
  )
}

function ConceptDetail({ c, plotArea }: { c: Concept; plotArea: number }) {
  const [showFloors, setShowFloors] = useState(false)
  if (c.infeasible) return <div className="error">{c.infeasible}</div>
  const floors = c.blocks.flatMap((b) => b.floors.map((f) => ({ ...f, block: b.name }))).sort((x, y) => x.z0 - y.z0 || x.block.localeCompare(y.block))
  return (
    <div className="detail">
      <h3>Pass / fail checklist</h3>
      <ul className="checks">
        {c.checks.map((k) => (
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
      <h3>
        Area schedule{' '}
        <button className="link" onClick={() => setShowFloors((v) => !v)}>
          {showFloors ? 'hide floors' : `show all ${floors.length} floors`}
        </button>
      </h3>
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
    </div>
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
