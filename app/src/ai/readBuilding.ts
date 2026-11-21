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

const TierZ = z.object({
  floors: z.number().describe('storeys in this tier'),
  shape: z.enum(['rect', 'circle', 'ellipse', 'L', 'hexagon', 'octagon', 'triangle', 'polygon', 'custom']),
  sides: z.number().describe('sides when shape is polygon, else 0'),
  courtyard_pct: z.number().describe('courtyard width as % of this tier width, else 0'),
  outline: z.array(z.array(z.number())).describe('only for custom: plan corners in -0.5..0.5, else []'),
  width_m: z.number(),
  depth_m: z.number(),
  shift_x_m: z.number().describe('sideways offset of this tier centre from the main tower centre, metres, + = right'),
  shift_y_m: z.number().describe('front-back offset of this tier centre, metres, + = further back from the street'),
})

export const Reading = z.object({
  is_building: z.boolean().describe('false if the picture does not show a building, plan or massing'),
  view: z.enum(['plan', 'side', 'perspective']).describe('plan = seen from above; side = elevation or straight-on photo; perspective = angled photo or render'),
  shape: z.enum(['rect', 'circle', 'ellipse', 'L', 'hexagon', 'octagon', 'triangle', 'polygon', 'custom']).describe('footprint of the main tower: circle for round or cylindrical, ellipse for oval, polygon for any regular N-sided plan (give sides), custom for an irregular plan (give outline)'),
  sides: z.number().describe('number of sides when shape is polygon (5 for a pentagon), else 0'),
  courtyard_pct: z.number().describe('if the building wraps around an open courtyard or atrium open to the sky, the courtyard width as % of the outer width (e.g. 45), else 0'),
  outline: z.array(z.array(z.number())).describe('only for shape custom: 6 to 24 [x, y] corners of the plan, counter-clockwise, x to the right and y away from the street, scaled so the plan spans -0.5..0.5 in both; else []'),
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
  tiers: z
    .array(
      TierZ,
    )
    .describe('the tower above the podium as distinct stacked parts, bottom to top, when its size or position changes with height (setbacks, a narrower crown, a wing that stops lower). One entry if it is one straight block.'),
  roof: z.enum(['flat', 'gable', 'hip']).describe('roof form: flat (with parapet), gable (two slopes) or hip (four slopes)'),
  window_pattern: z.enum(['ribbon', 'punched', 'curtain']).describe('ribbon = continuous horizontal window bands; punched = separate windows in solid wall; curtain = all-glass facade'),
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
how much of each storey is window, a glass podium, balconies, and top floors that step back.
Describe the real form, not just a box: if the building gets narrower or moves back higher up,
or has wings of different heights, list those parts as tiers from bottom to top with their own
size and offset, so the tiers' floors add up to tower_floors. Also give the roof form and the
window pattern.
Get the plan shape right; it matters more than anything else:
- round or cylindrical towers are circle (oval ones ellipse), never rect. Look for the signs in a
  photo taken from the side: floor lines and window rows that bend into curves, shading that fades
  smoothly across the facade instead of changing at a corner, and no vertical corner edge anywhere.
  If you see these, the shape is circle even when only one face is visible;
- a regular plan with N equal sides is polygon with sides N (the Pentagon in Washington is polygon, 5 sides);
- a building wrapped around an open courtyard (a ring, a hollow square, the Pentagon) gets courtyard_pct;
- an irregular plan (curved, cross, T, U, Y, wedge) is custom with an outline traced from the image;
- per tier, the same applies, so a round tower on a square podium is a rect tier then a circle tier.
Notes are plain sentences for a non-expert.`

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
  const width = half(clamp(w, 6, 150))
  const plan = planFrom(r.shape, r.sides, r.courtyard_pct, r.outline)
  return {
    ...plan,
    width,
    depth: plan.shape === 'circle' ? width : half(clamp(dp, 6, 150)),
    towerFloors: Math.round(clamp(r.tower_floors, 1, 80)),
    podiumFloors: Math.round(clamp(r.podium_floors, 0, 8)),
    podiumFill: r.podium_floors > 0 && r.podium_wider,
    taper: Math.round(clamp(r.taper_pct, 0, 60)),
    twist: Math.round(clamp(r.twist_deg, -120, 120) / 5) * 5,
    ...tiersFrom(r, w > 0 && r.width_m > 0 ? w / r.width_m : 1),
    facade: {
      wall: colour(r.wall_colour, DEFAULT_FACADE.wall),
      glass: colour(r.glass_colour, DEFAULT_FACADE.glass),
      frame: colour(r.frame_colour, DEFAULT_FACADE.frame),
      glazing: Math.round(clamp(r.glazing_pct, 10, 90)),
      podiumGlass: r.podium_glazed,
      balconies: r.balconies,
      roofSteps: Math.round(clamp(r.roof_steps, 0, 4)),
      roofStepM: half(clamp(r.roof_step_m, 1, 6)),
      roof: r.roof ?? 'flat',
      pattern: r.window_pattern ?? 'ribbon',
    },
  }
}

type Shape = Reading['shape']

/** Plan fields for the editor: polygon sides, courtyard share and a cleaned traced outline. */
export function planFrom(shape: Shape, sides?: number, courtyardPct?: number, outline?: number[][]) {
  const pts = (outline ?? [])
    .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .slice(0, 40)
    .map((p) => [Math.max(-0.5, Math.min(0.5, p[0])), Math.max(-0.5, Math.min(0.5, p[1]))] as [number, number])
  // a traced outline needs real area, else fall back to a box
  let a = 0
  for (let i = 0; i < pts.length; i++) a += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1]
  const traced = shape === 'custom' && pts.length >= 3 && Math.abs(a / 2) > 0.05
  const n = Math.round(clamp(sides ?? 0, 0, 12))
  const sh: Shape = shape === 'custom' && !traced ? 'rect' : shape === 'polygon' && n < 3 ? 'hexagon' : shape
  const cy = clamp(courtyardPct ?? 0, 0, 80)
  return {
    shape: sh,
    sides: sh === 'polygon' ? n : undefined,
    courtyard: cy >= 10 ? Math.round(cy) / 100 : undefined,
    outline: traced ? pts : undefined,
  }
}

/** Stacked tiers when the reading found more than one; floors are made to add up to the tower. */
function tiersFrom(r: Reading, k: number): Partial<Design> {
  const ts = (r.tiers ?? []).filter((t) => t && t.floors >= 1).slice(0, 6)
  if (ts.length < 2) return { tiers: undefined }
  const tiers = ts.map((t) => {
    const width = half(clamp(t.width_m * k, 4, 150))
    const plan = planFrom(t.shape, t.sides, t.courtyard_pct, t.outline)
    return {
      floors: Math.round(clamp(t.floors, 1, 80)),
      ...plan,
      width,
      depth: plan.shape === 'circle' ? width : half(clamp(t.depth_m * k, 4, 150)),
      dx: half(clamp(t.shift_x_m * k, -40, 40)),
      dy: half(clamp(t.shift_y_m * k, -40, 40)),
    }
  })
  return { tiers, towerFloors: Math.min(80, tiers.reduce((s, t) => s + t.floors, 0)) }
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
const Lenient = Reading.extend({ tiers: z.array(TierZ.partial({ sides: true, courtyard_pct: true, outline: true })).optional() }).partial({ wall_colour: true, glass_colour: true, frame_colour: true, glazing_pct: true, podium_glazed: true, balconies: true, roof_steps: true, roof_step_m: true, notes: true, tiers: true, roof: true, window_pattern: true, sides: true, courtyard_pct: true, outline: true })
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
      tiers: (d.tiers ?? []).map((t) => ({ sides: 0, courtyard_pct: 0, outline: [], ...t })),
      sides: d.sides ?? 0,
      courtyard_pct: d.courtyard_pct ?? 0,
      outline: d.outline ?? [],
      roof: d.roof ?? 'flat',
      window_pattern: d.window_pattern ?? 'ribbon',
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
  // OpenRouter refuses (402) a request whose max_tokens the remaining credit can't cover, even
  // when the answer would be short, so ask for less room before giving up.
  let maxTokens = 2500
  for (let i = 0; i < attempts.length; i++) {
    const at = attempts[i]
    const res = await (opts.fetch ?? fetch)(ENDPOINT, {
      signal: AbortSignal.timeout(100_000),
      method: 'POST',
      headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json', 'x-title': 'Plot Envelope Bangkok' },
      body: JSON.stringify({
        model: opts.model || DEFAULT_MODEL,
        max_tokens: maxTokens,
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
      if (status === 401) throw new ReadError(`The reading service key was not accepted${why ? ` (${why})` : ''}. Check OPENROUTER_API_KEY in Vercel.`, 502)
      if (status === 402 && maxTokens > 800) {
        maxTokens = 800
        i--
        continue
      }
      if (status === 402) throw new ReadError(`The reading service account is out of credit${why ? ` (${why})` : ''}. Add credit on OpenRouter.`, 502)
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

export const GEMINI_MODEL = 'gemini-3.8-flash'
const GEMINI_FALLBACK = 'gemini-3.5-flash-lite'

/** One vision call to Google's Gemini API directly (free tier with an AI Studio key). */
export async function readBuildingGemini(opts: ReadOptions, req: ReadRequest): Promise<ReadResult> {
  const hint = req.widthM ? ` The user says the building is about ${req.widthM} m wide.` : ''
  const prompt = `Read this building and estimate its massing.${hint}\nReply with only a JSON object matching this JSON schema:\n${JSON.stringify(SCHEMA)}`
  const models = [...new Set([opts.model || GEMINI_MODEL, GEMINI_FALLBACK])]
  let text = ''
  for (let i = 0; i < models.length; i++) {
    const res = await (opts.fetch ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(models[i])}:generateContent`, {
      signal: AbortSignal.timeout(100_000),
      method: 'POST',
      headers: { 'x-goog-api-key': opts.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: req.mediaType, data: req.image } }, { text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192, temperature: 0.2 },
      }),
    })
    const raw = await res.text().catch(() => '')
    let body: {
      error?: { message?: string; code?: number; status?: string }
      promptFeedback?: { blockReason?: string }
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
    } = {}
    try {
      body = JSON.parse(raw)
    } catch {
      /* not JSON */
    }
    if (!res.ok || body.error) {
      const status = body.error?.code ?? res.status
      const why = upstream(body.error?.message ?? raw)
      console.error('Gemini error', models[i], status, raw.slice(0, 800))
      if (status === 400 && /api key/i.test(why)) throw new ReadError(`The Gemini key was not accepted (${why}). Check GEMINI_API_KEY in Vercel.`, 502)
      if (status === 401 || status === 403) throw new ReadError(`The Gemini key was not accepted${why ? ` (${why})` : ''}. Check GEMINI_API_KEY in Vercel.`, 502)
      if (i + 1 < models.length && (status === 404 || status === 429 || status >= 500)) continue // try the lighter model
      if (status === 429) throw new ReadError('The free Gemini quota is used up for now. Try again in a minute, or tomorrow.', 502)
      throw new ReadError(`The reading service failed (${status}${why ? `: ${why}` : ''}). Try again.`, 502)
    }
    if (body.promptFeedback?.blockReason) throw new ReadError('This picture could not be read. Try another one.', 422)
    text = (body.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join('')
      .trim()
    const m = /\{[\s\S]*\}/.exec(text)
    text = m ? m[0] : text
    if (parseReading(text) || i + 1 >= models.length) break
  }
  const r = parseReading(text)
  if (!r) throw new ReadError('The reading came back incomplete. Please try again.', 502)
  if (!r.is_building) throw new ReadError('That picture does not seem to show a building. Try a photo, plan or sketch of one.', 422)
  return { draft: toDraft(r, req.widthM), notes: r.notes.slice(0, 5), confidence: r.confidence, view: r.view }
}
