import { describe, expect, it, vi } from 'vitest'
import { readBuildingGemini, readBuilding, toDraft, validate, type Reading } from './readBuilding'

const base: Reading = {
  is_building: true, view: 'perspective', shape: 'circle', width_m: 30, depth_m: 28,
  tower_floors: 22, podium_floors: 4, podium_wider: true, taper_pct: 10, twist_deg: 13,
  wall_colour: '#F0F0EB', glass_colour: 'blue-ish #5a7d9a', frame_colour: 'grey', glazing_pct: 120,
  podium_glazed: true, balconies: true, roof_steps: 2, roof_step_m: 2.5,
  tiers: [], roof: 'flat', window_pattern: 'ribbon',
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
  it('asks for fewer tokens when credit is low', async () => {
    const { opts, f } = seq([402, { error: { message: 'requires more credits', code: 402 } }], [200, { choices: [{ message: { content: JSON.stringify(base) } }] }])
    await readBuilding(opts, img)
    expect(JSON.parse(f.mock.calls[1][1].body as string).max_tokens).toBe(800)
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
    expect(toDraft(base).facade).toEqual({ wall: '#f0f0eb', glass: '#5a7d9a', frame: '#8a8279', glazing: 90, podiumGlass: true, balconies: true, roofSteps: 2, roofStepM: 2.5, roof: 'flat', pattern: 'ribbon' })
  })
  it('keeps stepped tiers and scales them with the width hint', () => {
    const d = toDraft({ ...base, shape: 'rect', width_m: 20, tiers: [
      { floors: 10, shape: 'rect', width_m: 20, depth_m: 16, shift_x_m: 0, shift_y_m: 0 },
      { floors: 5, shape: 'rect', width_m: 12, depth_m: 10, shift_x_m: 2, shift_y_m: 3 },
    ] }, 40)
    expect(d.tiers).toHaveLength(2)
    expect(d.tiers![1]).toMatchObject({ floors: 5, width: 24, depth: 20, dx: 4, dy: 6 })
    expect(d.towerFloors).toBe(15)
    expect(toDraft(base).tiers).toBeUndefined()
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

describe('Gemini reading', () => {
  it('sends the picture inline and reads the JSON reply', async () => {
    const { opts, f } = seq([200, { candidates: [{ content: { parts: [{ text: JSON.stringify(base) }] } }] }])
    const r = await readBuildingGemini(opts, img)
    expect(r.draft.towerFloors).toBe(22)
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('models/gemini-3.8-flash:generateContent')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
    expect(JSON.parse(init.body as string).contents[0].parts[0].inlineData.mimeType).toBe('image/jpeg')
  })
  it('moves to the lighter model when the first is unavailable or over quota', async () => {
    const { opts, f } = seq([429, { error: { code: 429, message: 'quota' } }], [200, { candidates: [{ content: { parts: [{ text: JSON.stringify(base) }] } }] }])
    await readBuildingGemini(opts, img)
    expect(f.mock.calls[1][0]).toContain('gemini-3.5-flash-lite')
  })
  it('explains a bad key', async () => {
    await expect(readBuildingGemini(seq([400, { error: { code: 400, message: 'API key not valid' } }]).opts, img)).rejects.toThrow(/GEMINI_API_KEY/)
  })
})
