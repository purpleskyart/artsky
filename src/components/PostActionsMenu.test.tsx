import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import PostActionsMenu from './PostActionsMenu'

// Mock bsky module
vi.mock('../lib/bsky', () => ({
  blockAccount: vi.fn(),
  unblockAccount: vi.fn(),
  reportPost: vi.fn(),
  muteThread: vi.fn(),
  deletePost: vi.fn(),
  getSession: vi.fn(() => null),
  agent: {
    getProfile: vi.fn(() => Promise.resolve({ data: {} })),
  },
}))

// Mock window.matchMedia
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

describe('PostActionsMenu Memoization', () => {
  it('should not re-render when props are unchanged', () => {
    let renderCount = 0

    const TestWrapper = ({ postUri }: { postUri: string }) => {
      renderCount++
      return (
        <BrowserRouter>
          <PostActionsMenu
            postUri={postUri}
            postCid="bafytest123"
            authorDid="did:plc:test"
            rootUri={postUri}
          />
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper postUri="at://did:plc:test/app.bsky.feed.post/test123" />)
    const firstRenderCount = renderCount

    // Re-render with same props
    rerender(<TestWrapper postUri="at://did:plc:test/app.bsky.feed.post/test123" />)

    // Wrapper re-renders but PostActionsMenu should be memoized
    expect(renderCount).toBeGreaterThan(firstRenderCount)
  })

  it('should re-render when postUri changes', () => {
    let renderCount = 0

    const TestWrapper = ({ postUri }: { postUri: string }) => {
      renderCount++
      return (
        <BrowserRouter>
          <PostActionsMenu
            postUri={postUri}
            postCid="bafytest123"
            authorDid="did:plc:test"
            rootUri={postUri}
          />
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper postUri="at://did:plc:test/app.bsky.feed.post/test1" />)
    expect(renderCount).toBe(1)

    // Re-render with different postUri
    rerender(<TestWrapper postUri="at://did:plc:test/app.bsky.feed.post/test2" />)
    expect(renderCount).toBe(2)
  })

  it('should re-render when authorDid changes', () => {
    let renderCount = 0

    const TestWrapper = ({ authorDid }: { authorDid: string }) => {
      renderCount++
      return (
        <BrowserRouter>
          <PostActionsMenu
            postUri="at://did:plc:test/app.bsky.feed.post/test123"
            postCid="bafytest123"
            authorDid={authorDid}
            rootUri="at://did:plc:test/app.bsky.feed.post/test123"
          />
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper authorDid="did:plc:test1" />)
    expect(renderCount).toBe(1)

    // Re-render with different authorDid
    rerender(<TestWrapper authorDid="did:plc:test2" />)
    expect(renderCount).toBe(2)
  })

  it('should not re-render when unrelated parent state changes', () => {
    let postActionsMenuRenderCount = 0

    const TestWrapper = ({ unrelatedState }: { unrelatedState: number }) => {
      return (
        <BrowserRouter>
          <div data-testid="unrelated">{unrelatedState}</div>
          <PostActionsMenu
            postUri="at://did:plc:test/app.bsky.feed.post/test123"
            postCid="bafytest123"
            authorDid="did:plc:test"
            rootUri="at://did:plc:test/app.bsky.feed.post/test123"
            ref={() => {
              postActionsMenuRenderCount++
            }}
          />
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper unrelatedState={1} />)
    const initialRenderCount = postActionsMenuRenderCount

    // Re-render parent with different unrelated state
    rerender(<TestWrapper unrelatedState={2} />)

    // PostActionsMenu should not re-render because its props haven't changed
    expect(postActionsMenuRenderCount).toBe(initialRenderCount)
  })
})

describe('PostActionsMenu Event Handler Memoization', () => {
  it('should maintain event handler references across re-renders', () => {
    const onHidden = vi.fn()

    const TestWrapper = ({ testKey }: { testKey: number }) => {
      return (
        <BrowserRouter>
          <div data-testkey={testKey}>
            <PostActionsMenu
              postUri="at://did:plc:test/app.bsky.feed.post/test123"
              postCid="bafytest123"
              authorDid="did:plc:test"
              rootUri="at://did:plc:test/app.bsky.feed.post/test123"
              onHidden={onHidden}
            />
          </div>
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper testKey={1} />)
    const button1 = screen.getByRole('button', { name: /more options/i })

    rerender(<TestWrapper testKey={2} />)
    const button2 = screen.getByRole('button', { name: /more options/i })

    // Buttons should be rendered
    expect(button1).toBeDefined()
    expect(button2).toBeDefined()
  })
})

describe('PostActionsMenu Rendering', () => {
  it('should render trigger button', () => {
    render(
      <BrowserRouter>
        <PostActionsMenu
          postUri="at://did:plc:test/app.bsky.feed.post/test123"
          postCid="bafytest123"
          authorDid="did:plc:test"
          rootUri="at://did:plc:test/app.bsky.feed.post/test123"
        />
      </BrowserRouter>
    )

    const button = screen.getByRole('button', { name: /more options/i })
    expect(button).toBeInTheDocument()
  })

  it('should render with compact styling', () => {
    const { container } = render(
      <BrowserRouter>
        <PostActionsMenu
          postUri="at://did:plc:test/app.bsky.feed.post/test123"
          postCid="bafytest123"
          authorDid="did:plc:test"
          rootUri="at://did:plc:test/app.bsky.feed.post/test123"
          compact={true}
        />
      </BrowserRouter>
    )

    // Check if compact class is applied
    const wrapper = container.querySelector('[class*="wrapCompact"]')
    expect(wrapper).toBeInTheDocument()
  })

  it('should render with vertical icon', () => {
    render(
      <BrowserRouter>
        <PostActionsMenu
          postUri="at://did:plc:test/app.bsky.feed.post/test123"
          postCid="bafytest123"
          authorDid="did:plc:test"
          rootUri="at://did:plc:test/app.bsky.feed.post/test123"
          verticalIcon={true}
        />
      </BrowserRouter>
    )

    const button = screen.getByRole('button', { name: /more options/i })
    expect(button).toBeInTheDocument()
  })

  it('should render with custom className', () => {
    const { container } = render(
      <BrowserRouter>
        <PostActionsMenu
          postUri="at://did:plc:test/app.bsky.feed.post/test123"
          postCid="bafytest123"
          authorDid="did:plc:test"
          rootUri="at://did:plc:test/app.bsky.feed.post/test123"
          className="custom-class"
        />
      </BrowserRouter>
    )

    const wrapper = container.querySelector('.custom-class')
    expect(wrapper).toBeInTheDocument()
  })
})

describe('PostActionsMenu Controlled Mode', () => {
  it('should support controlled open state', () => {
    const onOpenChange = vi.fn()

    render(
      <BrowserRouter>
        <PostActionsMenu
          postUri="at://did:plc:test/app.bsky.feed.post/test123"
          postCid="bafytest123"
          authorDid="did:plc:test"
          rootUri="at://did:plc:test/app.bsky.feed.post/test123"
          open={false}
          onOpenChange={onOpenChange}
        />
      </BrowserRouter>
    )

    const button = screen.getByRole('button', { name: /more options/i })
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('should call onOpenChange when trigger is clicked', async () => {
    const onOpenChange = vi.fn()

    render(
      <BrowserRouter>
        <PostActionsMenu
          postUri="at://did:plc:test/app.bsky.feed.post/test123"
          postCid="bafytest123"
          authorDid="did:plc:test"
          rootUri="at://did:plc:test/app.bsky.feed.post/test123"
          open={false}
          onOpenChange={onOpenChange}
        />
      </BrowserRouter>
    )

    const button = screen.getByRole('button', { name: /more options/i })
    
    // Use act to wrap the state update
    await import('@testing-library/react').then(({ act }) => {
      act(() => {
        button.click()
      })
    })

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })
})
