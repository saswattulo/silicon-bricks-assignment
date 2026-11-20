import { useState } from 'react'
import { TYPES, type BuildingType, type SystemSpec } from '../rules/engine'
import { CUSTOM_LIMITS, SYSTEM_NOTES, clampCustom, presetsFor, type CustomBuilding } from '../rules/systems'

interface Props {
  type: BuildingType
  setType: (t: BuildingType) => void
  system: SystemSpec
  systemId: string
  setSystemId: (id: string) => void
  customs: CustomBuilding[]
  setCustoms: (c: CustomBuilding[]) => void
}

const FIELDS: (keyof typeof CUSTOM_LIMITS)[] = ['groundH', 'typH', 'lowGroundH', 'lowTypH', 'towerDepth', 'towerMaxLen', 'grid', 'efficiency', 'unitArea']

export function summary(s: SystemSpec, type: BuildingType) {
  const parts = [`${s.typH.toFixed(2).replace(/0$/, '')} m floor-to-floor`, `${s.towerDepth} m deep tower plate`, s.grid ? `${s.grid} m bay` : 'free grid', `${Math.round(s.efficiency * 100)}% sellable`]
  if (type !== 'office') parts.push(`${s.unitArea} m² ${type === 'hotel' ? 'rooms' : 'units'}`)
  return parts.join(' · ')
}

export default function BuildingSystem(p: Props) {
  const [draft, setDraft] = useState<CustomBuilding | null>(null)
  const presets = presetsFor(p.type)

  const startNew = () =>
    setDraft({ ...p.system, id: `custom:${Date.now().toString(36)}`, name: `My ${TYPES[p.type].label.toLowerCase()}`, use: p.type })
  const startEdit = (c: CustomBuilding) => setDraft({ ...c })
  const editingExisting = draft && p.customs.some((c) => c.id === draft.id)

  const save = () => {
    if (!draft) return
    const c = clampCustom({ ...draft, name: draft.name.trim() || 'Custom building' })
    const next = editingExisting ? p.customs.map((x) => (x.id === c.id ? c : x)) : [...p.customs, c]
    p.setCustoms(next)
    p.setType(c.use)
    p.setSystemId(c.id)
    setDraft(null)
  }
  const remove = () => {
    if (!draft) return
    p.setCustoms(p.customs.filter((x) => x.id !== draft.id))
    if (p.systemId === draft.id) p.setSystemId('rc')
    setDraft(null)
  }

  const current = p.customs.find((c) => c.id === p.systemId)

  return (
    <div className="system">
      <label className="field">
        <span>Structure</span>
        <select
          value={p.systemId}
          onChange={(e) => {
            const v = e.target.value
            if (v === '__new') return startNew()
            const c = p.customs.find((x) => x.id === v)
            if (c) p.setType(c.use)
            p.setSystemId(v)
          }}
        >
          <optgroup label={`Standard systems (${TYPES[p.type].label.toLowerCase()})`}>
            {presets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
          {p.customs.length > 0 && (
            <optgroup label="Your buildings">
              {p.customs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({TYPES[c.use].label})
                </option>
              ))}
            </optgroup>
          )}
          <option value="__new">+ Create a custom building…</option>
        </select>
      </label>
      {!draft && (
        <div className="muted small sysnote">
          {current ? 'Your building. ' : (SYSTEM_NOTES[p.systemId] ?? '') + ' '}
          {summary(p.system, p.type)}.{' '}
          {current ? (
            <button className="link" onClick={() => startEdit(current)}>
              Edit
            </button>
          ) : (
            <button className="link" onClick={startNew}>
              Customise
            </button>
          )}
        </div>
      )}
      {draft && (
        <div className="custom">
          <label className="field">
            <span>Name</span>
            <input value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <div className="seg wide small">
            {(['condo', 'hotel', 'office'] as BuildingType[]).map((t) => (
              <button key={t} className={draft.use === t ? 'on' : ''} onClick={() => setDraft({ ...draft, use: t })}>
                {TYPES[t].label}
              </button>
            ))}
          </div>
          <div className="grid2">
            {FIELDS.filter((k) => !(k === 'unitArea' && draft.use === 'office')).map((k) => {
              const [lo, hi, label] = CUSTOM_LIMITS[k]
              const pct = k === 'efficiency'
              return (
                <label key={k} className="field">
                  <span>{pct ? 'Sellable share (%)' : label}</span>
                  <input
                    type="number"
                    min={pct ? lo * 100 : lo}
                    max={pct ? hi * 100 : hi}
                    step={pct ? 1 : k === 'unitArea' || k === 'towerMaxLen' ? 1 : 0.1}
                    value={pct ? Math.round(draft[k] * 100) : draft[k]}
                    onChange={(e) => setDraft({ ...draft, [k]: pct ? Number(e.target.value) / 100 : Number(e.target.value) })}
                  />
                </label>
              )
            })}
          </div>
          <div className="muted small">
            Saved in this browser. The use decides which zoning and parking rules apply; the numbers shape the concepts. Out-of-range values are clamped.
          </div>
          <div className="row">
            <button className="primary" onClick={save}>
              Save and use
            </button>
            <button onClick={() => setDraft(null)}>Cancel</button>
            {editingExisting && (
              <button className="danger" onClick={remove}>
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
