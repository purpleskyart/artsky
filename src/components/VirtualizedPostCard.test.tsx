import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import VirtualizedPostCard from './VirtualizedPostCard'
import type { TimelineItem } from '../lib/bsky'

// Mock the useOffscreenOptimization hook
vi.mock('../hooks/useOffscreenOptimization', () => ({
  useOffscreenOptimization: vi.fn(() => true),
}))

// Mock PostCard component
vi.mock('./PostCard', () => ({
  default: ({ item, cardRef }: { item: TimelineItem; cardRef: (el: HTMLDivElement | null) => void }) => (
    <div ref={cardRef} data-testid="post-card">
      {item.post.uri}
    </div>
  ),
}))

describe('VirtualizedPostCard', () => {
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
    openAddDropdown: false,
    onAddClose: vi.fn(),
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

  it('should render PostCard when visible', async () => {
    const { useOffscreenOptimization } = await import('../hooks/useOffscreenOptimization')
    vi.mocked(useOffscreenOptimization).mockReturnValue(true)

    render(<VirtualizedPostCard {...defaultProps} />)
    
    expect(screen.getByTestId('post-card')).toBeInTheDocument()
    expect(screen.getByText(mockItem.post.uri)).toBeInTheDocument()
  })

  it('should always render PostCard (no minimal placeholder)', async () => {
    const { useOffscreenOptimization } = await import('../hooks/useOffscreenOptimization')
    vi.mocked(useOffscreenOptimization).mockReturnValue(false)

    render(<VirtualizedPostCard {...defaultProps} />)
    
    // Should still render full PostCard (no placeholder optimization)
    expect(screen.getByTestId('post-card')).toBeInTheDocument()
    expect(screen.getByText(mockItem.post.uri)).toBeInTheDocument()
  })

  it('should render PostCard when not visible but selected (for keyboard nav)', async () => {
    const { useOffscreenOptimization } = await import('../hooks/useOffscreenOptimization')
    vi.mocked(useOffscreenOptimization).mockReturnValue(false)

    render(<VirtualizedPostCard {...defaultProps} isSelected={true} />)
    
    // Should render full PostCard even when not visible because it's selected
    expect(screen.getByTestId('post-card')).toBeInTheDocument()
  })

  it('should call cardRef callback with element', async () => {
    const { useOffscreenOptimization } = await import('../hooks/useOffscreenOptimization')
    vi.mocked(useOffscreenOptimization).mockReturnValue(true)

    const cardRef = vi.fn()
    render(<VirtualizedPostCard {...defaultProps} cardRef={cardRef} />)
    
    expect(cardRef).toHaveBeenCalledWith(expect.any(HTMLElement))
  })
})
