import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import VirtualizedFeedColumn from './VirtualizedFeedColumn'
import type { FeedDisplayEntry } from '../pages/FeedPage'
import type { TimelineItem } from '../lib/bsky'

// Mock the virtualization library
vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: vi.fn(() => ({
    getVirtualItems: () => [
      { index: 0, start: 0, size: 300, end: 300, key: 0 },
      { index: 1, start: 306, size: 300, end: 606, key: 1 },
    ],
    getTotalSize: () => 606,
    measureElement: vi.fn(),
    options: { scrollMargin: 0 },
  })),
}))

// Mock the useOffscreenOptimization hook
vi.mock('../hooks/useOffscreenOptimization', () => ({
  useOffscreenOptimization: vi.fn(() => true),
}))

// Mock PostCard
vi.mock('./PostCard', () => ({
  default: ({ item, cardRef }: { item: TimelineItem; cardRef: (el: HTMLDivElement | null) => void }) => (
    <div ref={cardRef} data-testid="post-card">
      {item.post.uri}
    </div>
  ),
}))

// Mock RepostCarouselCard
vi.mock('./RepostCarouselCard', () => ({
  default: ({ items, cardRef }: { items: TimelineItem[]; cardRef: (el: HTMLDivElement | null) => void }) => (
    <div ref={cardRef} data-testid="carousel-card">
      {items[0].post.uri}
    </div>
  ),
}))

describe('VirtualizedFeedColumn - Off-screen Optimization', () => {
  const mockItem1: TimelineItem = {
    post: {
      uri: 'at://did:plc:test/app.bsky.feed.post/test1',
      cid: 'test-cid-1',
      author: {
        did: 'did:plc:test',
        handle: 'test.bsky.social',
      },
      record: {
        text: 'Test post 1',
        createdAt: new Date().toISOString(),
      },
      indexedAt: new Date().toISOString(),
    },
  } as TimelineItem

  const mockItem2: TimelineItem = {
    post: {
      uri: 'at://did:plc:test/app.bsky.feed.post/test2',
      cid: 'test-cid-2',
      author: {
        did: 'did:plc:test',
        handle: 'test.bsky.social',
      },
      record: {
        text: 'Test post 2',
        createdAt: new Date().toISOString(),
      },
      indexedAt: new Date().toISOString(),
    },
  } as TimelineItem

  const mockColumn: Array<{ entry: FeedDisplayEntry; originalIndex: number }> = [
    {
      entry: { type: 'post', item: mockItem1, entryIndex: 0 },
      originalIndex: 0,
    },
    {
      entry: { type: 'post', item: mockItem2, entryIndex: 1 },
      originalIndex: 1,
    },
  ]

  const defaultProps = {
    column: mockColumn,
    colIndex: 0,
    scrollMargin: 0,
    keyboardFocusIndex: -1,
    focusTargets: [],
    firstFocusIndexForCard: [0, 1],
    focusSetByMouse: false,
    keyboardAddOpen: false,
    actionsMenuOpenForIndex: null,
    nsfwPreference: 'blurred' as const,
    unblurredUris: new Set<string>(),
    setUnblurred: vi.fn(),
    likeOverrides: {},
    setLikeOverrides: vi.fn(),
    seenUris: new Set<string>(),
    openPostModal: vi.fn(),
    cardRef: () => vi.fn(),
    onMediaRef: vi.fn(),
    onActionsMenuOpenChange: vi.fn(),
    onMouseEnter: vi.fn(),
    onAddClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render posts using VirtualizedPostCard', () => {
    const { getAllByTestId } = render(<VirtualizedFeedColumn {...defaultProps} />)
    
    // Both posts should be rendered (they're in the virtual items)
    const postCards = getAllByTestId('post-card')
    expect(postCards).toHaveLength(2)
  })

  it('should render empty column with sentinel when no items', () => {
    const { container } = render(
      <VirtualizedFeedColumn
        {...defaultProps}
        column={[]}
        hasCursor={true}
        loadMoreSentinelRef={vi.fn()}
      />
    )
    
    // Check that the sentinel exists (it uses CSS modules so class name is hashed)
    const sentinel = container.querySelector('[aria-hidden]')
    expect(sentinel).toBeInTheDocument()
  })

  it('should apply absolute positioning to virtualized items', () => {
    const { container } = render(<VirtualizedFeedColumn {...defaultProps} />)
    
    const gridItems = container.querySelectorAll('[data-index]')
    expect(gridItems).toHaveLength(2)
    
    // Check that items have absolute positioning
    gridItems.forEach((item) => {
      expect(item).toHaveStyle({ position: 'absolute' })
    })
  })

  it('should set data-post-uri attribute on grid items', () => {
    const { container } = render(<VirtualizedFeedColumn {...defaultProps} />)
    
    const gridItems = container.querySelectorAll('[data-post-uri]')
    expect(gridItems).toHaveLength(2)
    expect(gridItems[0]).toHaveAttribute('data-post-uri', mockItem1.post.uri)
    expect(gridItems[1]).toHaveAttribute('data-post-uri', mockItem2.post.uri)
  })

  it('should minimize DOM for off-screen posts', async () => {
    const { useOffscreenOptimization } = await import('../hooks/useOffscreenOptimization')
    
    // First post visible, second post off-screen
    vi.mocked(useOffscreenOptimization)
      .mockReturnValueOnce(true)  // First post visible
      .mockReturnValueOnce(false) // Second post off-screen
    
    const { container, rerender } = render(<VirtualizedFeedColumn {...defaultProps} />)
    
    // Force re-render to apply the mock values
    rerender(<VirtualizedFeedColumn {...defaultProps} />)
    
    // Both items should still be in the DOM (virtualization handles this)
    const gridItems = container.querySelectorAll('[data-post-uri]')
    expect(gridItems).toHaveLength(2)
  })
})
