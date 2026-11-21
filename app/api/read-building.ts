// Vercel serverless function: POST a building picture, get back a draft design.
// Keys live only in the Vercel environment; the browser never sees them.
//  - GEMINI_API_KEY (Google AI Studio) is used first when set; GEMINI_MODEL overrides gemini-3.8-flash.
//  - OPENROUTER_API_KEY otherwise; OPENROUTER_MODEL overrides anthropic/claude-sonnet-5.5.
// GET tells the page whether the key is set, so it can offer photo upload or fall back to samples.
import { readBuilding, readBuildingGemini, validate, ReadError } from '../src/ai/readBuilding.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const configured = () => Boolean(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY)

export function GET() {
  return json({ configured: configured() })
}

export async function POST(request: Request) {
  if (!configured()) return json({ error: 'Photo reading is not set up on this server yet.' }, 503)
  // Only this site's own pages may call it (stops other websites spending the key).
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (origin && host && new URL(origin).host !== host) return json({ error: 'Not allowed.' }, 403)
  try {
    const req = validate(await request.json().catch(() => null))
    const env = process.env
    const result = env.GEMINI_API_KEY
      ? await readBuildingGemini({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }, req).catch((e) => {
          // fall back to OpenRouter if it is also set up
          if (env.OPENROUTER_API_KEY && e instanceof ReadError && e.status === 502) return readBuilding({ apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL }, req)
          throw e
        })
      : await readBuilding({ apiKey: env.OPENROUTER_API_KEY!, model: env.OPENROUTER_MODEL }, req)
    return json(result)
  } catch (e) {
    if (e instanceof ReadError) return json({ error: e.message }, e.status)
    console.error(e)
    if (e instanceof Error && e.name === 'TimeoutError') return json({ error: 'The reading took too long. Try again, or try a simpler picture.' }, 504)
    return json({ error: 'Something went wrong reading the picture.' }, 500)
  }
}
