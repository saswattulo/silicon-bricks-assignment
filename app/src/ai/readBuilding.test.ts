import { describe, expect, it, vi } from 'vitest'
import { readBuilding, toDraft, validate, type Reading } from './readBuilding'

const base: Reading = {
  is_building: true, view: 'perspective', shape: 'circle', width_m: 30, depth_m: 28,
  tower_floors: 22, podium_floors: 4, podium_wider: true, taper_pct: 10, twist_deg: 13,
  wall_colour: '#F0F0EB', glass_colour: 'blue-ish #5a7d9a', frame_colour: 'grey', glazing_pct: 120,
  podium_glazed: true, balconies: true, roof_steps: 2, roof_step_m: 2.5,
  confidence: 'medium', notes: ['Round glass tower on a wide base.'],
}
const fake = (content: string | null, status = 200, refusal: string | null = null) => {
  const f = vi.fn(async (_u: string, _i: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content, refusal } }] }), { status }))
  return { opts: { apiKey: 'k', fetch: f as unknown as typeof fetch }, f }
}
const img = { image: 'aGVsbG8=', mediaType: 'image/jpeg' as const }

const seq = (...rs: [number, unknown][]) => {
  const f = vi.fn(async (_u: string, _i: RequestInit) => { const [st, b] = rs.shift()!; return new Response(JSON.stringify(b), { status: st }) })
  return { opts: { apiKey: 'k', fetch: f as unknown as typeof fetch }, f }
}

describe('AI picture reading', () => {
  it('falls back to a plain prompt when strict output is rejected, and accepts a missing look', async () => {
    const { facade: _f, ...core } = { ...base, facade: 0 }
    const noLook = Object.fromEntries(Object.entries(core).filter(([k]) => !['wall_colour', 'glass_colour', 'frame_colour', 'glazing_pct', 'podium_glazed', 'balconies', 'roof_steps', 'roof_step_m'].includes(k)))
    const { opts, f } = seq([400, { error: { message: 'response_format not supported', code: 400 } }], [200, { choices: [{ message: { content: 'Here:\n```json\n' + JSON.stringify(noLook) + '\n```' } }] }])
    const r = await readBuilding(opts, img)
    expect(f).toHaveBeenCalledTimes(2)
    expect(JSON.parse(f.mock.calls[1][1].body as string).response_format).toBeUndefined()
    expect(r.draft.towerFloors).toBe(22)
    expect(r.draft.facade?.glazing).toBe(45)
  })
  it('shows the upstream reason when both requests fail', async () => {
    const e = { error: { message: 'model not found', code: 400 } }
    await expect(readBuilding(seq([400, e], [400, e]).opts, img)).rejects.toThrow(/400: model not found/)
  })
  it('maps a reading to editor fields within slider ranges', () => {
    const d = toDraft({ ...base, tower_floors: 140, taper_pct: 90, width_m: 3 })
    expect(d).toMatchObject({ shape: 'circle', width: 6, depth: 6, towerFloors: 80, podiumFloors: 4, podiumFill: true, taper: 60, twist: 15 })
  })
  it('reads the look into a facade, with safe colours', () => {
    expect(toDraft(base).facade).toEqual({ wall: '#f0f0eb', glass: '#5a7d9a', frame: '#8a8279', glazing: 90, podiumGlass: true, balconies: true, roofSteps: 2, roofStepM: 2.5 })
  })
  it('rescales to the width the user gives', () => {
    expect(toDraft({ ...base, shape: 'rect', width_m: 20, depth_m: 10 }, 40)).toMatchObject({ width: 40, depth: 20 })
  })
  it('validates the request', () => {
    expect(() => validate(null)).toThrow()
    expect(() => validate({ image: 'x', mediaType: 'image/gif' })).toThrow()
    expect(validate({ ...img, widthM: 999 }).widthM).toBeUndefined()
  })
  it('sends the picture to OpenRouter and returns a draft', async () => {
    const { opts, f } = fake(JSON.stringify(base))
    const r = await readBuilding(opts, { ...img, widthM: 30 })
    expect(r.draft.towerFloors).toBe(22)
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('openrouter.ai')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('anthropic/claude-sonnet-5.5')
    expect(body.messages[1].content[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/)
    expect(body.response_format.json_schema.schema.required).toContain('tower_floors')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k')
  })
  it('reports errors in plain words', async () => {
    await expect(readBuilding(fake(JSON.stringify({ ...base, is_building: false })).opts, img)).rejects.toThrow(/does not seem/)
    await expect(readBuilding(fake(null, 200, 'no').opts, img)).rejects.toThrow(/could not be read/)
    await expect(readBuilding(fake('not json').opts, img)).rejects.toThrow(/incomplete/)
    await expect(readBuilding(fake(null, 402).opts, img)).rejects.toThrow(/credit/)
  })
})
