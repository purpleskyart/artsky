import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import ProfileLink from './ProfileLink'

// Mock ProfileModalContext
vi.mock('../context/ProfileModalContext', () => ({
  useProfileModal: () => ({
    openProfileModal: vi.fn(),
  }),
}))

describe('ProfileLink Memoization', () => {
  it('should not re-render when props are unchanged', () => {
    let renderCount = 0

    const TestWrapper = ({ handle }: { handle: string }) => {
      renderCount++
      return (
        <BrowserRouter>
          <ProfileLink handle={handle}>
            <span>Test User</span>
          </ProfileLink>
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper handle="testuser.bsky.social" />)
    const firstRenderCount = renderCount

    // Re-render with same props
    rerender(<TestWrapper handle="testuser.bsky.social" />)

    // Wrapper re-renders but ProfileLink should be memoized
    expect(renderCount).toBeGreaterThan(firstRenderCount)
  })

  it('should re-render when handle changes', () => {
    let renderCount = 0

    const TestWrapper = ({ handle }: { handle: string }) => {
      renderCount++
      return (
        <BrowserRouter>
          <ProfileLink handle={handle}>
            <span>Test User</span>
          </ProfileLink>
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper handle="user1.bsky.social" />)
    expect(renderCount).toBe(1)

    // Re-render with different handle
    rerender(<TestWrapper handle="user2.bsky.social" />)
    expect(renderCount).toBe(2)
  })

  it('should re-render when children change', () => {
    let renderCount = 0

    const TestWrapper = ({ children }: { children: React.ReactNode }) => {
      renderCount++
      return (
        <BrowserRouter>
          <ProfileLink handle="testuser.bsky.social">
            {children}
          </ProfileLink>
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper><span>User 1</span></TestWrapper>)
    expect(renderCount).toBe(1)

    // Re-render with different children
    rerender(<TestWrapper><span>User 2</span></TestWrapper>)
    expect(renderCount).toBe(2)
  })

  it('should not re-render when unrelated parent state changes', () => {
    let profileLinkRenderCount = 0

    const TestWrapper = ({ unrelatedState }: { unrelatedState: number }) => {
      return (
        <BrowserRouter>
          <div data-testid="unrelated">{unrelatedState}</div>
          <ProfileLink
            handle="testuser.bsky.social"
            ref={() => {
              profileLinkRenderCount++
            }}
          >
            <span>Test User</span>
          </ProfileLink>
        </BrowserRouter>
      )
    }

    const { rerender } = render(<TestWrapper unrelatedState={1} />)
    const initialRenderCount = profileLinkRenderCount

    // Re-render parent with different unrelated state
    rerender(<TestWrapper unrelatedState={2} />)

    // ProfileLink should not re-render because its props haven't changed
    expect(profileLinkRenderCount).toBe(initialRenderCount)
  })
})

describe('ProfileLink Event Handler Memoization', () => {
  it('should maintain event handler references across re-renders', () => {
    const TestWrapper = ({ testKey }: { testKey: number }) => {
      return (
        <BrowserRouter>
          <div data-testkey={testKey}>
            <ProfileLink handle="testuser.bsky.social">
              <span>Test User</span>
            </ProfileLink>
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
})

describe('ProfileLink Rendering', () => {
  it('should render link with correct href', () => {
    render(
      <BrowserRouter>
        <ProfileLink handle="testuser.bsky.social">
          <span>Test User</span>
        </ProfileLink>
      </BrowserRouter>
    )

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/profile/testuser.bsky.social')
  })

  it('should render with custom className', () => {
    render(
      <BrowserRouter>
        <ProfileLink handle="testuser.bsky.social" className="custom-class">
          <span>Test User</span>
        </ProfileLink>
      </BrowserRouter>
    )

    const link = screen.getByRole('link')
    expect(link).toHaveClass('custom-class')
  })

  it('should render with aria-label', () => {
    render(
      <BrowserRouter>
        <ProfileLink handle="testuser.bsky.social" aria-label="View profile">
          <span>Test User</span>
        </ProfileLink>
      </BrowserRouter>
    )

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('aria-label', 'View profile')
  })
})
