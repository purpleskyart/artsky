import type { PostView, TimelineItem } from './lib/bsky'

export type { PostView, TimelineItem }

export type FeedKind = 'timeline' | 'custom'
export interface FeedSource {
  kind: FeedKind
  label: string
  /** For custom: at://did/app.bsky.feed.generator/... */
  uri?: string
}

/** One feed in the mix with its percentage (0–100). Sum of all entries should be 100. */
export interface FeedMixEntry {
  source: FeedSource
  percent: number
}

// ── Forum (PurpleSky PDS-based) ─────────────────────────────────────────────

export interface ForumPost {
  uri: string
  cid: string
  did: string
  rkey: string
  title?: string
  body?: string
  createdAt?: string
  authorHandle?: string
  authorAvatar?: string
  tags?: string[]
  isPinned?: boolean
  isWiki?: boolean
  replyCount?: number
  likeCount?: number
}

export interface ForumReply {
  uri: string
  cid: string
  replyTo?: string
  author: { did: string; handle: string; avatar?: string; displayName?: string }
  record: { text?: string; createdAt?: string }
  likeCount?: number
  viewer?: { like?: string }
  isComment?: boolean
}

// ── Consensus / Polis ────────────────────────────────────────────────────

export interface ConsensusResult {
  statements: Array<{
    statementId: string
    agreeCount: number
    disagreeCount: number
    passCount: number
    totalVoters: number
    agreementRatio: number
    divisiveness: number
  }>
  totalParticipants: number
  clusterCount: number
  clusters: Array<{
    id: number
    memberCount: number
    memberIds: string[]
    avgAgreement: number
  }>
}
