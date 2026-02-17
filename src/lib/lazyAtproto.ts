/**
 * Lazy loading wrapper for @atproto/api to reduce initial bundle size.
 * This module dynamically imports the atproto packages only when needed.
 */

let atprotoPromise: Promise<typeof import('@atproto/api'> | null> | null = null

export async function getAtproto() {
  if (!atprotoPromise) {
    atprotoPromise = import('@atproto/api').catch(() => null)
  }
  return atprotoPromise
}

export async function createAgent(session?: unknown) {
  const atproto = await getAtproto()
  if (!atproto) return null
  const { Agent } = atproto
  return session ? new Agent(session) : new Agent({ service: 'https://bsky.social' })
}

export async function createAtpAgent(service: string = 'https://public.api.bsky.app') {
  const atproto = await getAtproto()
  if (!atproto) return null
  const { AtpAgent } = atproto
  return new AtpAgent({ service })
}
