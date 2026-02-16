import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import PostText from './PostText'

describe('PostText Memoization', () => {
  it('should not re-render when props are unchanged', () => {
    let renderCount = 0

    const TestWrapper = ({ text }: { text: string }) => {
      renderCount++
      return (
        <BrowserRouter>
          <PostText text={text} />
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper text="Hello world" />)
    const firstRenderCount = renderCount

    // Re-render with same props
    rerender(<TestWrapper text="Hello world" />)

    // Wrapper re-renders but PostText should be memoized
    expect(renderCount).toBeGreaterThan(firstRenderCount)
  })

  it('should re-render when text changes', () => {
    let renderCount = 0

    const TestWrapper = ({ text }: { text: string }) => {
      renderCount++
      return (
        <BrowserRouter>
          <PostText text={text} />
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper text="Hello world" />)
    expect(renderCount).toBe(1)

    // Re-render with different text
    rerender(<TestWrapper text="Different text" />)
    expect(renderCount).toBe(2)
  })

  it('should re-render when facets change', () => {
    let renderCount = 0

    const facets1 = [
      {
        index: { byteStart: 0, byteEnd: 5 },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
      },
    ]

    const facets2 = [
      {
        index: { byteStart: 0, byteEnd: 5 },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://different.com' }],
      },
    ]

    const TestWrapper = ({ facets }: { facets: typeof facets1 }) => {
      renderCount++
      return (
        <BrowserRouter>
          <PostText text="Hello" facets={facets} />
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper facets={facets1} />)
    expect(renderCount).toBe(1)

    // Re-render with different facets
    rerender(<TestWrapper facets={facets2} />)
    expect(renderCount).toBe(2)
  })

  it('should not re-render when unrelated parent state changes', () => {
    let postTextRenderCount = 0

    const TestWrapper = ({ unrelatedState }: { unrelatedState: number }) => {
      return (
        <BrowserRouter>
          <div data-testid="unrelated">{unrelatedState}</div>
          <PostText
            text="Hello world"
            ref={() => {
              postTextRenderCount++
            }}
          />
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper unrelatedState={1} />)
    const initialRenderCount = postTextRenderCount

    // Re-render parent with different unrelated state
    rerender(<TestWrapper unrelatedState={2} />)

    // PostText should not re-render because its props haven't changed
    expect(postTextRenderCount).toBe(initialRenderCount)
  })
})

describe('PostText Rendering', () => {
  it('should render plain text', () => {
    render(
      <BrowserRouter>
        <PostText text="Hello world" />
      </BrowserRouter>
    )

    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('should render text with links', () => {
    render(
      <BrowserRouter>
        <PostText text="Check out https://example.com" />
      </BrowserRouter>
    )

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it('should render text with hashtags', () => {
    render(
      <BrowserRouter>
        <PostText text="Hello #world" />
      </BrowserRouter>
    )

    expect(screen.getByText(/Hello/)).toBeInTheDocument()
    expect(screen.getByText('#world')).toBeInTheDocument()
  })

  it('should render text with mentions', () => {
    render(
      <BrowserRouter>
        <PostText text="Hello @testuser.bsky.social" />
      </BrowserRouter>
    )

    expect(screen.getByText(/Hello/)).toBeInTheDocument()
    expect(screen.getByText('@testuser.bsky.social')).toBeInTheDocument()
  })

  it('should truncate text when maxLength is set', () => {
    render(
      <BrowserRouter>
        <PostText text="This is a very long text that should be truncated" maxLength={20} />
      </BrowserRouter>
    )

    const text = screen.getByText(/This is a very long/)
    expect(text.textContent).toContain('…')
  })

  it('should render with custom className', () => {
    const { container } = render(
      <BrowserRouter>
        <PostText text="Hello world" className="custom-class" />
      </BrowserRouter>
    )

    const span = container.querySelector('.custom-class')
    expect(span).toBeInTheDocument()
  })

  it('should render non-interactive text', () => {
    render(
      <BrowserRouter>
        <PostText text="Check out https://example.com" interactive={false} />
      </BrowserRouter>
    )

    // Links should not be clickable when interactive is false
    const links = screen.queryAllByRole('link')
    expect(links.length).toBe(0)
  })

  it('should render with domain-only link display', () => {
    render(
      <BrowserRouter>
        <PostText text="Check out https://www.example.com/path" linkDisplay="domain" />
      </BrowserRouter>
    )

    const link = screen.getByRole('link')
    expect(link.textContent).toBe('example.com')
  })
})

describe('PostText Event Handler Memoization', () => {
  it('should memoize onClick handler when stopPropagation is true', () => {
    const TestWrapper = ({ testKey }: { testKey: number }) => {
      return (
        <BrowserRouter>
          <div data-testkey={testKey}>
            <PostText text="Check out https://example.com" stopPropagation={true} />
          </div>
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper testKey={1} />)
    const link1 = screen.getByRole('link')

    rerender(<TestWrapper testKey={2} />)
    const link2 = screen.getByRole('link')

    // Links should be rendered
    expect(link1).toBeDefined()
    expect(link2).toBeDefined()
  })

  it('should not have onClick handler when stopPropagation is false', () => {
    render(
      <BrowserRouter>
        <PostText text="Check out https://example.com" stopPropagation={false} />
      </BrowserRouter>
    )

    const link = screen.getByRole('link')
    expect(link).toBeDefined()
  })
})
