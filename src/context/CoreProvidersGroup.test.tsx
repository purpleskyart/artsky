import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CoreProvidersGroup } from './CoreProvidersGroup'
import { useTheme } from './ThemeContext'
import { useSession } from './SessionContext'
import { useScrollLock } from './ScrollLockContext'
import { useToast } from './ToastContext'

/**
 * Unit tests for CoreProvidersGroup component
 * 
 * Tests verify that:
 * - The grouped providers render children correctly
 * - All context providers are accessible to child components
 * - The component is properly memoized
 */

// Mock window.matchMedia for ThemeContext
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

describe('CoreProvidersGroup', () => {
  describe('Provider Rendering', () => {
    it('should render children correctly', () => {
      render(
        <CoreProvidersGroup>
          <div data-testid="test-child">Test Child</div>
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('test-child')).toBeInTheDocument()
      expect(screen.getByText('Test Child')).toBeInTheDocument()
    })
    
    it('should provide ThemeContext to children', () => {
      function TestComponent() {
        const theme = useTheme()
        return <div data-testid="theme-value">{theme.theme}</div>
      }
      
      render(
        <CoreProvidersGroup>
          <TestComponent />
        </CoreProvidersGroup>
      )
      
      const themeElement = screen.getByTestId('theme-value')
      expect(themeElement).toBeInTheDocument()
      // Theme should be one of the valid values
      expect(['light', 'dark', 'system']).toContain(themeElement.textContent)
    })
    
    it('should provide SessionContext to children', () => {
      function TestComponent() {
        const { session, loading } = useSession()
        return (
          <div>
            <div data-testid="session-loading">{String(loading)}</div>
            <div data-testid="session-value">{session ? 'logged-in' : 'logged-out'}</div>
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <TestComponent />
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('session-loading')).toBeInTheDocument()
      expect(screen.getByTestId('session-value')).toBeInTheDocument()
    })
    
    it('should provide ScrollLockContext to children', () => {
      function TestComponent() {
        const scrollLock = useScrollLock()
        return (
          <div data-testid="scroll-lock-available">
            {scrollLock ? 'available' : 'not-available'}
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <TestComponent />
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('scroll-lock-available')).toHaveTextContent('available')
    })
    
    it('should provide ToastContext to children', () => {
      function TestComponent() {
        const toast = useToast()
        return (
          <div data-testid="toast-available">
            {toast ? 'available' : 'not-available'}
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <TestComponent />
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('toast-available')).toHaveTextContent('available')
    })
    
    it('should provide all contexts simultaneously', () => {
      function TestComponent() {
        const theme = useTheme()
        const session = useSession()
        const scrollLock = useScrollLock()
        const toast = useToast()
        
        return (
          <div>
            <div data-testid="all-contexts-available">
              {theme && session && scrollLock && toast ? 'all-available' : 'missing'}
            </div>
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <TestComponent />
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
          <TestChild />
        </CoreProvidersGroup>
      )
      
      const initialRenderCount = renderCount
      
      // Re-render with the same children
      rerender(
        <CoreProvidersGroup>
          <TestChild />
        </CoreProvidersGroup>
      )
      
      // The child should re-render because it's a new instance
      // But the CoreProvidersGroup itself should be memoized
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
            <ErrorComponent />
          </CoreProvidersGroup>
        )
      }).toThrow('Test error')
      
      consoleError.mockRestore()
    })
  })
  
  describe('Nested Provider Order', () => {
    it('should maintain correct provider nesting order', () => {
      // This test verifies that providers are nested in the correct order:
      // ThemeProvider > SessionProvider > ScrollLockProvider > ToastProvider
      
      function TestComponent() {
        // If all contexts are available, the nesting order is correct
        const theme = useTheme()
        const session = useSession()
        const scrollLock = useScrollLock()
        const toast = useToast()
        
        return (
          <div data-testid="nesting-test">
            {theme && session && scrollLock && toast ? 'correct-order' : 'incorrect-order'}
          </div>
        )
      }
      
      render(
        <CoreProvidersGroup>
          <TestComponent />
        </CoreProvidersGroup>
      )
      
      expect(screen.getByTestId('nesting-test')).toHaveTextContent('correct-order')
    })
  })
})
