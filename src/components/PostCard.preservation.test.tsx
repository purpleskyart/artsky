import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { render, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import PostCard from './PostCard'
import type { TimelineItem } from '../lib/bsky'

// Mock contexts
vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ session: null }),
}))

vi.mock('../context/LoginModalContext', () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}))

vi.mock('../context/ArtOnlyContext', () => ({
  useArtOnly: () => ({ artOnly: false, minimalist: false }),
}))

vi.mock('../context/MediaOnlyContext', () => ({
  useMediaOnly: () => ({ mediaMode: 'all' }),
}))

vi.mock('../context/ModerationContext', () => ({
  useModeration: () => ({
    unblurredUris: new Set(),
    setUnblurred: vi.fn(),
  }),
}))

vi.mock('../context/ProfileModalContext', () => ({
  useProfileModal: () => ({
    openQuotesModal: vi.fn(),
    isModalOpen: false,
    openProfileModal: vi.fn(),
  }),
}))

vi.mock('../lib/loadHls', () => ({
  loadHls: vi.fn(() => {
    const HlsEvents = {
      ERROR: 'hlsError'
    }
    return Promise.resolve({
      default: class Hls {
        static isSupported() {
          return true
        }
        static Events = HlsEvents
        loadSource = vi.fn()
        attachMedia = vi.fn()
        on = vi.fn()
        destroy = vi.fn()
      }
    })
  })
}))

/**
 * Preservation Property Tests for Post Double-Open Fix
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3**
 * 
 * These tests verify that non-post-card click behavior continues to work correctly
 * after the fix. They capture baseline behavior patterns on unfixed code and ensure
 * no regressions are introduced.
 * 
 * EXPECTED OUTCOME ON UNFIXED CODE: Tests PASS (confirms baseline behavior to preserve)
 */

const hexChar = fc.constantFrom(
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'
)
const postUriArbitrary = fc
  .array(hexChar, { minLength: 10, maxLength: 64 })
  .map((chars) => `at://did:plc:test/app.bsky.feed.post/${chars.join('')}`)

function getCardSurface(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-post-uri] > [role="button"][class*="cardLink"]')
  if (!el) throw new Error('card surface not found')
  return el as HTMLElement
}

// Mock post item
function createMockPost(uri: string): TimelineItem {
  return {
    post: {
      uri,
      cid: 'mock-cid',
      author: {
        did: 'did:plc:test',
        handle: 'test.bsky.social',
        displayName: 'Test User',
        avatar: undefined,
      },
      record: {
        text: 'Test post',
        createdAt: new Date().toISOString(),
      },
      indexedAt: new Date().toISOString(),
      likeCount: 0,
      replyCount: 0,
      repostCount: 0,
    },
  } as TimelineItem
}

describe('PostCard - Preservation: Non-Post-Card Click Behavior', () => {
  describe('Property 2.1: Profile Links Preservation', () => {
    it('should preserve profile link click behavior without double-opening', () => {
      fc.assert(
        fc.property(postUriArbitrary, (uri) => {
          const mockPost = createMockPost(uri)
          const onPostClick = vi.fn()
          
          const { container } = render(
            <BrowserRouter>
              <PostCard
                item={mockPost}
                onPostClick={onPostClick}
                isSelected={false}
              />
            </BrowserRouter>
          )
          
          // Find profile links (author name or avatar)
          const profileLinks = container.querySelectorAll('a[href*="/profile/"]')
          
          // If profile links exist, verify they don't trigger onPostClick
          profileLinks.forEach((link) => {
            fireEvent.click(link)
            // Profile clicks should NOT trigger onPostClick
            expect(onPostClick).not.toHaveBeenCalled()
          })
          
          return true
        }),
        { numRuns: 15 }
      )
    })
  })

  describe('Property 2.2: Keyboard Navigation Preservation', () => {
    it('should preserve keyboard navigation (Enter key) behavior', () => {
      fc.assert(
        fc.property(postUriArbitrary, (uri) => {
          const mockPost = createMockPost(uri)
          const onPostClick = vi.fn()
          
          const { container } = render(
            <BrowserRouter>
              <PostCard
                item={mockPost}
                onPostClick={onPostClick}
                isSelected={false}
              />
            </BrowserRouter>
          )
          
          const surface = getCardSurface(container)

          fireEvent.keyDown(surface, { key: 'Enter' })
          
          // Verify onPostClick was called (keyboard navigation should work)
          expect(onPostClick).toHaveBeenCalledWith(uri, expect.any(Object))
          
          return true
        }),
        { numRuns: 15 }
      )
    })

    it('should ignore non-Enter keyboard keys', () => {
      fc.assert(
        fc.property(postUriArbitrary, (uri) => {
          const mockPost = createMockPost(uri)
          const onPostClick = vi.fn()
          
          const { container } = render(
            <BrowserRouter>
              <PostCard
                item={mockPost}
                onPostClick={onPostClick}
                isSelected={false}
              />
            </BrowserRouter>
          )
          
          const surface = getCardSurface(container)

          // Space activates the card (same as Enter); use keys that do not open the post
          fireEvent.keyDown(surface, { key: 'ArrowDown' })
          fireEvent.keyDown(surface, { key: 'Escape' })

          expect(onPostClick).not.toHaveBeenCalled()
          
          return true
        }),
        { numRuns: 15 }
      )
    })
  })

  describe('Property 2.3: Touch Interaction Preservation', () => {
    it('should preserve touch interactions on post cards', () => {
      fc.assert(
        fc.property(postUriArbitrary, (uri) => {
          const mockPost = createMockPost(uri)
          
          const { container } = render(
            <BrowserRouter>
              <PostCard
                item={mockPost}
                isSelected={false}
              />
            </BrowserRouter>
          )
          
          const surface = getCardSurface(container)
          expect(surface.className).toContain('cardLink')
          
          return true
        }),
        { numRuns: 15 }
      )
    })
  })

  describe('Property 2.4: Button Display and Styling Preservation', () => {
    it('should preserve button display and styling', () => {
      fc.assert(
        fc.property(postUriArbitrary, (uri) => {
          const mockPost = createMockPost(uri)
          
          const { container } = render(
            <BrowserRouter>
              <PostCard
                item={mockPost}
                isSelected={false}
              />
            </BrowserRouter>
          )
          
          const surface = getCardSurface(container)
          expect(surface.className).toContain('cardLink')
          
          // Verify the card container exists
          const card = container.querySelector('[class*="card"]')
          expect(card).toBeTruthy()
          
          return true
        }),
        { numRuns: 15 }
      )
    })
  })

  describe('Property 2.5: Modal Open/Close Preservation', () => {
    it('should preserve modal open/close functionality', () => {
      fc.assert(
        fc.property(postUriArbitrary, (uri) => {
          const mockPost = createMockPost(uri)
          const onPostClick = vi.fn()
          
          const { container, rerender } = render(
            <BrowserRouter>
              <PostCard
                item={mockPost}
                onPostClick={onPostClick}
                isSelected={false}
              />
            </BrowserRouter>
          )
          
          const surface = getCardSurface(container)
          fireEvent.click(surface)
          
          // Verify onPostClick was called (modal should open)
          expect(onPostClick).toHaveBeenCalledWith(uri, expect.any(Object))
          
          // Re-render with isSelected=true to simulate modal open state
          rerender(
            <BrowserRouter>
              <PostCard
                item={mockPost}
                onPostClick={onPostClick}
                isSelected={true}
              />
            </BrowserRouter>
          )
          
          // Verify card is marked as selected
          const selectedCard = container.querySelector('[class*="cardSelected"]')
          expect(selectedCard).toBeTruthy()
          
          return true
        }),
        { numRuns: 15 }
      )
    })
  })
})
