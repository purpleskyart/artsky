import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import OptimizedPostCard from './OptimizedPostCard'
import type { TimelineItem } from '../lib/bsky'

vi.mock('./PostCard', () => ({
  default: ({ item, cardRef }: { item: TimelineItem; cardRef: (el: HTMLDivElement | null) => void }) => (
    <div ref={cardRef} data-testid="post-card">
      {item.post.uri}
    </div>
  ),
}))

describe('OptimizedPostCard', () => {
  const mockItem: TimelineItem = {
    post: {
      uri: 'at://did:plc:test/app.bsky.feed.post/test123',
      cid: 'test-cid',
      author: {
        did: 'did:plc:test',
        handle: 'test.bsky.social',
      },
      record: {
        text: 'Test post',
        createdAt: new Date().toISOString(),
      },
      indexedAt: new Date().toISOString(),
    },
  } as TimelineItem

  const defaultProps = {
    item: mockItem,
    isSelected: false,
    onMediaRef: vi.fn(),
    cardRef: vi.fn(),
    onActionsMenuOpenChange: vi.fn(),
    cardIndex: 0,
    actionsMenuOpenForIndex: null,
    onPostClick: vi.fn(),
    fillCell: false,
    nsfwBlurred: false,
    onNsfwUnblur: vi.fn(),
    onLikedChange: vi.fn(),
    seen: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders PostCard', () => {
    render(<OptimizedPostCard {...defaultProps} />)

    expect(screen.getByTestId('post-card')).toBeInTheDocument()
    expect(screen.getByText(mockItem.post.uri)).toBeInTheDocument()
  })

  it('calls cardRef with wrapper element', () => {
    const cardRef = vi.fn()
    render(<OptimizedPostCard {...defaultProps} cardRef={cardRef} />)

    expect(cardRef).toHaveBeenCalledWith(expect.any(HTMLElement))
  })
})
