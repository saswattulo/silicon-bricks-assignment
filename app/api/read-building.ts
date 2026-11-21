// Vercel serverless function: POST a building picture, get back a draft design.
// The OpenRouter key lives only in the Vercel environment (OPENROUTER_API_KEY); the browser never sees it.
// OPENROUTER_MODEL optionally overrides the vision model (default anthropic/claude-opus-5.5).
// GET tells the page whether the key is set, so it can offer photo upload or fall back to samples.
import { readBuilding, validate, ReadError } from '../src/ai/readBuilding.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const configured = () => Boolean(process.env.OPENROUTER_API_KEY)

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
    const result = await readBuilding({ apiKey: process.env.OPENROUTER_API_KEY!, model: process.env.OPENROUTER_MODEL }, req)
    return json(result)
  } catch (e) {
    if (e instanceof ReadError) return json({ error: e.message }, e.status)
    console.error(e)
    return json({ error: 'Something went wrong reading the picture.' }, 500)
  }
}
