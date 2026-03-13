/**
 * Microcosm Constellation API – Downvote counts for AT Protocol
 *
 * @see https://constellation.microcosm.blue/
 */

const CONSTELLATION_BASE = 'https://constellation.microcosm.blue'
const DOWNVOTE_COLLECTION = 'app.artsky.feed.downvote'
const DOWNVOTE_PATH = '.subject.uri'

/** Get the number of distinct users who have downvoted a post. */
export async function getDownvoteCount(postUri: string): Promise<number> {
  const params = new URLSearchParams({
    target: postUri,
    collection: DOWNVOTE_COLLECTION,
    path: DOWNVOTE_PATH,
  })
  try {
    const res = await fetch(
      `${CONSTELLATION_BASE}/links/count/distinct-dids?${params}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return 0
    const data = (await res.json()) as { total?: number }
    return typeof data.total === 'number' ? data.total : 0
  } catch {
    return 0
  }
}

const DOWNVOTE_BATCH_SIZE = 4
const DOWNVOTE_BATCH_DELAY_MS = 150

/** Get downvote counts for multiple posts with throttling to avoid rate limits. */
export async function getDownvoteCounts(postUris: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(postUris)]
  const out: Record<string, number> = {}
  for (let i = 0; i < unique.length; i += DOWNVOTE_BATCH_SIZE) {
    const batch = unique.slice(i, i + DOWNVOTE_BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (uri) => ({ uri, count: await getDownvoteCount(uri) }))
    )
    for (const { uri, count } of results) out[uri] = count
    if (i + DOWNVOTE_BATCH_SIZE < unique.length) {
      await new Promise((r) => setTimeout(r, DOWNVOTE_BATCH_DELAY_MS))
    }
  }
  return out
}
