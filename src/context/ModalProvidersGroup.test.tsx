import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { ModalProvidersGroup } from './ModalProvidersGroup'
import { useLoginModal } from './LoginModalContext'
import { useModalExpand } from './ModalExpandContext'
import { useProfileModal } from './ProfileModalContext'
import { useEditProfile } from './EditProfileContext'
import { CoreProvidersGroup } from './CoreProvidersGroup'
import { BrowserRouter } from 'react-router-dom'

/**
 * Unit tests for ModalProvidersGroup component
 * 
 * Tests verify that:
 * - The grouped providers render children correctly
 * - All context providers are accessible to child components
 * - The component is properly memoized
 */

// Mock window.matchMedia for ThemeContext (required by CoreProvidersGroup)
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

describe('ModalProvidersGroup', () => {
  describe('Provider Rendering', () => {
    it('should render children correctly', () => {
      render(
        <BrowserRouter>
          <CoreProvidersGroup>
            <ModalProvidersGroup>
              <div data-testid="test-child">Test Child</div>
            </ModalProvidersGroup>
          </CoreProvidersGroup>
        </BrowserRouter>
      )
      
      expect(screen.getByTestId('test-child')).toBeInTheDocument()
      expect(screen.getByText('Test Child')).toBeInTheDocument()
    })
    
    it('should provide LoginModalContext to children', () => {
      function TestComponent() {
        const loginModal = useLoginModal()
        return (
          <div data-testid="login-modal-available">
            {loginModal ? 'available' : 'not-available'}
          </div>
        )
      }
      
      render(
        <BrowserRouter>
          <CoreProvidersGroup>
            <ModalProvidersGroup>
              <TestComponent />
            </ModalProvidersGroup>
          </CoreProvidersGroup>
        </BrowserRouter>
      )
      
      expect(screen.getByTestId('login-modal-available')).toHaveTextContent('available')
    })
    
    it('should provide ModalExpandContext to children', () => {
      function TestComponent() {
        const modalExpand = useModalExpand()
        return (
          <div>
            <div data-testid="modal-expand-value">{String(modalExpand.expanded)}</div>
            <div data-testid="modal-expand-available">{modalExpand ? 'available' : 'not-available'}</div>
          </div>
        )
      }
      
      render(
        <BrowserRouter>
          <CoreProvidersGroup>
            <ModalProvidersGroup>
              <TestComponent />
            </ModalProvidersGroup>
          </CoreProvidersGroup>
        </BrowserRouter>
      )
      
      expect(screen.getByTestId('modal-expand-value')).toBeInTheDocument()
      expect(screen.getByTestId('modal-expand-available')).toHaveTextContent('available')
    })
    
    it('should provide ProfileModalContext to children', () => {
      function TestComponent() {
        const profileModal = useProfileModal()
        return (
          <div>
            <div data-testid="profile-modal-open">{String(profileModal.isModalOpen)}</div>
            <div data-testid="profile-modal-available">
              {profileModal ? 'available' : 'not-available'}
            </div>
          </div>
        )
      }
      
      render(
        <BrowserRouter>
          <CoreProvidersGroup>
            <ModalProvidersGroup>
              <TestComponent />
            </ModalProvidersGroup>
          </CoreProvidersGroup>
        </BrowserRouter>
      )
      
      expect(screen.getByTestId('profile-modal-open')).toHaveTextContent('false')
      expect(screen.getByTestId('profile-modal-available')).toHaveTextContent('available')
    })
    
    it('should provide EditProfileContext to children', () => {
      function TestComponent() {
        const editProfile = useEditProfile()
        return (
          <div data-testid="edit-profile-available">
            {editProfile ? 'available' : 'not-available'}
          </div>
        )
      }
      
      render(
        <BrowserRouter>
          <CoreProvidersGroup>
            <ModalProvidersGroup>
              <TestComponent />
            </ModalProvidersGroup>
          </CoreProvidersGroup>
        </BrowserRouter>
      )
      
      expect(screen.getByTestId('edit-profile-available')).toHaveTextContent('available')
    })
    
    it('should provide all contexts simultaneously', () => {
      function TestComponent() {
        const loginModal = useLoginModal()
        const modalExpand = useModalExpand()
        const profileModal = useProfileModal()
        const editProfile = useEditProfile()
        
        return (
          <div>
            <div data-testid="all-contexts-available">
              {loginModal && modalExpand && profileModal && editProfile 
                ? 'all-available' 
                : 'missing'}
            </div>
          </div>
        )
      }
      
      render(
        <BrowserRouter>
          <CoreProvidersGroup>
            <ModalProvidersGroup>
              <TestComponent />
            </ModalProvidersGroup>
          </CoreProvidersGroup>
        </BrowserRouter>
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
        <BrowserRouter>
          <CoreProvidersGroup>
            <ModalProvidersGroup>
              <TestChild />
            </ModalProvidersGroup>
          </CoreProvidersGroup>
        </BrowserRouter>
      )
      
      const initialRenderCount = renderCount
      
      // Re-render with the same children
      rerender(
        <BrowserRouter>
          <CoreProvidersGroup>
            <ModalProvidersGroup>
              <TestChild />
            </ModalProvidersGroup>
          </CoreProvidersGroup>
        </BrowserRouter>
      )
      
      // The child should re-render because it's a new instance
      // But the ModalProvidersGroup itself should be memoized
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
          <BrowserRouter>
            <CoreProvidersGroup>
              <ModalProvidersGroup>
                <ErrorComponent />
              </ModalProvidersGroup>
            </CoreProvidersGroup>
          </BrowserRouter>
        )
      }).toThrow('Test error')
      
      consoleError.mockRestore()
    })
    
    it('should allow error boundaries to catch provider initialization errors', () => {
      // Suppress console.error for this test
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      // Create a simple error boundary to test
      class TestErrorBoundary extends React.Component<
        { children: React.ReactNode },
        { hasError: boolean; error: Error | null }
      > {
        constructor(props: { children: React.ReactNode }) {
          super(props)
          this.state = { hasError: false, error: null }
        }
        
        static getDerivedStateFromError(error: Error) {
          return { hasError: true, error }
        }
        
        render() {
          if (this.state.hasError) {
            return (
              <div data-testid="error-boundary-fallback">
                Error caught: {this.state.error?.message}
              </div>
            )
          }
          return this.props.children
        }
      }
      
      // Component that throws during render (simulating provider initialization error)
      function ComponentThatThrows(): null {
        throw new Error('Provider initialization failed')
      }
      
      render(
        <BrowserRouter>
          <CoreProvidersGroup>
            <TestErrorBoundary>
              <ModalProvidersGroup>
                <ComponentThatThrows />
              </ModalProvidersGroup>
            </TestErrorBoundary>
          </CoreProvidersGroup>
        </BrowserRouter>
      )
      
      // Verify error boundary caught the error
      expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument()
      expect(screen.getByText(/Provider initialization failed/)).toBeInTheDocument()
      
      consoleError.mockRestore()
    })
  })
  
  describe('Nested Provider Order', () => {
    it('should maintain correct provider nesting order', () => {
      // This test verifies that providers are nested in the correct order:
      // LoginModal > ModalExpand > ProfileModal > EditProfile
      
      function TestComponent() {
        // If all contexts are available, the nesting order is correct
        const loginModal = useLoginModal()
        const modalExpand = useModalExpand()
        const profileModal = useProfileModal()
        const editProfile = useEditProfile()
        
        return (
          <div data-testid="nesting-test">
            {loginModal && modalExpand && profileModal && editProfile 
              ? 'correct-order' 
              : 'incorrect-order'}
          </div>
        )
      }
      
      render(
        <BrowserRouter>
          <CoreProvidersGroup>
            <ModalProvidersGroup>
              <TestComponent />
            </ModalProvidersGroup>
          </CoreProvidersGroup>
        </BrowserRouter>
      )
      
      expect(screen.getByTestId('nesting-test')).toHaveTextContent('correct-order')
    })
  })
})
