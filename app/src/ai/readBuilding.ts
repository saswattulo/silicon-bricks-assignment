// Server side only (used by api/read-building.ts on Vercel). Never imported by the browser
// bundle: it holds the prompt and calls OpenRouter with the key from the environment.
//
// A vision model (Claude Sonnet 5.5 by default, via OpenRouter) looks at a photo, plan or sketch and fills in the same parametric fields the
// "Your design" editor uses, so the draft stays editable and every rule check still runs on it.
import { z } from 'zod'
import type { Design } from '../rules/engine'

// Same as DEFAULT_FACADE in the engine; copied so this server file has no runtime imports of app code.
const DEFAULT_FACADE = { wall: '#f2eee6', glass: '#86a9c2', frame: '#8a8279' }

// Sonnet reads a building photo well and answers in seconds; Opus with deep thinking could outlast the function.
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5'
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
  wall_colour: z.string().describe('main solid facade colour as #rrggbb'),
  glass_colour: z.string().describe('window glass colour as #rrggbb'),
  frame_colour: z.string().describe('slab edge / window frame colour as #rrggbb'),
  glazing_pct: z.number().describe('share of each storey height that is window, 10 to 90'),
  podium_glazed: z.boolean().describe('true if the ground floor or podium is mostly glass'),
  balconies: z.boolean().describe('true if the upper floors have balconies or loggias'),
  roof_steps: z.number().describe('how many top floors step back to form terraces, 0 to 4'),
  roof_step_m: z.number().describe('how far each of those steps goes back, in metres'),
  confidence: z.enum(['low', 'medium', 'high']),
  notes: z.array(z.string()).describe('2 to 4 short sentences for the user: what you saw and what you had to guess'),
})
export type Reading = z.infer<typeof Reading>

const SYSTEM = `You read pictures of buildings for an early-stage massing tool in Bangkok.
From one photo, render, plan or sketch, estimate the simple massing: footprint shape and size,
storeys, a podium if any, taper and twist. Use cues such as window rows, doors (about 2.1 m), cars,
people and typical Bangkok storey heights (3-3.5 m homes and condos, 4 m offices) to estimate scale.
If the footprint is not visible (a straight-on photo), infer the most likely plan shape and a depth
from the visible side and say so in the notes. Also read the look: wall, glass and frame colours,
how much of each storey is window, a glass podium, balconies, and top floors that step back. Notes are plain sentences for a non-expert.`

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
    facade: {
      wall: colour(r.wall_colour, DEFAULT_FACADE.wall),
      glass: colour(r.glass_colour, DEFAULT_FACADE.glass),
      frame: colour(r.frame_colour, DEFAULT_FACADE.frame),
      glazing: Math.round(clamp(r.glazing_pct, 10, 90)),
      podiumGlass: r.podium_glazed,
      balconies: r.balconies,
      roofSteps: Math.round(clamp(r.roof_steps, 0, 4)),
      roofStepM: half(clamp(r.roof_step_m, 1, 6)),
    },
  }
}

const colour = (s: string, fb: string) => {
  const m = /#?([0-9a-f]{6})\b/i.exec(s ?? '')
  return m ? `#${m[1].toLowerCase()}` : fb
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

// Parse leniently: the massing fields must be there; look fields fall back to defaults.
const Lenient = Reading.partial({ wall_colour: true, glass_colour: true, frame_colour: true, glazing_pct: true, podium_glazed: true, balconies: true, roof_steps: true, roof_step_m: true, notes: true })
function parseReading(text: string): Reading | null {
  try {
    const p = Lenient.safeParse(JSON.parse(text))
    if (!p.success) return null
    const d = p.data
    return {
      ...d,
      wall_colour: d.wall_colour ?? '',
      glass_colour: d.glass_colour ?? '',
      frame_colour: d.frame_colour ?? '',
      glazing_pct: d.glazing_pct ?? 45,
      podium_glazed: d.podium_glazed ?? false,
      balconies: d.balconies ?? false,
      roof_steps: d.roof_steps ?? 0,
      roof_step_m: d.roof_step_m ?? 2,
      notes: d.notes ?? [],
    }
  } catch {
    return null
  }
}
const upstream = (s: string) => s.replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '').slice(0, 160)

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
  const image = { type: 'image_url', image_url: { url: `data:${req.mediaType};base64,${req.image}` } }
  const ask = `Read this building and estimate its massing.${hint}`
  // First try strict structured output. If the model or provider rejects that request shape,
  // ask again with the schema in the prompt and validate the JSON ourselves.
  const attempts = [
    { response_format: { type: 'json_schema', json_schema: { name: 'building_reading', strict: true, schema: SCHEMA } }, text: ask },
    { text: `${ask}\nReply with only a JSON object (no code fence) matching this JSON schema:\n${JSON.stringify(SCHEMA)}` },
  ]
  let text = ''
  for (let i = 0; i < attempts.length; i++) {
    const at = attempts[i]
    const res = await (opts.fetch ?? fetch)(ENDPOINT, {
      signal: AbortSignal.timeout(100_000),
      method: 'POST',
      headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json', 'x-title': 'Plot Envelope Bangkok' },
      body: JSON.stringify({
        model: opts.model || DEFAULT_MODEL,
        max_tokens: 4000,
        reasoning: { effort: 'low' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: [image, { type: 'text', text: at.text }] },
        ],
        ...(at.response_format ? { response_format: at.response_format } : {}),
      }),
    })
    const raw = await res.text().catch(() => '')
    let body: { error?: { message?: string; code?: number }; choices?: { message?: { content?: string | null; refusal?: string | null } }[] } = {}
    try {
      body = JSON.parse(raw)
    } catch {
      /* not JSON */
    }
    const status = res.ok && body.error ? (body.error.code ?? 502) : res.status
    if (!res.ok || body.error) {
      const why = upstream(body.error?.message ?? raw)
      console.error('OpenRouter error', status, raw.slice(0, 800))
      if (status === 401) throw new ReadError('The reading service key is not valid.', 502)
      if (status === 402) throw new ReadError('The reading service is out of credit.', 502)
      if (status === 429) throw new ReadError('The reading service is busy. Try again in a minute.', 502)
      if (i + 1 < attempts.length && status !== 408) continue // try the plain-prompt request
      throw new ReadError(`The reading service failed (${status}${why ? `: ${why}` : ''}). Try again.`, 502)
    }
    const choice = body.choices?.[0]
    if (choice?.message?.refusal) throw new ReadError('This picture could not be read. Try another one.', 422)
    text = (choice?.message?.content ?? '').trim()
    const m = /\{[\s\S]*\}/.exec(text)
    text = m ? m[0] : text
    if (parseReading(text) || i + 1 >= attempts.length) break
    console.error('Unreadable reply, retrying without strict schema:', text.slice(0, 300))
  }
  const parsed = parseReading(text)
  if (!parsed) throw new ReadError('The reading came back incomplete. Please try again.', 502)
  const r = parsed
  if (!r.is_building) throw new ReadError('That picture does not seem to show a building. Try a photo, plan or sketch of one.', 422)
  return { draft: toDraft(r, req.widthM), notes: r.notes.slice(0, 5), confidence: r.confidence, view: r.view }
}
