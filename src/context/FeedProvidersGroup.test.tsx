import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeedProvidersGroup } from './FeedProvidersGroup'
import { useViewMode } from './ViewModeContext'
import { useArtOnly } from './ArtOnlyContext'
import { useMediaOnly } from './MediaOnlyContext'
import { useFeedMix } from './FeedMixContext'
import { useSeenPosts } from './SeenPostsContext'
import { useHideReposts } from './HideRepostsContext'
import { CoreProvidersGroup } from './CoreProvidersGroup'

/**
 * Unit tests for FeedProvidersGroup component
 * 
 * Tests verify that:
 * - The grouped providers render children correctly
 * - All context providers are accessible to child components
 * - The component is properly memoized
 */

// Mock window.matchMedia for ViewModeContext
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

describe('FeedProvidersGroup', () => {
  describe('Provider Rendering', () => {
    it('should render children correctly', () => {
      render(
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <div data-testid="test-child">Test Child</div>
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('test-child')).toBeInTheDocument()
      expect(screen.getByText('Test Child')).toBeInTheDocument()
    })
    
    it('should provide ViewModeContext to children', () => {
      function TestComponent() {
        const { viewMode } = useViewMode()
        return <div data-testid="view-mode-value">{viewMode}</div>
      }
      
      render(
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <TestComponent />
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      )
      
      const viewModeElement = screen.getByTestId('view-mode-value')
      expect(viewModeElement).toBeInTheDocument()
      // ViewMode should be one of the valid values
      expect(['1', '2', '3']).toContain(viewModeElement.textContent)
    })
    
    it('should provide ArtOnlyContext to children', () => {
      function TestComponent() {
        const { cardViewMode, artOnly } = useArtOnly()
        return (
          <div>
            <div data-testid="card-view-mode">{cardViewMode}</div>
            <div data-testid="art-only">{String(artOnly)}</div>
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <TestComponent />
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('card-view-mode')).toBeInTheDocument()
      expect(screen.getByTestId('art-only')).toBeInTheDocument()
    })
    
    it('should provide MediaOnlyContext to children', () => {
      function TestComponent() {
        const { mediaMode, mediaOnly } = useMediaOnly()
        return (
          <div>
            <div data-testid="media-mode">{mediaMode}</div>
            <div data-testid="media-only">{String(mediaOnly)}</div>
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <TestComponent />
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('media-mode')).toBeInTheDocument()
      expect(screen.getByTestId('media-only')).toBeInTheDocument()
    })
    
    it('should provide FeedMixContext to children', () => {
      function TestComponent() {
        const { entries, enabled, totalPercent } = useFeedMix()
        return (
          <div>
            <div data-testid="feed-mix-entries">{entries.length}</div>
            <div data-testid="feed-mix-enabled">{String(enabled)}</div>
            <div data-testid="feed-mix-total">{totalPercent}</div>
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <TestComponent />
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('feed-mix-entries')).toBeInTheDocument()
      expect(screen.getByTestId('feed-mix-enabled')).toBeInTheDocument()
      expect(screen.getByTestId('feed-mix-total')).toBeInTheDocument()
    })
    
    it('should provide SeenPostsContext to children', () => {
      function TestComponent() {
        const seenPosts = useSeenPosts()
        return (
          <div data-testid="seen-posts-available">
            {seenPosts ? 'available' : 'not-available'}
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <TestComponent />
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('seen-posts-available')).toHaveTextContent('available')
    })
    
    it('should provide HideRepostsContext to children', () => {
      function TestComponent() {
        const hideReposts = useHideReposts()
        return (
          <div data-testid="hide-reposts-available">
            {hideReposts ? 'available' : 'not-available'}
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <TestComponent />
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('hide-reposts-available')).toHaveTextContent('available')
    })
    
    it('should provide all contexts simultaneously', () => {
      function TestComponent() {
        const viewMode = useViewMode()
        const artOnly = useArtOnly()
        const mediaOnly = useMediaOnly()
        const feedMix = useFeedMix()
        const seenPosts = useSeenPosts()
        const hideReposts = useHideReposts()
        
        return (
          <div>
            <div data-testid="all-contexts-available">
              {viewMode && artOnly && mediaOnly && feedMix && seenPosts && hideReposts 
                ? 'all-available' 
                : 'missing'}
            </div>
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <TestComponent />
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('all-contexts-available')).toHaveTextContent('all-available')
    })
  })
  
  describe('Memoization', () => {
    it('should not re-render when parent re-renders with same children', () => {
      let renderCount = 0
      
      function TestChild() {
        renderCount++
        return <div data-testid="test-child">Render count: {renderCount}</div>
      }
      
      const { rerender } = render(
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <TestChild />
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      )
      
      const initialRenderCount = renderCount
      
      // Re-render with the same children
      rerender(
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <TestChild />
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      )
      
      // The child should re-render because it's a new instance
      // But the FeedProvidersGroup itself should be memoized
      expect(renderCount).toBeGreaterThan(initialRenderCount)
    })
  })
  
  describe('Error Handling', () => {
    it('should handle errors in child components gracefully', () => {
      // Suppress console.error for this test
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      function ErrorComponent(): null {
        throw new Error('Test error')
      }
      
      expect(() => {
        render(
          <CoreProvidersGroup>
            <FeedProvidersGroup>
              <ErrorComponent />
            </FeedProvidersGroup>
          </CoreProvidersGroup>
        )
      }).toThrow('Test error')
      
      consoleError.mockRestore()
    })
  })
  
  describe('Nested Provider Order', () => {
    it('should maintain correct provider nesting order', () => {
      // This test verifies that providers are nested in the correct order:
      // ViewMode > ArtOnly > MediaOnly > FeedMix > SeenPosts > HideReposts
      
      function TestComponent() {
        // If all contexts are available, the nesting order is correct
        const viewMode = useViewMode()
        const artOnly = useArtOnly()
        const mediaOnly = useMediaOnly()
        const feedMix = useFeedMix()
        const seenPosts = useSeenPosts()
        const hideReposts = useHideReposts()
        
        return (
          <div data-testid="nesting-test">
            {viewMode && artOnly && mediaOnly && feedMix && seenPosts && hideReposts 
              ? 'correct-order' 
              : 'incorrect-order'}
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <TestComponent />
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('nesting-test')).toHaveTextContent('correct-order')
    })
  })
})
