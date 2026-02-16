import { useRef, useEffect } from 'react'

/**
 * Test utility for tracking component render counts
 * Usage:
 * 
 * const renderCount = useRenderCounter('MyComponent')
 * 
 * Then in tests, you can access renderCount.current to verify
 * that components are not re-rendering unnecessarily
 */
export function useRenderCounter(componentName: string) {
  const renderCount = useRef(0)
  
  useEffect(() => {
    renderCount.current += 1
    if (import.meta.env.DEV) {
      console.log(`[RenderCounter] ${componentName} rendered ${renderCount.current} times`)
    }
  })
  
  return renderCount
}

/**
 * Higher-order component that wraps a component and tracks its render count
 * Usage:
 * 
 * const TrackedComponent = withRenderCounter(MyComponent, 'MyComponent')
 * 
 * Then access TrackedComponent.renderCount in tests
 */
export function withRenderCounter<P extends object>(
  Component: React.ComponentType<P>,
  componentName: string
) {
  const renderCountRef = { current: 0 }
  
  const WrappedComponent = (props: P) => {
    renderCountRef.current += 1
    if (import.meta.env.DEV) {
      console.log(`[RenderCounter] ${componentName} rendered ${renderCountRef.current} times`)
    }
    return <Component {...props} />
  }
  
  WrappedComponent.displayName = `withRenderCounter(${componentName})`
  ;(WrappedComponent as any).renderCount = renderCountRef
  
  return WrappedComponent
}

/**
 * Test helper to reset render count
 */
export function resetRenderCount(component: any) {
  if (component.renderCount) {
    component.renderCount.current = 0
  }
}

/**
 * Test helper to get current render count
 */
export function getRenderCount(component: any): number {
  return component.renderCount?.current ?? 0
}
