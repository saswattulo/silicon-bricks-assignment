// Vercel serverless function: POST a building picture, get back a draft design.
// The Claude API key lives only in the Vercel environment (ANTHROPIC_API_KEY); the browser never sees it.
// GET tells the page whether the key is set, so it can offer photo upload or fall back to samples.
import Anthropic from '@anthropic-ai/sdk'
import { readBuilding, validate, ReadError } from '../src/ai/readBuilding.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const configured = () => Boolean(process.env.ANTHROPIC_API_KEY)

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
    const result = await readBuilding(new Anthropic(), req)
    return json(result)
  } catch (e) {
    if (e instanceof ReadError) return json({ error: e.message }, e.status)
    if (e instanceof Anthropic.APIError) {
      console.error('Claude API error', e.status, e.message)
      const busy = e.status === 429 || e.status === 529
      return json({ error: busy ? 'The reading service is busy. Try again in a minute.' : 'The reading service failed. Try again.' }, 502)
    }
    console.error(e)
    return json({ error: 'Something went wrong reading the picture.' }, 500)
  }
}
