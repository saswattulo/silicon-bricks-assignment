// Server side only (used by api/read-building.ts on Vercel). Never imported by the browser
// bundle: it holds the prompt and calls OpenRouter with the key from the environment.
//
// A vision model (Claude Opus 5.5 by default, via OpenRouter) looks at a photo, plan or sketch and fills in the same parametric fields the
// "Your design" editor uses, so the draft stays editable and every rule check still runs on it.
import { z } from 'zod'
import type { Design } from '../rules/engine'

export const DEFAULT_MODEL = 'anthropic/claude-opus-5.5'
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
export const MAX_IMAGE_BYTES = 3_000_000 // base64 length cap, ~2.2 MB of JPEG

export const Reading = z.object({
  is_building: z.boolean().describe('false if the picture does not show a building, plan or massing'),
  view: z.enum(['plan', 'side', 'perspective']).describe('plan = seen from above; side = elevation or straight-on photo; perspective = angled photo or render'),
  shape: z.enum(['rect', 'circle', 'ellipse', 'L', 'hexagon', 'octagon', 'triangle']).describe('closest footprint shape of the main tower'),
  width_m: z.number().describe('estimated width of the main tower footprint in metres (diameter if round)'),
  depth_m: z.number().describe('estimated depth of the main tower footprint in metres'),
  tower_floors: z.number().describe('storeys above the podium, or all storeys if there is no podium'),
  podium_floors: z.number().describe('storeys of a wider base, 0 if none'),
  podium_wider: z.boolean().describe('true if the podium is clearly wider than the tower above it'),
  taper_pct: z.number().describe('how much smaller the top floor is than the bottom tower floor, in percent, 0 if straight'),
  twist_deg: z.number().describe('how far the top floor turns relative to the bottom, in degrees, 0 if none'),
  confidence: z.enum(['low', 'medium', 'high']),
  notes: z.array(z.string()).describe('2 to 4 short sentences for the user: what you saw and what you had to guess'),
})
export type Reading = z.infer<typeof Reading>

const SYSTEM = `You read pictures of buildings for an early-stage massing tool in Bangkok.
From one photo, render, plan or sketch, estimate the simple massing: footprint shape and size,
storeys, a podium if any, taper and twist. Use cues such as window rows, doors (about 2.1 m), cars,
people and typical Bangkok storey heights (3-3.5 m homes and condos, 4 m offices) to estimate scale.
If the footprint is not visible (a straight-on photo), infer the most likely plan shape and a depth
from the visible side and say so in the notes. Notes are plain sentences for a non-expert.`

export interface ReadRequest {
  image: string // base64, no data: prefix
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  widthM?: number // optional hint from the user
}

export interface ReadResult {
  draft: Partial<Design>
  notes: string[]
  confidence: Reading['confidence']
  view: Reading['view']
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))
const half = (v: number) => Math.round(v * 2) / 2

/** Map Claude's reading to the editor's design fields, within the editor's slider ranges. */
export function toDraft(r: Reading, widthHint?: number): Partial<Design> {
  let w = r.width_m
  let dp = r.depth_m
  if (widthHint && widthHint > 0 && w > 0) {
    const k = widthHint / w
    w *= k
    dp *= k
  }
  const width = half(clamp(w, 6, 100))
  const shape = r.shape
  return {
    shape,
    width,
    depth: shape === 'circle' ? width : half(clamp(dp, 6, 100)),
    towerFloors: Math.round(clamp(r.tower_floors, 1, 80)),
    podiumFloors: Math.round(clamp(r.podium_floors, 0, 8)),
    podiumFill: r.podium_floors > 0 && r.podium_wider,
    taper: Math.round(clamp(r.taper_pct, 0, 60)),
    twist: Math.round(clamp(r.twist_deg, -120, 120) / 5) * 5,
    outline: undefined,
  }
}

export class ReadError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export function validate(body: unknown): ReadRequest {
  const b = body as Partial<ReadRequest> | null
  if (!b || typeof b.image !== 'string' || !b.image) throw new ReadError('No picture was sent.')
  if (b.image.length > MAX_IMAGE_BYTES) throw new ReadError('The picture is too large. Try one under 2 MB.', 413)
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(b.mediaType as string)) throw new ReadError('Use a JPEG, PNG or WebP picture.')
  const widthM = typeof b.widthM === 'number' && b.widthM >= 5 && b.widthM <= 150 ? b.widthM : undefined
  return { image: b.image, mediaType: b.mediaType!, widthM }
}

// JSON schema for OpenRouter's structured output (strict: every field required, no extras).
const SCHEMA = (() => {
  const j = z.toJSONSchema(Reading) as Record<string, unknown>
  delete j.$schema
  return j
})()

export interface ReadOptions {
  apiKey: string
  model?: string
  fetch?: typeof fetch
}

/** One vision call through OpenRouter: picture in, draft design out. */
export async function readBuilding(opts: ReadOptions, req: ReadRequest): Promise<ReadResult> {
  const hint = req.widthM ? ` The user says the building is about ${req.widthM} m wide.` : ''
  const res = await (opts.fetch ?? fetch)(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json', 'x-title': 'Plot Envelope Bangkok' },
    body: JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: 8000,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${req.mediaType};base64,${req.image}` } },
            { type: 'text', text: `Read this building and estimate its massing.${hint}` },
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'building_reading', strict: true, schema: SCHEMA } },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('OpenRouter error', res.status, detail.slice(0, 500))
    if (res.status === 401) throw new ReadError('The reading service key is not valid.', 502)
    if (res.status === 402) throw new ReadError('The reading service is out of credit.', 502)
    if (res.status === 429 || res.status >= 500) throw new ReadError('The reading service is busy. Try again in a minute.', 502)
    throw new ReadError('The reading service failed. Try again.', 502)
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[] }
  const choice = body.choices?.[0]
  if (choice?.message?.refusal) throw new ReadError('This picture could not be read. Try another one.', 422)
  let text = choice?.message?.content ?? ''
  text = text.replace(/^```(?:json)?\s*|\s*```$/g, '')
  const parsed = (() => {
    try {
      return Reading.safeParse(JSON.parse(text))
    } catch {
      return null
    }
  })()
  if (!parsed?.success) throw new ReadError('The reading came back incomplete. Please try again.', 502)
  const r = parsed.data
  if (!r.is_building) throw new ReadError('That picture does not seem to show a building. Try a photo, plan or sketch of one.', 422)
  return { draft: toDraft(r, req.widthM), notes: r.notes.slice(0, 5), confidence: r.confidence, view: r.view }
}
