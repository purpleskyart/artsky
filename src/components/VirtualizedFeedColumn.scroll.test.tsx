import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import VirtualizedFeedColumn from './VirtualizedFeedColumn'
import type { FeedDisplayEntry } from '../pages/FeedPage'
import type { TimelineItem } from '../lib/bsky'

// Mock the virtualization library
const mockMeasureElement = vi.fn()
const mockGetVirtualItems = vi.fn()
const mockGetTotalSize = vi.fn()

vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: vi.fn((config) => {
    // Store the scrollToFn for testing
    const scrollToFn = config.scrollToFn || (() => {})
    
    return {
      getVirtualItems: mockGetVirtualItems,
      getTotalSize: mockGetTotalSize,
      measureElement: mockMeasureElement,
      options: { scrollMargin: config.scrollMargin || 0 },
      scrollToFn,
    }
  }),
}))

// Mock VirtualizedPostCard
vi.mock('./VirtualizedPostCard', () => ({
  default: ({ item, cardRef }: { item: TimelineItem; cardRef: (el: HTMLDivElement | null) => void }) => (
    <div ref={cardRef} data-testid="post-card">
      {item.post.uri}
    </div>
  ),
}))

describe('VirtualizedFeedColumn - Scroll Position Stability', () => {
  const mockItem1: TimelineItem = {
    post: {
      uri: 'at://did:plc:test/app.bsky.feed.post/test1',
      cid: 'test-cid-1',
      author: {
        did: 'did:plc:test',
        handle: 'test.bsky.social',
        displayName: 'Test User',
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
        displayName: 'Test User',
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

  let originalScrollY: number
  let scrollToSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Setup default mock returns
    mockGetVirtualItems.mockReturnValue([
      { index: 0, start: 0, size: 300, end: 300, key: 0 },
      { index: 1, start: 306, size: 300, end: 606, key: 1 },
    ])
    mockGetTotalSize.mockReturnValue(606)
    
    // Save original scroll position
    originalScrollY = window.scrollY
    
    // Mock window.scrollTo
    scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    
    // Mock window.scrollY
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      configurable: true,
      value: 100,
    })
  })

  afterEach(() => {
    scrollToSpy.mockRestore()
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      configurable: true,
      value: originalScrollY,
    })
  })

  it('should track scroll position during user scrolling', async () => {
    render(<VirtualizedFeedColumn {...defaultProps} />)
    
    // Simulate scroll event
    Object.defineProperty(window, 'scrollY', { value: 200, writable: true, configurable: true })
    window.dispatchEvent(new Event('scroll'))
    
    await waitFor(() => {
      // Scroll position should be tracked by browser
      expect(window.scrollY).toBe(200)
    })
  })

  it('should allow natural scrolling without interference', async () => {
    const { rerender } = render(<VirtualizedFeedColumn {...defaultProps} />)
    
    // Set initial scroll position
    Object.defineProperty(window, 'scrollY', { value: 100, writable: true, configurable: true })
    window.dispatchEvent(new Event('scroll'))
    
    // Simulate virtualization update that changes total size
    mockGetTotalSize.mockReturnValue(800)
    
    // Simulate scroll change
    Object.defineProperty(window, 'scrollY', { value: 120, writable: true, configurable: true })
    
    // Trigger re-render with new column length
    const newColumn = [
      ...mockColumn,
      {
        entry: { type: 'post' as const, item: mockItem1, entryIndex: 2 },
        originalIndex: 2,
      },
    ]
    
    rerender(<VirtualizedFeedColumn {...defaultProps} column={newColumn} />)
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 50))
    
    // Should NOT restore scroll position - let browser handle it naturally
    expect(scrollToSpy).not.toHaveBeenCalled()
  })

  it('should not interfere with natural scroll behavior', async () => {
    const { rerender } = render(<VirtualizedFeedColumn {...defaultProps} />)
    
    // Set initial scroll position
    Object.defineProperty(window, 'scrollY', { value: 100, writable: true, configurable: true })
    window.dispatchEvent(new Event('scroll'))
    
    // Clear any calls from initial render
    scrollToSpy.mockClear()
    
    // Simulate scroll change
    Object.defineProperty(window, 'scrollY', { value: 103, writable: true, configurable: true })
    
    // Trigger re-render
    mockGetTotalSize.mockReturnValue(610)
    rerender(<VirtualizedFeedColumn {...defaultProps} />)
    
    // Wait a bit to ensure no interference
    await new Promise(resolve => setTimeout(resolve, 50))
    
    // Should not interfere with natural scrolling
    expect(scrollToSpy).not.toHaveBeenCalled()
  })

  it('should use default virtualizer scroll behavior', async () => {
    render(<VirtualizedFeedColumn {...defaultProps} />)
    
    // Get the virtualizer config from the mock
    const virtualModule = await import('@tanstack/react-virtual')
    const { useWindowVirtualizer } = vi.mocked(virtualModule)
    const virtualizerConfig = useWindowVirtualizer.mock.calls[useWindowVirtualizer.mock.calls.length - 1]?.[0]
    
    // Verify scrollToFn is NOT customized (undefined means use default)
    expect(virtualizerConfig?.scrollToFn).toBeUndefined()
  })

  it('should render items without scroll interference when items are added', async () => {
    const { rerender } = render(<VirtualizedFeedColumn {...defaultProps} />)
    
    // Set scroll position
    Object.defineProperty(window, 'scrollY', { value: 300, writable: true, configurable: true })
    window.dispatchEvent(new Event('scroll'))
    
    // Clear any previous calls
    scrollToSpy.mockClear()
    
    // Add more items
    const newColumn = [
      ...mockColumn,
      {
        entry: { type: 'post' as const, item: mockItem1, entryIndex: 2 },
        originalIndex: 2,
      },
      {
        entry: { type: 'post' as const, item: mockItem2, entryIndex: 3 },
        originalIndex: 3,
      },
    ]
    
    mockGetVirtualItems.mockReturnValue([
      { index: 0, start: 0, size: 300, end: 300, key: 0 },
      { index: 1, start: 306, size: 300, end: 606, key: 1 },
      { index: 2, start: 612, size: 300, end: 912, key: 2 },
      { index: 3, start: 918, size: 300, end: 1218, key: 3 },
    ])
    mockGetTotalSize.mockReturnValue(1218)
    
    rerender(<VirtualizedFeedColumn {...defaultProps} column={newColumn} />)
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 50))
    
    // Should NOT interfere with scroll position
    expect(scrollToSpy).not.toHaveBeenCalled()
  })
})
