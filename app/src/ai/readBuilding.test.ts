import { describe, expect, it, vi } from 'vitest'
import { readBuilding, toDraft, validate, type Reading } from './readBuilding'

const base: Reading = {
  is_building: true, view: 'perspective', shape: 'circle', width_m: 30, depth_m: 28,
  tower_floors: 22, podium_floors: 4, podium_wider: true, taper_pct: 10, twist_deg: 13,
  confidence: 'medium', notes: ['Round glass tower on a wide base.'],
}
const fake = (content: string | null, status = 200, refusal: string | null = null) => {
  const f = vi.fn(async (_u: string, _i: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content, refusal } }] }), { status }))
  return { opts: { apiKey: 'k', fetch: f as unknown as typeof fetch }, f }
}
const img = { image: 'aGVsbG8=', mediaType: 'image/jpeg' as const }

describe('AI picture reading', () => {
  it('maps a reading to editor fields within slider ranges', () => {
    const d = toDraft({ ...base, tower_floors: 140, taper_pct: 90, width_m: 3 })
    expect(d).toMatchObject({ shape: 'circle', width: 6, depth: 6, towerFloors: 80, podiumFloors: 4, podiumFill: true, taper: 60, twist: 15 })
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
    expect(body.model).toBe('anthropic/claude-opus-5.5')
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
