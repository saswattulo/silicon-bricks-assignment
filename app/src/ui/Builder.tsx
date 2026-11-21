// Build a building from scratch, one step at a time:
//   1 the outer shape of a floor plan (a preset, or drawn corner by corner),
//   2 its inner shape (none, a courtyard, or a drawn atrium / light well),
//   3 the floors: stack plans as tiers, copy the one below and change it.
// Every change goes straight to the map and the rule check, so the person sees
// the result while they draw. Cancel puts the earlier design back.

import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import { type Concept, type Design, type DesignShape, type Tier, shapePoly, shapeRing } from '../rules/engine'
import { type Pt, isSelfIntersecting, polyArea } from '../geo/geom'
import { SHAPES } from './shapes'
import { Slider } from './DesignEditor'

type Preset = Exclude<DesignShape, 'custom'>

/** One floor plan, in metres around the tower centre; y points away from the road. */
interface Plan {
  floors: number
  kind: 'preset' | 'drawn'
  shape: Preset
  width: number
  depth: number
  sides: number
  pts: Pt[] // drawn outline, relative to (dx, dy)
  closed: boolean
  inner: 'none' | 'courtyard' | 'drawn'
  courtyard: number // 0.1-0.8 of the outer size
  hole: Pt[] // drawn inner shape, relative to (dx, dy)
  holeClosed: boolean
  dx: number
  dy: number
}

const r1 = (v: number) => Math.round(v * 10) / 10
const fmt = (v: number) => Math.round(v).toLocaleString('en-US')

function bboxOf(ring: Pt[]) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (const [x, y] of ring) (a = Math.min(a, x)), (b = Math.min(b, y)), (c = Math.max(c, x)), (d = Math.max(d, y))
  return { minx: a, miny: b, maxx: c, maxy: d, w: c - a, h: d - b, cx: (a + c) / 2, cy: (b + d) / 2 }
}

/** The outer ring around (0,0), before the (dx, dy) shift. */
function outerLocal(p: Plan): Pt[] {
  if (p.kind === 'drawn') return p.pts
  return shapeRing(p.shape, p.width, p.shape === 'circle' ? p.width : p.depth, undefined, p.sides)
}

function planOk(p: Plan) {
  if (p.kind === 'drawn' && (!p.closed || p.pts.length < 3 || isSelfIntersecting(p.pts))) return false
  if (p.inner === 'drawn' && p.hole.length && (!p.holeClosed || p.hole.length < 3 || isSelfIntersecting(p.hole))) return false
  return true
}

/** Plan -> engine tier. Drawn shapes go in as unit-box outlines around their own bounding box. */
function toTier(p: Plan): Tier {
  const ring = outerLocal(p)
  let ox = 0, oy = 0, sw = p.width, sd = p.shape === 'circle' ? p.width : p.depth
  const t: Tier = { floors: p.floors, shape: p.shape, width: sw, depth: sd, dx: p.dx, dy: p.dy }
  if (p.kind === 'drawn') {
    const b = bboxOf(ring)
    ;(ox = b.cx), (oy = b.cy), (sw = Math.max(1, b.w)), (sd = Math.max(1, b.h))
    Object.assign(t, { shape: 'custom', width: sw, depth: sd, dx: r1(p.dx + ox), dy: r1(p.dy + oy), outline: ring.map(([x, y]) => [(x - ox) / sw, (y - oy) / sd] as Pt) })
  } else if (p.shape === 'polygon') t.sides = p.sides
  if (p.inner === 'courtyard') t.courtyard = p.courtyard
  if (p.inner === 'drawn' && p.hole.length >= 3 && p.holeClosed) t.hole = p.hole.map(([x, y]) => [(x - ox) / sw, (y - oy) / sd] as Pt)
  return t
}

function fromTier(t: Tier): Plan {
  const custom = t.shape === 'custom' && t.outline && t.outline.length >= 3
  const preset: Preset = t.shape === 'custom' ? 'rect' : t.shape
  const w = t.width, d = t.shape === 'circle' ? t.width : t.depth
  const p: Plan = {
    floors: t.floors, kind: custom ? 'drawn' : 'preset', shape: preset, width: w, depth: d, sides: t.sides ?? 5,
    pts: custom ? t.outline!.map(([x, y]) => [r1(x * w), r1(y * d)] as Pt) : [], closed: !!custom,
    inner: t.hole?.length ? 'drawn' : t.courtyard ? 'courtyard' : 'none', courtyard: t.courtyard ?? 0.4,
    hole: (t.hole ?? []).map(([x, y]) => [r1(x * w), r1(y * d)] as Pt), holeClosed: !!t.hole?.length,
    dx: t.dx, dy: t.dy,
  }
  return p
}

function initial(d: Design): Plan[] {
  if (d.tiers?.length) return d.tiers.map(fromTier)
  const shape = d.shape === 'custom' && !d.outline ? 'rect' : d.shape
  return [fromTier({ floors: d.towerFloors, shape, width: d.width, depth: d.depth, sides: d.sides, courtyard: d.courtyard, outline: d.outline, hole: d.hole, dx: 0, dy: 0 })]
}

/** Floor plate of a plan, in metres, with the shift applied (outer ring + any hole). */
function plateOf(p: Plan): Pt[][] {
  const t = toTier(p)
  return shapePoly(t.shape, t.width, t.depth, { outline: t.outline, sides: t.sides, courtyard: t.courtyard, hole: t.hole }).map((r) => r.map(([x, y]) => [x + t.dx, y + t.dy] as Pt))
}
const plateArea = (rings: Pt[][]) => (rings.length ? polyArea(rings) : 0)

const circlePts = (r: number, n = 16): Pt[] => Array.from({ length: n }, (_, i) => [r1(r * Math.cos((2 * Math.PI * i) / n)), r1(r * Math.sin((2 * Math.PI * i) / n))] as Pt)
const rectPts = (w: number, d: number): Pt[] => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => [r1(x), r1(y)] as Pt)

const pathOf = (rings: Pt[][]) => rings.map((r) => 'M' + r.map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join('L') + 'Z').join('')

/** A square drawing board in metres. Click to add corners, click the first corner to close,
 *  drag corners to move them, double-click a corner to delete it, click an edge's dot to add one. */
function Board(props: {
  span: number
  snap: number
  pts?: Pt[]
  closed?: boolean
  onPts?: (pts: Pt[], closed: boolean) => void
  fill?: Pt[][]
  ghosts?: Pt[][][]
  offset?: Pt // drawn points are relative to this point
  label?: string
}) {
  const { span, snap } = props
  const off = props.offset ?? [0, 0]
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const pts = props.pts ?? []
  const closed = !!props.closed
  const editable = !!props.onPts
  const [hover, setHover] = useState<Pt | null>(null)

  const toM = (e: { clientX: number; clientY: number }): Pt => {
    const s = svg.current!
    const m = s.getScreenCTM()
    if (!m) return [0, 0]
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    const sn = (v: number) => (snap ? Math.round(v / snap) * snap : r1(v))
    return [sn(q.x - off[0]), sn(-q.y - off[1])]
  }
  const down = (e: RPE<SVGSVGElement>) => {
    if (!editable || closed || e.button !== 0) return
    props.onPts!([...pts, toM(e)], false)
  }
  const move = (e: RPE<SVGSVGElement>) => {
    if (!editable) return
    const p = toM(e)
    if (drag.current !== null) {
      const i = drag.current
      props.onPts!(pts.map((q, k) => (k === i ? p : q)), closed)
    } else setHover(closed ? null : p)
  }
  const up = () => (drag.current = null)
  const vdown = (e: RPE<SVGCircleElement>, i: number) => {
    e.stopPropagation()
    if (!editable) return
    if (!closed && i === 0 && pts.length >= 3) return props.onPts!(pts, true)
    drag.current = i
    svg.current?.setPointerCapture(e.pointerId)
  }
  const vdel = (i: number) => {
    if (!editable) return
    const next = pts.filter((_, k) => k !== i)
    props.onPts!(next, closed && next.length >= 3)
  }
  const mdown = (e: RPE<SVGCircleElement>, i: number) => {
    e.stopPropagation()
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const mid: Pt = [r1((a[0] + b[0]) / 2), r1((a[1] + b[1]) / 2)]
    props.onPts!([...pts.slice(0, i + 1), mid, ...pts.slice(i + 1)], closed)
    drag.current = i + 1
    svg.current?.setPointerCapture(e.pointerId)
  }

  const half = span / 2
  const grid: number[] = []
  const stepM = span > 100 ? 10 : 5
  for (let v = Math.ceil(-half / stepM) * stepM; v <= half; v += stepM) grid.push(v)
  const abs = pts.map(([x, y]) => [x + off[0], y + off[1]] as Pt)
  const k = span / 340 // metres per screen pixel, roughly
  const bad = closed && pts.length >= 3 && isSelfIntersecting(pts)

  return (
    <div className="board">
      <svg
        ref={svg}
        viewBox={`${-half} ${-half} ${span} ${span}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={() => setHover(null)}
        className={editable && !closed ? 'drawing' : ''}
        role="img"
        aria-label={props.label ?? 'Floor plan'}
      >
        {grid.map((v) => (
          <g key={v} className={v === 0 ? 'axis' : v % (stepM * 2) === 0 ? 'major' : 'minor'}>
            <line x1={v} y1={-half} x2={v} y2={half} />
            <line x1={-half} y1={v} x2={half} y2={v} />
          </g>
        ))}
        <rect className="roadband" x={-half} y={half - 3 * k * 6} width={span} height={3 * k * 6} />
        <text className="roadtxt" x={0} y={half - k * 6} fontSize={k * 11} textAnchor="middle">
          road side
        </text>
        {(props.ghosts ?? []).map((g, i) => (
          <path key={i} className="ghost" d={pathOf(g)} fillRule="evenodd" />
        ))}
        {props.fill && <path className={bad ? 'plate bad' : 'plate'} d={pathOf(props.fill)} fillRule="evenodd" />}
        {editable && abs.length > 0 && (
          <>
            <path className={closed ? 'edit closed' : 'edit'} d={'M' + abs.map(([x, y]) => `${x},${-y}`).join('L') + (closed ? 'Z' : '')} />
            {!closed && hover && (
              <line className="rubber" x1={abs[abs.length - 1][0]} y1={-abs[abs.length - 1][1]} x2={hover[0] + off[0]} y2={-(hover[1] + off[1])} />
            )}
            {closed &&
              abs.map((a, i) => {
                const b = abs[(i + 1) % abs.length]
                const len = Math.hypot(b[0] - a[0], b[1] - a[1])
                const mx = (a[0] + b[0]) / 2, my = -(a[1] + b[1]) / 2
                return (
                  <g key={'m' + i}>
                    {len > span / 9 && (
                      <text className="len" x={mx} y={my - k * 7} fontSize={k * 10} strokeWidth={k * 3} textAnchor="middle">
                        {len.toFixed(1)} m
                      </text>
                    )}
                    {(pts.length <= 12 || len > span / 12) && <circle className="mid" cx={mx} cy={my} r={k * 4} onPointerDown={(e) => mdown(e, i)} />}
                  </g>
                )
              })}
            {abs.map(([x, y], i) => (
              <circle
                key={i}
                className={i === 0 && !closed && pts.length >= 3 ? 'vtx first' : 'vtx'}
                cx={x}
                cy={-y}
                r={k * (i === 0 && !closed ? 7 : pts.length > 12 ? 3.5 : 5.5)}
                onPointerDown={(e) => vdown(e, i)}
                onDoubleClick={() => vdel(i)}
              >
                <title>Drag to move, double-click to delete</title>
              </circle>
            ))}
          </>
        )}
        {editable && !closed && hover && <circle className="cursor" cx={hover[0] + off[0]} cy={-(hover[1] + off[1])} r={k * 3.5} />}
      </svg>
      {bad && <div className="boardwarn">The edges cross each other. Drag a corner to untangle them.</div>}
    </div>
  )
}

function Thumb({ rings, size = 46 }: { rings: Pt[][]; size?: number }) {
  if (!rings.length) return <svg width={size} height={size} />
  const b = bboxOf(rings[0])
  const s = Math.max(b.w, b.h, 1) * 1.15
  return (
    <svg className="thumb" width={size} height={size} viewBox={`${b.cx - s / 2} ${-b.cy - s / 2} ${s} ${s}`}>
      <path d={pathOf(rings)} fillRule="evenodd" />
    </svg>
  )
}

/** Side view of the stack: each tier's width along the road, floors to scale. */
function Elevation({ plans, floorH, podium }: { plans: Plan[]; floorH: number; podium: number }) {
  const boxes = plans.map((p) => bboxOf(plateOf(p)[0] ?? [[0, 0]]))
  const minx = Math.min(...boxes.map((b) => b.minx)) - 4
  const maxx = Math.max(...boxes.map((b) => b.maxx)) + 4
  const total = podium + plans.reduce((n, p) => n + p.floors, 0)
  const H = Math.max(10, total * floorH)
  const W = Math.max(20, maxx - minx)
  const s = Math.max(H * 1.08, W)
  let z = podium * floorH
  return (
    <svg className="elev" viewBox={`${minx - (s - W) / 2} ${-s} ${s} ${s * 1.04}`} preserveAspectRatio="xMidYMax meet" role="img" aria-label="Side view">
      <line className="ground" x1={minx - s} y1={0} x2={maxx + s} y2={0} />
      {podium > 0 && <rect className="pod" x={boxes[0].minx - 3} y={-podium * floorH} width={boxes[0].w + 6} height={podium * floorH} />}
      {plans.map((p, i) => {
        const b = boxes[i]
        const h = p.floors * floorH
        const y = -(z + h)
        z += h
        return (
          <g key={i}>
            <rect className={'tierbox t' + (i % 4)} x={b.minx} y={y} width={b.w} height={h} />
            {Array.from({ length: Math.min(p.floors - 1, 80) }, (_, f) => (
              <line key={f} className="flr" x1={b.minx} x2={b.maxx} y1={y + (f + 1) * floorH} y2={y + (f + 1) * floorH} />
            ))}
          </g>
        )
      })}
    </svg>
  )
}

const STEPS = ['Outer shape', 'Inner shape', 'Floors and tiers'] as const

export default function Builder(props: { design: Design; setDesign: (d: Design) => void; floorH: number; concept?: Concept; onClose: () => void }) {
  const { floorH } = props
  const original = useRef(props.design)
  const [plans, setPlans] = useState<Plan[]>(() => initial(props.design))
  const [podium, setPodium] = useState(props.design.podiumFloors)
  const [cur, setCur] = useState(0)
  const [step, setStep] = useState(0)
  const [snap, setSnap] = useState(1)
  const plan = plans[Math.min(cur, plans.length - 1)]
  const setPlan = (patch: Partial<Plan>) => setPlans((ps) => ps.map((p, i) => (i === cur ? { ...p, ...patch } : p)))

  const all = plans.reduce((m, p) => Math.max(m, bboxOf(outerLocal(p).map(([x, y]) => [x + p.dx, y + p.dy] as Pt)).w, bboxOf(outerLocal(p).map(([x, y]) => [x + p.dx, y + p.dy] as Pt)).h, Math.abs(p.dx) * 2 + 10, Math.abs(p.dy) * 2 + 10), 0)
  const [span, setSpan] = useState(() => Math.max(60, Math.ceil((all * 1.35) / 20) * 20))

  // push every valid change to the map and the rule check
  const ok = plans.every(planOk)
  const set = props.setDesign
  useEffect(() => {
    if (!ok) return
    const tiers = plans.map(toTier)
    const t0 = tiers[0]
    const base: Partial<Design> = { shape: t0.shape, width: t0.width, depth: t0.depth, sides: t0.sides, outline: t0.outline, courtyard: t0.courtyard, hole: t0.hole }
    const d0 = original.current
    const floors = tiers.reduce((n, t) => n + t.floors, 0)
    set({
      ...d0,
      ...base,
      rotation: d0.rotation,
      offsetX: tiers.length === 1 ? t0.dx : 0,
      offsetY: tiers.length === 1 ? t0.dy : 0,
      tiers: tiers.length > 1 ? tiers : undefined,
      towerFloors: floors,
      podiumFloors: podium,
      taper: 0,
      twist: 0,
      trim: false,
    })
  }, [plans, podium, ok, set])

  const cancel = () => {
    props.setDesign(original.current)
    props.onClose()
  }

  const fill = plateOf(plan)
  const below = cur > 0 ? [plateOf(plans[cur - 1])] : []
  const area = planOk(plan) ? plateArea(fill) : 0
  const totalFloors = podium + plans.reduce((n, p) => n + p.floors, 0)
  const gfa = plans.reduce((n, p) => n + (planOk(p) ? plateArea(plateOf(p)) * p.floors : 0), 0)
  const fails = props.concept?.checks.filter((k) => k.pass === false) ?? []

  const startDraw = () => {
    if (plan.kind === 'drawn' && plan.pts.length) return
    // seed the drawing with the current preset's corners so it can be reshaped
    const ring = outerLocal(plan)
    const seed = (ring.length > 24 ? ring.filter((_, i) => i % 4 === 0) : ring).map(([x, y]) => [r1(x), r1(y)] as Pt)
    setPlan({ kind: 'drawn', pts: seed, closed: true })
  }
  const copyUp = (scale: number) => {
    const top = plans[plans.length - 1]
    const sc = (pts: Pt[]) => pts.map(([x, y]) => [r1(x * scale), r1(y * scale)] as Pt)
    const n: Plan = {
      ...top,
      floors: Math.max(1, Math.round(top.floors * (scale < 1 ? 0.6 : 1))),
      width: r1(top.width * scale),
      depth: r1(top.depth * scale),
      pts: sc(top.pts),
      hole: sc(top.hole),
    }
    setPlans([...plans, n])
    setCur(plans.length)
  }

  return (
    <section className="builder">
      <div className="bhead">
        <div>
          <h2>Build from scratch</h2>
          <div className="muted small">Changes show on the map as you go.</div>
        </div>
        <div className="row">
          <button onClick={cancel}>Cancel</button>
          <button className="primary" onClick={props.onClose} disabled={!ok}>
            Done
          </button>
        </div>
      </div>

      <nav className="bsteps">
        {STEPS.map((s, i) => (
          <button key={s} className={step === i ? 'on' : ''} onClick={() => setStep(i)}>
            <span className="step">{i + 1}</span>
            {s}
          </button>
        ))}
      </nav>

      {plans.length > 1 && step < 2 && (
        <div className="tierpick">
          <span className="muted small">Editing</span>
          {plans.map((_, i) => (
            <button key={i} className={i === cur ? 'on' : ''} onClick={() => setCur(i)}>
              {i === 0 ? 'Bottom' : i === plans.length - 1 ? 'Top' : `Tier ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      {step === 0 && (
        <div className="bstep">
          <p className="muted small">Start with the outline of the floor plan. Pick a shape and size it, or draw your own corner by corner.</p>
          <div className="seg wide small">
            <button className={plan.kind === 'preset' ? 'on' : ''} onClick={() => setPlan({ kind: 'preset' })}>
              Pick a shape
            </button>
            <button className={plan.kind === 'drawn' ? 'on' : ''} onClick={startDraw}>
              Draw your own
            </button>
          </div>
          {plan.kind === 'preset' ? (
            <>
              <div className="shapes">
                {SHAPES.map(([id, label, path]) => (
                  <button key={id} className={plan.shape === id ? 'on' : ''} onClick={() => setPlan({ shape: id })} title={label}>
                    <svg width="24" height="24" viewBox="0 0 24 24">
                      <path d={path} />
                    </svg>
                    {label}
                  </button>
                ))}
              </div>
              <div className="dgrid">
                <Slider label={plan.shape === 'circle' ? 'Diameter' : 'Width'} unit=" m" value={plan.width} min={4} max={150} step={0.5} onChange={(v) => setPlan({ width: v, depth: plan.shape === 'circle' ? v : plan.depth })} />
                {plan.shape !== 'circle' && <Slider label="Depth" unit=" m" value={plan.depth} min={4} max={150} step={0.5} onChange={(v) => setPlan({ depth: v })} />}
                {plan.shape === 'polygon' && <Slider label="Sides" value={plan.sides} min={3} max={12} onChange={(v) => setPlan({ sides: v })} />}
              </div>
            </>
          ) : (
            <div className="drawbar">
              <span className="muted small">
                {!plan.closed ? (plan.pts.length < 3 ? 'Click on the grid to place corners.' : 'Click the first corner (orange) to close the shape.') : 'Drag corners to move them, drag an edge dot to add a corner, double-click a corner to delete it.'}
              </span>
              <div className="row">
                {!plan.closed && plan.pts.length > 0 && <button onClick={() => setPlan({ pts: plan.pts.slice(0, -1) })}>Undo</button>}
                <button onClick={() => setPlan({ pts: [], closed: false })}>Clear</button>
                <button onClick={() => setPlan({ pts: rectPts(30, 20), closed: true })}>Box</button>
                <button onClick={() => setPlan({ pts: circlePts(14), closed: true })}>Round</button>
              </div>
            </div>
          )}
          <Board
            span={span}
            snap={snap}
            pts={plan.kind === 'drawn' ? plan.pts : undefined}
            closed={plan.closed}
            offset={[plan.dx, plan.dy]}
            onPts={plan.kind === 'drawn' ? (pts, closed) => setPlan({ pts, closed }) : undefined}
            fill={planOk(plan) ? fill : undefined}
            ghosts={below}
            label="Outer shape"
          />
        </div>
      )}

      {step === 1 && (
        <div className="bstep">
          <p className="muted small">Cut an inner shape out of the plan: a courtyard, an atrium or a light well. It is left open to the sky on these floors.</p>
          <div className="seg wide small">
            <button className={plan.inner === 'none' ? 'on' : ''} onClick={() => setPlan({ inner: 'none' })}>
              None
            </button>
            <button className={plan.inner === 'courtyard' ? 'on' : ''} onClick={() => setPlan({ inner: 'courtyard' })}>
              Same shape
            </button>
            <button
              className={plan.inner === 'drawn' ? 'on' : ''}
              onClick={() => {
                if (plan.hole.length) return setPlan({ inner: 'drawn' })
                const b = bboxOf(outerLocal(plan))
                setPlan({ inner: 'drawn', hole: rectPts(b.w * 0.35, b.h * 0.35).map(([x, y]) => [r1(x + b.cx), r1(y + b.cy)] as Pt), holeClosed: true })
              }}
            >
              Draw it
            </button>
          </div>
          {plan.inner === 'courtyard' && <Slider label="Courtyard size" unit="% of the outline" value={Math.round(plan.courtyard * 100)} min={10} max={80} step={5} onChange={(v) => setPlan({ courtyard: v / 100 })} />}
          {plan.inner === 'drawn' && (
            <div className="drawbar">
              <span className="muted small">{!plan.holeClosed ? 'Click to place corners, then click the first one to close.' : 'Drag the corners. Edge dots add corners; double-click deletes one.'}</span>
              <div className="row">
                <button onClick={() => setPlan({ hole: [], holeClosed: false })}>Clear</button>
                <button onClick={() => { const b = bboxOf(outerLocal(plan)); setPlan({ hole: circlePts(Math.min(b.w, b.h) * 0.2).map(([x, y]) => [r1(x + b.cx), r1(y + b.cy)] as Pt), holeClosed: true }) }}>Round</button>
                <button onClick={() => { const b = bboxOf(outerLocal(plan)); setPlan({ hole: rectPts(b.w * 0.35, b.h * 0.35).map(([x, y]) => [r1(x + b.cx), r1(y + b.cy)] as Pt), holeClosed: true }) }}>Square</button>
              </div>
            </div>
          )}
          <Board
            span={span}
            snap={snap}
            pts={plan.inner === 'drawn' ? plan.hole : undefined}
            closed={plan.holeClosed}
            offset={[plan.dx, plan.dy]}
            onPts={plan.inner === 'drawn' ? (hole, holeClosed) => setPlan({ hole, holeClosed }) : undefined}
            fill={planOk({ ...plan, inner: plan.inner === 'drawn' && !plan.holeClosed ? 'none' : plan.inner }) ? plateOf({ ...plan, inner: plan.inner === 'drawn' && !plan.holeClosed ? 'none' : plan.inner }) : undefined}
            ghosts={below}
            label="Inner shape"
          />
        </div>
      )}

      {step === 2 && (
        <div className="bstep">
          <p className="muted small">Stack floor plans from the bottom up. Copy the plan below and change it to step the tower in or out.</p>
          <div className="btiers">
            {[...plans.keys()].reverse().map((i) => {
              const p = plans[i]
              const pl = planOk(p) ? plateOf(p) : []
              return (
                <div key={i} className={i === cur ? 'btier on' : 'btier'}>
                  <Thumb rings={pl} />
                  <div className="btierbody">
                    <div className="btiertop">
                      <b>{i === 0 ? 'Bottom' : i === plans.length - 1 ? 'Top' : `Tier ${i + 1}`}</b>
                      <span className="muted small">{fmt(plateArea(pl))} m² a floor</span>
                      <button className="link" onClick={() => (setCur(i), setStep(0))}>
                        Edit plan
                      </button>
                      {plans.length > 1 && (
                        <button className="link" onClick={() => (setPlans(plans.filter((_, k) => k !== i)), setCur(0))}>
                          Remove
                        </button>
                      )}
                    </div>
                    <Slider label="Floors" value={p.floors} min={1} max={80} onChange={(v) => setPlans(plans.map((q, k) => (k === i ? { ...q, floors: v } : q)))} />
                    {i > 0 && (
                      <div className="dgrid">
                        <Slider label="Shift sideways" unit=" m" value={p.dx} min={-40} max={40} step={0.5} onChange={(v) => setPlans(plans.map((q, k) => (k === i ? { ...q, dx: v } : q)))} />
                        <Slider label="Shift back" unit=" m" value={p.dy} min={-40} max={40} step={0.5} onChange={(v) => setPlans(plans.map((q, k) => (k === i ? { ...q, dy: v } : q)))} />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="row">
            <button onClick={() => copyUp(1)}>+ Copy the top plan above</button>
            <button onClick={() => copyUp(0.8)}>+ Smaller copy above</button>
          </div>
          <Slider label="Podium floors underneath (fills the buildable area)" value={podium} min={0} max={8} onChange={setPodium} />
          <Elevation plans={plans.filter(planOk)} floorH={floorH} podium={podium} />
        </div>
      )}

      <div className="bfoot">
        <div className="bstats">
          <span>
            <b>{area ? fmt(area) : '–'}</b> m² this plan
          </span>
          <span>
            <b>{totalFloors}</b> floors
          </span>
          <span>
            <b>{fmt(gfa)}</b> m² tower floor area
          </span>
        </div>
        <div className={!ok ? 'bcheck wait' : fails.length ? 'bcheck bad' : 'bcheck good'}>
          {!ok ? 'Finish the shape to check it against the rules.' : props.concept?.infeasible ? props.concept.infeasible : fails.length ? `${fails.length} rule${fails.length > 1 ? 's' : ''} fail: ${fails.map((f) => f.label).join(', ')}` : 'All rules pass on this plot.'}
        </div>
        <div className="row bnav">
          {step > 0 && <button onClick={() => setStep(step - 1)}>Back</button>}
          <label className="snap muted small">
            Grid
            <select value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
              <option value={0}>free</option>
              <option value={0.5}>0.5 m</option>
              <option value={1}>1 m</option>
              <option value={2}>2 m</option>
            </select>
            Board
            <select value={span} onChange={(e) => setSpan(Number(e.target.value))}>
              {[40, 60, 80, 100, 140, 200].map((v) => (
                <option key={v} value={v}>
                  {v} m
                </option>
              ))}
              {![40, 60, 80, 100, 140, 200].includes(span) && <option value={span}>{span} m</option>}
            </select>
          </label>
          {step < 2 ? (
            <button className="next" onClick={() => setStep(step + 1)} disabled={!planOk(plan)}>
              Next step
            </button>
          ) : (
            <button className="next" onClick={props.onClose} disabled={!ok}>
              Done
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
