import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { agent, getPostMediaInfo, type TimelineItem } from '../lib/bsky'
import PostCard from '../components/PostCard'
import Layout from '../components/Layout'
import styles from './ProfilePage.module.css'

export default function ProfilePage() {
  const { handle: handleParam } = useParams<{ handle: string }>()
  const handle = handleParam ? decodeURIComponent(handleParam) : ''
  const [items, setItems] = useState<TimelineItem[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<{ displayName?: string; avatar?: string; description?: string } | null>(null)

  useEffect(() => {
    if (!handle) return
    agent
      .getProfile({ actor: handle })
      .then((res) => {
        setProfile({
          displayName: res.data.displayName,
          avatar: res.data.avatar,
          description: (res.data as { description?: string }).description,
        })
      })
      .catch(() => {})
  }, [handle])

  const load = useCallback(async (nextCursor?: string) => {
    if (!handle) return
    try {
      if (nextCursor) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      const res = await agent.getAuthorFeed({ actor: handle, limit: 30, cursor: nextCursor })
      setItems((prev) => (nextCursor ? [...prev, ...res.data.feed] : res.data.feed))
      setCursor(res.data.cursor ?? undefined)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load profile')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [handle])

  useEffect(() => {
    if (handle) {
      setProfile(null)
      load()
    }
  }, [handle, load])

  const mediaItems = items.filter((item) => getPostMediaInfo(item.post))

  if (!handle) {
    return (
      <Layout title="Profile" showNav>
        <div className={styles.wrap}>
          <p className={styles.empty}>No profile specified.</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title={`@${handle}`} showNav>
      <div className={styles.wrap}>
        <header className={styles.profileHeader}>
          {profile?.avatar && (
            <img src={profile.avatar} alt="" className={styles.avatar} />
          )}
          <div className={styles.profileMeta}>
            {profile?.displayName && (
              <h2 className={styles.displayName}>{profile.displayName}</h2>
            )}
            <p className={styles.handle}>@{handle}</p>
            {profile?.description && (
              <p className={styles.description}>{profile.description}</p>
            )}
          </div>
        </header>
        {error && <p className={styles.error}>{error}</p>}
        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : mediaItems.length === 0 ? (
          <div className={styles.empty}>No posts with images or videos.</div>
        ) : (
          <>
            <div className={styles.grid}>
              {mediaItems.map((item) => (
                <PostCard key={item.post.uri} item={item} />
              ))}
            </div>
            {cursor && (
              <button
                type="button"
                className={styles.more}
                onClick={() => load(cursor)}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </div>
    </Layout>
  )
}
