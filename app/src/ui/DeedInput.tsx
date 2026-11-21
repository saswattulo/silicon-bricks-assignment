import { checkDeed, type Deed } from '../rules/deed'
import { fmt } from '../rules/engine'

interface Props {
  deed: Deed
  setDeed: (d: Deed) => void
  drawnM2: number
  farCap: number | null // FAR incl. bonus, to show the floor area the deed allows
}

const num = (s: string) => Math.max(0, Number(s) || 0)

export default function DeedInput({ deed, setDeed, drawnM2, farCap }: Props) {
  const set = (patch: Partial<Deed>) => setDeed({ ...deed, ...patch })
  const c = checkDeed(deed, drawnM2)
  return (
    <div className="deed">
      <div className="deedhead">
        <b className="small">Title deed area</b>
        <div className="seg small">
          <button className={deed.unit === 'thai' ? 'on' : ''} onClick={() => set({ unit: 'thai' })}>
            rai-ngan-wah
          </button>
          <button className={deed.unit === 'sqm' ? 'on' : ''} onClick={() => set({ unit: 'sqm' })}>
            m²
          </button>
        </div>
      </div>
      {deed.unit === 'thai' ? (
        <div className="deedrow">
          <label>
            <input type="number" min={0} value={deed.rai || ''} placeholder="0" onChange={(e) => set({ rai: num(e.target.value) })} />
            <span>rai</span>
          </label>
          <label>
            <input type="number" min={0} max={3} value={deed.ngan || ''} placeholder="0" onChange={(e) => set({ ngan: num(e.target.value) })} />
            <span>ngan</span>
          </label>
          <label>
            <input type="number" min={0} max={99.9} step={0.1} value={deed.wah || ''} placeholder="0" onChange={(e) => set({ wah: num(e.target.value) })} />
            <span>sq wah</span>
          </label>
        </div>
      ) : (
        <div className="deedrow">
          <label>
            <input type="number" min={0} value={deed.sqm || ''} placeholder="0" onChange={(e) => set({ sqm: num(e.target.value) })} />
            <span>m²</span>
          </label>
        </div>
      )}
      {!c && <div className="muted small">Enter the area on the chanote to check the drawn plot against it.</div>}
      {c && (
        <div className={`deedcheck ${c.level}`}>
          <div className="deedbar">
            <span>
              Deed <b>{fmt(c.deedM2)} m²</b>
            </span>
            <span>
              Drawn <b>{fmt(c.drawnM2)} m²</b>
            </span>
            <span className="pct">
              {c.diffPct > 0 ? '+' : ''}
              {c.diffPct.toFixed(1)}%
            </span>
          </div>
          <div className="small">{c.message}</div>
          {c.level !== 'match' && farCap && (
            <div className="small muted">
              By the deed, max floor area is {fmt(farCap * c.deedM2)} m² (the drawing gives {fmt(farCap * c.drawnM2)} m²).
            </div>
          )}
        </div>
      )}
    </div>
  )
}
