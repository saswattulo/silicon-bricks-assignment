import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { readBuilding, toDraft, validate, type Reading } from './readBuilding'

const base: Reading = {
  is_building: true, view: 'perspective', shape: 'circle', width_m: 30, depth_m: 28,
  tower_floors: 22, podium_floors: 4, podium_wider: true, taper_pct: 10, twist_deg: 13,
  confidence: 'medium', notes: ['Round glass tower on a wide base.'],
}
const fake = (parsed: Reading | null, stop = 'end_turn') => {
  const parse = vi.fn(async () => ({ parsed_output: parsed, stop_reason: stop }))
  return { client: { messages: { parse } } as unknown as Anthropic, parse }
}
const img = { image: 'aGVsbG8=', mediaType: 'image/jpeg' as const }

describe('AI picture reading', () => {
  it('maps a reading to editor fields within slider ranges', () => {
    const d = toDraft({ ...base, tower_floors: 140, taper_pct: 90, width_m: 3 })
    expect(d).toMatchObject({ shape: 'circle', width: 6, depth: 6, towerFloors: 80, podiumFloors: 4, podiumFill: true, taper: 60, twist: 15 })
  })
  it('rescales to the width the user gives', () => {
    const d = toDraft({ ...base, shape: 'rect', width_m: 20, depth_m: 10 }, 40)
    expect(d).toMatchObject({ width: 40, depth: 20 })
  })
  it('validates the request', () => {
    expect(() => validate(null)).toThrow()
    expect(() => validate({ image: 'x', mediaType: 'image/gif' })).toThrow()
    expect(validate({ ...img, widthM: 999 }).widthM).toBeUndefined()
  })
  it('sends the picture to Claude and returns a draft', async () => {
    const { client, parse } = fake(base)
    const r = await readBuilding(client, { ...img, widthM: 30 })
    expect(r.draft.towerFloors).toBe(22)
    expect(r.notes).toHaveLength(1)
    const call = (parse.mock.calls[0] as unknown[])[0] as { model: string; messages: { content: { type: string }[] }[] }
    expect(call.model).toBe('claude-opus-5-5')
    expect(call.messages[0].content[0].type).toBe('image')
  })
  it('reports a non-building or refusal as a user error', async () => {
    await expect(readBuilding(fake({ ...base, is_building: false }).client, img)).rejects.toThrow(/does not seem/)
    await expect(readBuilding(fake(null, 'refusal').client, img)).rejects.toThrow(/could not be read/)
  })
})
