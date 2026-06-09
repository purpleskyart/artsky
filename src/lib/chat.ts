import type { Agent, ChatBskyConvoDefs } from '@atproto/api'
import { getAgent, getSession, isAgentAuthenticated } from './bsky'
import { responseCache } from './ResponseCache'

const CHAT_SERVICE_DID = 'did:web:api.bsky.chat'
const CONVOS_CACHE_TTL_MS = 30_000
const UNREAD_COUNT_CACHE_TTL_MS = 30_000

export type ChatConvoView = ChatBskyConvoDefs.ConvoView
export type ChatMessageView = ChatBskyConvoDefs.MessageView

export type ChatReportSubject =
  | { type: 'message'; convoId: string; message: ChatMessageView }
  | { type: 'convo'; convoId: string; did: string }

export function getChatAgent(): Agent {
  const base = getAgent()
  if (!isAgentAuthenticated()) throw new Error('Not logged in')
  return base.withProxy('bsky_chat', CHAT_SERVICE_DID)
}

export function getConvoPeer(convo: ChatConvoView, myDid: string) {
  return convo.members.find((m) => m.did !== myDid) ?? convo.members[0]
}

export function isChatMessageView(
  msg: ChatBskyConvoDefs.MessageView | ChatBskyConvoDefs.DeletedMessageView | { $type?: string }
): msg is ChatMessageView {
  return msg.$type === 'chat.bsky.convo.defs#messageView' || ('text' in msg && 'sender' in msg)
}

/** True when someone else messaged you and you have not accepted yet. */
export function isIncomingMessageRequest(
  convo: ChatConvoView | null | undefined,
  myDid: string | undefined,
  messages: ChatMessageView[] = []
): boolean {
  if (!convo || convo.status !== 'request' || !myDid) return false

  if (messages.length > 0) {
    return messages.some((msg) => msg.sender.did !== myDid)
  }

  const lastMsg = convo.lastMessage
  if (lastMsg && isChatMessageView(lastMsg)) {
    return lastMsg.sender.did !== myDid
  }

  return false
}

export async function listConvos(options?: {
  limit?: number
  cursor?: string
  status?: 'request' | 'accepted'
  readState?: 'unread'
}): Promise<{ convos: ChatConvoView[]; cursor?: string }> {
  const limit = options?.limit ?? 30
  const cacheKey = `chatConvos:${limit}:${options?.cursor ?? 'initial'}:${options?.status ?? 'all'}:${options?.readState ?? 'all'}`
  const cached = responseCache.get<{ convos: ChatConvoView[]; cursor?: string }>(cacheKey)
  if (cached) return cached

  const chat = getChatAgent()
  const res = await chat.chat.bsky.convo.listConvos({
    limit,
    cursor: options?.cursor,
    status: options?.status,
    readState: options?.readState,
  })
  const data = { convos: res.data.convos, cursor: res.data.cursor }
  responseCache.set(cacheKey, data, CONVOS_CACHE_TTL_MS)
  return data
}

export async function getUnreadConvoCount(): Promise<number> {
  const cacheKey = 'chatUnreadCount'
  const cached = responseCache.get<number>(cacheKey)
  if (cached !== null && cached !== undefined) return cached

  const { convos } = await listConvos({ limit: 100, readState: 'unread' })
  const count = convos.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)
  responseCache.set(cacheKey, count, UNREAD_COUNT_CACHE_TTL_MS)
  return count
}

export function invalidateChatCache(): void {
  responseCache.invalidatePattern(/^chatConvos:/)
  responseCache.invalidate('chatUnreadCount')
}

export async function getConvoAvailability(members: string[]): Promise<{ canChat: boolean; convo?: ChatConvoView }> {
  const chat = getChatAgent()
  const res = await chat.chat.bsky.convo.getConvoAvailability({ members })
  return { canChat: res.data.canChat, convo: res.data.convo }
}

export async function getConvoForMembers(members: string[]): Promise<ChatConvoView> {
  const chat = getChatAgent()
  const res = await chat.chat.bsky.convo.getConvoForMembers({ members })
  invalidateChatCache()
  const convo = res.data.convo
  if (!convo) throw new Error('Could not start conversation')
  return convo
}

export async function getConvoMessages(
  convoId: string,
  limit = 50,
  cursor?: string
): Promise<{ messages: ChatMessageView[]; cursor?: string }> {
  const chat = getChatAgent()
  const res = await chat.chat.bsky.convo.getMessages({ convoId, limit, cursor })
  const messages = res.data.messages.filter(isChatMessageView) as ChatMessageView[]
  return { messages, cursor: res.data.cursor }
}

export async function sendChatMessage(convoId: string, text: string): Promise<ChatMessageView> {
  const chat = getChatAgent()
  const res = await chat.chat.bsky.convo.sendMessage({
    convoId,
    message: { text: text.trim() },
  })
  invalidateChatCache()
  return res.data
}

export async function updateConvoRead(convoId: string, messageId?: string): Promise<ChatConvoView> {
  const chat = getChatAgent()
  const res = await chat.chat.bsky.convo.updateRead({ convoId, messageId })
  invalidateChatCache()
  return res.data.convo
}

export async function acceptConvo(convoId: string): Promise<void> {
  const chat = getChatAgent()
  await chat.chat.bsky.convo.acceptConvo({ convoId })
  invalidateChatCache()
}

export async function leaveConvo(convoId: string): Promise<void> {
  const chat = getChatAgent()
  await chat.chat.bsky.convo.leaveConvo({ convoId })
  invalidateChatCache()
}

export async function muteConvo(convoId: string): Promise<ChatConvoView> {
  const chat = getChatAgent()
  const res = await chat.chat.bsky.convo.muteConvo({ convoId })
  invalidateChatCache()
  return res.data.convo
}

export async function unmuteConvo(convoId: string): Promise<ChatConvoView> {
  const chat = getChatAgent()
  const res = await chat.chat.bsky.convo.unmuteConvo({ convoId })
  invalidateChatCache()
  return res.data.convo
}

/** Resolve what to report for a direct conversation, matching Bluesky app behavior. */
export function getConvoReportSubject(
  convo: ChatConvoView,
  peerDid: string,
  myDid: string | undefined,
  messages: ChatMessageView[] = []
): ChatReportSubject | null {
  if (!myDid) return null

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.sender.did !== myDid) {
      return { type: 'message', convoId: convo.id, message: msg }
    }
  }

  const lastMsg = convo.lastMessage
  if (lastMsg && isChatMessageView(lastMsg) && lastMsg.sender.did !== myDid) {
    return { type: 'message', convoId: convo.id, message: lastMsg }
  }

  return { type: 'convo', convoId: convo.id, did: peerDid }
}

export async function reportConversation(subject: ChatReportSubject, reasonType: string): Promise<void> {
  if (!getSession()?.did) throw new Error('Not logged in')
  const agent = getAgent()

  if (subject.type === 'message') {
    await agent.com.atproto.moderation.createReport({
      reasonType,
      subject: {
        $type: 'chat.bsky.convo.defs#messageRef',
        messageId: subject.message.id,
        convoId: subject.convoId,
        did: subject.message.sender.did,
      } as { $type: string },
    })
    return
  }

  await agent.com.atproto.moderation.createReport({
    reasonType,
    subject: {
      $type: 'chat.bsky.convo.defs#convoRef',
      convoId: subject.convoId,
      did: subject.did,
    } as { $type: string },
  })
}
