import { useEffect, useState, type DragEvent } from 'react'
import { DEFAULT_FACADE, type Design, type Facade, type Tier } from '../rules/engine'
import { SHAPES } from './shapes'
import { readPlan, readSide, type Pixels, type Reading } from './imageToDesign'

interface Props {
  design: Design
  setDesign: (d: Design) => void
  floorH: number
  onBuild?: () => void
}


export function Slider(p: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="dslider">
      <span>
        {p.label} <b>{p.value}{p.unit ?? ''}</b>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step ?? 1} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  )
}

/** Bundled pictures that show how picture-to-draft works. Drawn for this tool, so they read reliably. */
// hint: what the picture cannot show (floors for a plan, plan shape for a photo)
const SAMPLES: { file: string; title: string; mode: 'plan' | 'side'; widthM: number; floorH?: number; hint?: Partial<Design> }[] = [
  { file: 'round-office-plan.png', title: 'Round office tower', mode: 'plan', widthM: 28, hint: { towerFloors: 14, podiumFloors: 3, podiumFill: true, taper: 0 } },
  { file: 'tapered-condo-photo.png', title: 'Tapered condo tower', mode: 'side', widthM: 24, hint: { shape: 'rect', depth: 20 } },
  { file: 'l-condo-plan.png', title: 'L-shaped condo', mode: 'plan', widthM: 34, hint: { towerFloors: 5, podiumFloors: 3, podiumFill: false, taper: 0 } },
  { file: 'house-photo.png', title: 'Two-storey house', mode: 'side', widthM: 14, floorH: 3.6, hint: { shape: 'rect', depth: 10 } },
  { file: 'townhouses-plan.png', title: 'Row of townhouses', mode: 'plan', widthM: 40, hint: { towerFloors: 3, podiumFloors: 0, taper: 0 } },
]

async function loadPixels(file: Blob, max = 320): Promise<{ px: Pixels; url: string }> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.max(8, Math.round(bmp.width * k))
  const h = Math.max(8, Math.round(bmp.height * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, w, h)
  const id = ctx.getImageData(0, 0, w, h)
  return { px: { width: w, height: h, data: id.data }, url: c.toDataURL('image/png') }
}

const API = '/api/read-building'
interface AiResult { draft: Partial<Design>; notes: string[]; confidence: 'low' | 'medium' | 'high'; view: string }

/** Shrink a photo to at most 1024 px JPEG before it goes to the reading service. */
async function toJpeg(file: Blob, max = 896): Promise<{ data: string; url: string }> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k)
  c.height = Math.round(bmp.height * k)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  const url = c.toDataURL('image/jpeg', 0.85)
  return { data: url.slice(url.indexOf(',') + 1), url }
}

/** Picture with the detected building outlined, for the user to judge the reading. */
function preview(url: string, r: Reading): Promise<string> {
  return new Promise((res) => {
    const im = new Image()
    im.onload = () => {
      const c = document.createElement('canvas')
      c.width = r.width
      c.height = r.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(im, 0, 0)
      const ov = ctx.getImageData(0, 0, r.width, r.height)
      for (let i = 0; i < r.width * r.height; i++)
        if (r.mask[i]) {
          ov.data[i * 4] = ov.data[i * 4] * 0.55 + 249 * 0.45
          ov.data[i * 4 + 1] = ov.data[i * 4 + 1] * 0.55 + 115 * 0.45
          ov.data[i * 4 + 2] = ov.data[i * 4 + 2] * 0.55 + 22 * 0.45
        }
      ctx.putImageData(ov, 0, 0)
      if (r.outline && r.outline.length > 2 && r.mode === 'plan') {
        ctx.strokeStyle = '#c2410c'
        ctx.lineWidth = 2
        ctx.beginPath()
        r.outline.forEach(([x, y], i) => (i ? ctx.lineTo(x + 0.5, y + 0.5) : ctx.moveTo(x + 0.5, y + 0.5)))
        ctx.closePath()
        ctx.stroke()
        ctx.fillStyle = '#c2410c'
        for (const [x, y] of r.outline) ctx.fillRect(x - 1.5, y - 1.5, 3, 3)
      }
      res(c.toDataURL('image/png'))
    }
    im.src = url
  })
}

export default function DesignEditor({ design: d, setDesign, floorH, onBuild }: Props) {
  const set = (patch: Partial<Design>) => setDesign({ ...d, ...patch })
  const fa = d.facade ?? DEFAULT_FACADE
  const setFa = (patch: Partial<Facade>) => set({ facade: { ...fa, ...patch } })
  const tiers = d.tiers ?? []
  const setTiers = (ts: Tier[]) => setDesign({ ...d, tiers: ts.length ? ts : undefined, towerFloors: ts.length ? ts.reduce((n, t) => n + t.floors, 0) : d.towerFloors })
  const setTier = (i: number, patch: Partial<Tier>) => setTiers(tiers.map((t, k) => (k === i ? { ...t, ...patch } : t)))
  const addTier = () => {
    if (!tiers.length) {
      // split the current block: lower two thirds as is, the top third narrower
      const shape = d.shape === 'custom' && !d.outline ? 'rect' : d.shape
      const extra = { sides: d.sides, courtyard: d.courtyard, outline: d.shape === 'custom' ? d.outline : undefined }
      const low = Math.max(1, Math.round(d.towerFloors * 0.65))
      const up = Math.max(1, d.towerFloors - low)
      const w = d.width
      const dp = shape === 'circle' ? d.width : d.depth
      setTiers([
        { floors: low, shape, width: w, depth: dp, dx: 0, dy: 0, ...extra },
        { floors: up, shape, ...extra, width: Math.max(4, Math.round(w * 0.7 * 2) / 2), depth: Math.max(4, Math.round(dp * 0.7 * 2) / 2), dx: 0, dy: Math.round(dp * 0.1 * 2) / 2 },
      ])
      return
    }
    const t = tiers[tiers.length - 1]
    setTiers([...tiers, { ...t, floors: Math.max(1, Math.round(t.floors / 2)), width: Math.max(4, Math.round(t.width * 0.75 * 2) / 2), depth: Math.max(4, Math.round(t.depth * 0.75 * 2) / 2) }])
  }
  const [pic, setPic] = useState<{ sample: (typeof SAMPLES)[number]; url: string; px: Pixels } | null>(null)
  const [gallery, setGallery] = useState(false)
  const [mode, setMode] = useState<'plan' | 'side'>('plan')
  const [widthM, setWidthM] = useState(32)
  const [reading, setReading] = useState<{ r: Reading; img: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ai, setAi] = useState(false) // reading service available (Vercel with a key)
  const [aiPic, setAiPic] = useState<{ url: string; res?: AiResult } | null>(null)

  // Ask the server whether photo reading is on. Asked again each time the pictures open, so a tab
  // opened before the key was added still finds it.
  const probe = () =>
    fetch(API, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setAi(Boolean(j?.configured)))
      .catch(() => setAi(false))
  useEffect(() => {
    probe()
    // Stop a picture dropped elsewhere on the page from navigating the browser to the file.
    const stop = (e: Event) => e.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => (window.removeEventListener('dragover', stop), window.removeEventListener('drop', stop))
  }, [])
  useEffect(() => {
    if (gallery) probe()
  }, [gallery])
  // A picture dropped anywhere on the designer is read instead of making the browser open the file.
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f && ai) {
      setGallery(true)
      upload(f)
    }
  }

  const upload = async (file?: File) => {
    if (!file) return
    setErr('')
    setPic(null)
    setReading(null)
    setBusy(true)
    try {
      const { data, url } = await toJpeg(file)
      setAiPic({ url })
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: data, mediaType: 'image/jpeg' }),
        signal: AbortSignal.timeout(130_000),
      }).catch((e: unknown) => {
        throw new Error(
          e instanceof Error && e.name === 'TimeoutError'
            ? 'The reading took too long. Please try again.'
            : 'The connection to the reading service dropped. Please try again.',
        )
      })
      const j = await r.json().catch(() => ({ error: 'The reading service did not answer.' }))
      if (!r.ok) throw new Error(j.error ?? 'The picture could not be read.')
      setAiPic({ url, res: j as AiResult })
    } catch (e) {
      setAiPic(null)
      setErr(e instanceof Error ? e.message : 'The picture could not be read.')
    }
    setBusy(false)
  }
  const useAiDraft = () => {
    const dr = aiPic?.res?.draft
    if (!dr) return
    setDesign({ ...d, offsetX: 0, offsetY: 0, rotation: 0, tiers: undefined, hole: undefined, ...dr, outline: d.outline, trim: false })
    setAiPic(null)
    setGallery(false)
  }

  const analyse = async (p = pic, m = mode, w = widthM) => {
    if (!p) return
    setBusy(true)
    const r = m === 'plan' ? readPlan(p.px, w) : readSide(p.px, w, p.sample.floorH ?? floorH)
    setReading({ r, img: await preview(p.url, r) })
    setBusy(false)
  }
  const pick = async (sm: (typeof SAMPLES)[number]) => {
    setErr('')
    setBusy(true)
    try {
      const blob = await (await fetch(`${import.meta.env.BASE_URL}samples/${sm.file}`)).blob()
      const { px, url } = await loadPixels(blob)
      const p = { sample: sm, url, px }
      setPic(p)
      setMode(sm.mode)
      setWidthM(sm.widthM)
      await analyse(p, sm.mode, sm.widthM)
    } catch {
      setReading(null)
      setPic(null)
      setErr('The sample picture could not be loaded.')
    }
    setBusy(false)
  }
  const useDraft = () => {
    if (!reading?.r.ok) return
    const dr = reading.r.draft
    const hint = pic?.sample.hint ?? {}
    setDesign({ ...d, offsetX: 0, offsetY: 0, rotation: 0, twist: 0, tiers: undefined, sides: undefined, courtyard: undefined, hole: undefined, ...dr, ...hint, shape: dr.shape ?? hint.shape ?? (d.shape === 'custom' ? 'rect' : d.shape), trim: false })
    setPic(null)
    setReading(null)
    setGallery(false)
  }

  return (
    <div className="designer" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="dhead">
        <b>Shape your own building</b>
        {onBuild && (
          <button className="buildbtn" onClick={onBuild}>
            Build from scratch
          </button>
        )}
        <button className={gallery ? 'picbtn on' : 'picbtn'} onClick={() => setGallery((g) => !g)}>
          {gallery ? 'Hide pictures' : ai ? 'Start from a photo' : 'Start from a picture'}
        </button>
      </div>

      {gallery && !pic && !aiPic && (
        <div className="samples">
          {ai ? (
            <label className="upload">
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ''))} />
              <b>Upload a photo, plan or sketch</b>
              <span className="muted small">Read by AI into a draft you can fine-tune. Or try a sample below.</span>
            </label>
          ) : (
            <div className="muted small">
              Uploading your own photo needs the AI reading service, which isn't switched on for this copy of the site.{' '}
              <button className="link" onClick={probe}>
                Check again
              </button>
            </div>
          )}
          <div className="muted small">Pick a sample picture. The tool reads it and drafts a building you can then fine-tune.</div>
          <div className="sgrid">
            {SAMPLES.map((sm) => (
              <button key={sm.file} onClick={() => pick(sm)} disabled={busy} title={sm.title}>
                <img src={`${import.meta.env.BASE_URL}samples/${sm.file}`} alt={sm.title} loading="lazy" />
                <span>{sm.title}</span>
                <em>{sm.mode === 'plan' ? 'plan' : 'photo'}</em>
              </button>
            ))}
          </div>
        </div>
      )}

      {err && <div className="error">{err}</div>}
      {aiPic && (
        <div className="picread">
          <div className="small">
            <b>Your picture</b> · {aiPic.res ? `read by AI as a ${aiPic.res.view} view, ${aiPic.res.confidence} confidence` : 'being read by AI…'}
          </div>
          <img className="picprev" src={aiPic.url} alt="Your uploaded picture" />
          {busy && <div className="muted small">Reading the picture, this takes a few seconds…</div>}
          {aiPic.res && (
            <ul className="picnotes">
              {aiPic.res.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              <li>
                Draft: {aiPic.res.draft.shape} footprint {aiPic.res.draft.width} × {aiPic.res.draft.depth} m, {aiPic.res.draft.towerFloors} tower floors
                {aiPic.res.draft.podiumFloors ? ` on a ${aiPic.res.draft.podiumFloors}-floor podium` : ''}.
              </li>
            </ul>
          )}
          <div className="row">
            <button className="primary" disabled={!aiPic.res} onClick={useAiDraft}>
              Use as draft
            </button>
            <button disabled={busy} onClick={() => setAiPic(null)}>
              Back
            </button>
          </div>
          <div className="muted small">Your picture is sent to the AI service only to read it, and is not stored.</div>
        </div>
      )}
      {pic && (
        <div className="picread">
          <div className="small">
            <b>{pic.sample.title}</b> · read as {mode === 'plan' ? 'a plan (from above): the outline becomes the footprint' : 'a side view: height, floors, podium and taper'}
          </div>
          <label className="field inline">
            <span>About how wide is it? (m)</span>
            <input type="number" min={5} max={150} value={widthM} onChange={(e) => setWidthM(Number(e.target.value))} onBlur={() => analyse()} />
          </label>
          {reading && <img className="picprev" src={reading.img} alt="Picture with the detected building highlighted" />}
          {busy && <div className="muted small">Reading the picture…</div>}
          {reading && (
            <ul className="picnotes">
              {reading.r.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <div className="row">
            <button className="primary" disabled={!reading?.r.ok} onClick={useDraft}>
              Use as draft
            </button>
            <button onClick={() => (setPic(null), setReading(null))}>Back to samples</button>
          </div>
          <div className="muted small">Read in your browser. You can fine-tune everything below once it is a draft.</div>
        </div>
      )}

      {!tiers.length && (
        <details className="fold" open>
          <summary>Shape and size</summary>
          <div className="shapes">
            {SHAPES.map(([sh, label, path]) => (
              <button key={sh} className={d.shape === sh ? 'on' : ''} title={label} onClick={() => set({ shape: sh, depth: sh === 'circle' ? d.width : d.depth, sides: sh === 'polygon' ? (d.sides ?? 5) : d.sides })}>
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path d={path} />
                </svg>
                <span>{label}</span>
              </button>
            ))}
            {d.outline && (
              <button className={d.shape === 'custom' ? 'on' : ''} title="Traced from your picture" onClick={() => set({ shape: 'custom' })}>
                <svg viewBox="-0.6 -0.6 1.2 1.2" width="20" height="20">
                  <path d={'M' + d.outline.map(([x, y]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`).join('L') + 'Z'} />
                </svg>
                <span>Traced</span>
              </button>
            )}
          </div>
          <div className="dgrid">
            <Slider label={d.shape === 'circle' ? 'Diameter' : 'Width'} unit=" m" value={d.width} min={6} max={150} step={0.5} onChange={(v) => set({ width: v, depth: d.shape === 'circle' ? v : d.depth })} />
            {d.shape !== 'circle' && <Slider label="Depth" unit=" m" value={d.depth} min={6} max={150} step={0.5} onChange={(v) => set({ depth: v })} />}
            {d.shape === 'polygon' && <Slider label="Sides" value={d.sides ?? 5} min={3} max={12} onChange={(v) => set({ sides: v })} />}
            <Slider label="Courtyard" unit="%" value={Math.round((d.courtyard ?? 0) * 100)} min={0} max={80} step={5} onChange={(v) => set({ courtyard: v ? v / 100 : undefined })} />
          </div>
        </details>
      )}

      <details className="fold" open>
        <summary>Floors{tiers.length ? ` and tiers (${tiers.length})` : ''}</summary>
        <div className="dgrid">
          <Slider label="Podium floors" value={d.podiumFloors} min={0} max={8} onChange={(v) => set({ podiumFloors: v })} />
          {!tiers.length && <Slider label="Tower floors" value={d.towerFloors} min={1} max={80} onChange={(v) => set({ towerFloors: v })} />}
        </div>
        <label className="check">
          <input type="checkbox" checked={d.podiumFill} disabled={!d.podiumFloors} onChange={(e) => set({ podiumFill: e.target.checked })} />
          Podium fills the buildable area
        </label>
        {tiers.map((t, i) => (
          <div key={i} className="tier">
            <div className="tierhead">
              <b className="small">
                Tier {i + 1} {i === 0 ? '(bottom)' : i === tiers.length - 1 ? '(top)' : ''}
              </b>
              <select value={t.shape} onChange={(e) => setTier(i, { shape: e.target.value as Tier['shape'] })} aria-label={`Tier ${i + 1} shape`}>
                {SHAPES.map(([sh, label]) => (
                  <option key={sh} value={sh}>
                    {label}
                  </option>
                ))}
                {t.outline && <option value="custom">Traced</option>}
              </select>
              <button className="link" onClick={() => setTiers(tiers.filter((_, k) => k !== i))}>
                remove
              </button>
            </div>
            <div className="dgrid">
              <Slider label="Floors" value={t.floors} min={1} max={60} onChange={(v) => setTier(i, { floors: v })} />
              <Slider label={t.shape === 'circle' ? 'Diameter' : 'Width'} unit=" m" value={t.width} min={4} max={150} step={0.5} onChange={(v) => setTier(i, { width: v, depth: t.shape === 'circle' ? v : t.depth })} />
              {t.shape !== 'circle' && <Slider label="Depth" unit=" m" value={t.depth} min={4} max={150} step={0.5} onChange={(v) => setTier(i, { depth: v })} />}
              {t.shape === 'polygon' && <Slider label="Sides" value={t.sides ?? 5} min={3} max={12} onChange={(v) => setTier(i, { sides: v })} />}
              <Slider label="Courtyard" unit="%" value={Math.round((t.courtyard ?? 0) * 100)} min={0} max={80} step={5} onChange={(v) => setTier(i, { courtyard: v ? v / 100 : undefined })} />
              <Slider label="Shift sideways" unit=" m" value={t.dx} min={-40} max={40} step={0.5} onChange={(v) => setTier(i, { dx: v })} />
              <Slider label="Shift back" unit=" m" value={t.dy} min={-40} max={40} step={0.5} onChange={(v) => setTier(i, { dy: v })} />
            </div>
          </div>
        ))}
        <div className="row">
          <button onClick={addTier}>{tiers.length ? '+ Add a tier on top' : 'Split the tower into tiers'}</button>
          {tiers.length > 0 && <button onClick={() => setTiers([])}>Back to one block</button>}
        </div>
      </details>

      <details className="fold">
        <summary>Position on the plot</summary>
        <div className="dgrid">
          <Slider label="Rotate" unit="°" value={d.rotation} min={-90} max={90} onChange={(v) => set({ rotation: v })} />
          <Slider label="Slide along road" unit=" m" value={d.offsetX} min={-40} max={40} step={0.5} onChange={(v) => set({ offsetX: v })} />
          <Slider label="Move back from road" unit=" m" value={d.offsetY} min={-40} max={40} step={0.5} onChange={(v) => set({ offsetY: v })} />
        </div>
      </details>

      <details className="fold">
        <summary>Form: taper, twist, terraces</summary>
        <div className="dgrid">
          <Slider label="Taper to the top" unit="%" value={d.taper} min={0} max={60} onChange={(v) => set({ taper: v })} />
          <Slider label="Twist to the top" unit="°" value={d.twist} min={-120} max={120} step={5} onChange={(v) => set({ twist: v })} />
          <Slider label="Stepped roof floors" value={fa.roofSteps} min={0} max={4} onChange={(v) => setFa({ roofSteps: v })} />
          <Slider label="Each step back" unit=" m" value={fa.roofStepM} min={1} max={6} step={0.5} onChange={(v) => setFa({ roofStepM: v })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={d.trim} onChange={(e) => set({ trim: e.target.checked })} />
          Trim every floor to the legal envelope
        </label>
      </details>

      <details className="fold">
        <summary>Look: colours, windows, roof</summary>
        <div className="swatches">
          {(
            [
              ['wall', 'Walls'],
              ['glass', 'Glass'],
              ['frame', 'Frames'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="swatch">
              <input type="color" value={fa[k]} onChange={(e) => setFa({ [k]: e.target.value })} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="lookrow">
          <span className="small muted">Windows</span>
          <div className="seg small">
            {(
              [
                ['ribbon', 'Bands'],
                ['punched', 'Single'],
                ['curtain', 'All glass'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} className={(fa.pattern ?? 'ribbon') === v ? 'on' : ''} onClick={() => setFa({ pattern: v })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="lookrow">
          <span className="small muted">Roof</span>
          <div className="seg small">
            {(
              [
                ['flat', 'Flat'],
                ['gable', 'Gable'],
                ['hip', 'Hip'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} className={(fa.roof ?? 'flat') === v ? 'on' : ''} onClick={() => setFa({ roof: v })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {fa.pattern !== 'curtain' && <Slider label="Window share of each floor" unit="%" value={fa.glazing} min={10} max={90} step={5} onChange={(v) => setFa({ glazing: v })} />}
        <label className="check">
          <input type="checkbox" checked={fa.balconies} onChange={(e) => setFa({ balconies: e.target.checked })} />
          Balconies on home and hotel floors
        </label>
        <label className="check">
          <input type="checkbox" checked={fa.podiumGlass} onChange={(e) => setFa({ podiumGlass: e.target.checked })} />
          Glass lobby and podium
        </label>
      </details>
    </div>
  )
}
