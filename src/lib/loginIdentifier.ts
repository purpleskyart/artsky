const BSKY_SOCIAL_SUFFIX = '.bsky.social'

/** Normalize a Bluesky login identifier: bare handles get .bsky.social appended. */
export function normalizeLoginIdentifier(raw: string): string {
  const id = raw.trim().replace(/^@/, '')
  if (!id) return id
  if (id.includes('.') || id.includes('@') || id.startsWith('did:')) return id
  return `${id}${BSKY_SOCIAL_SUFFIX}`
}
