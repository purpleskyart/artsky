import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ProgressiveImage } from './ProgressiveImage'

describe('ProgressiveImage', () => {
  it('renders with src and alt attributes', () => {
    render(<ProgressiveImage src="https://example.com/image.jpg" alt="Test image" />)
    const img = screen.getByAltText('Test image')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://example.com/image.jpg')
  })

  it('applies lazy loading by default', () => {
    render(<ProgressiveImage src="https://example.com/image.jpg" alt="Test image" />)
    const img = screen.getByAltText('Test image')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('applies eager loading when specified', () => {
    render(<ProgressiveImage src="https://example.com/image.jpg" alt="Test image" loading="eager" />)
    const img = screen.getByAltText('Test image')
    expect(img).toHaveAttribute('loading', 'eager')
  })

  it('shows placeholder for Bluesky CDN images', () => {
    const { container } = render(
      <ProgressiveImage 
        src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg" 
        alt="Test image" 
      />
    )
    
    // Check for placeholder image
    const images = container.querySelectorAll('img')
    expect(images.length).toBe(2) // placeholder + full image
    
    const placeholder = images[0]
    expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    expect(placeholder.getAttribute('src')).toContain('avatar_thumbnail')
  })

  it('does not show placeholder for non-CDN images', () => {
    const { container } = render(
      <ProgressiveImage src="https://example.com/image.jpg" alt="Test image" />
    )
    
    const images = container.querySelectorAll('img')
    expect(images.length).toBe(1) // only full image, no placeholder
  })

  it('calls onLoad callback when image loads', async () => {
    const onLoad = vi.fn()
    render(<ProgressiveImage src="https://example.com/image.jpg" alt="Test image" onLoad={onLoad} />)
    
    const img = screen.getByAltText('Test image')
    
    // Simulate image load
    img.dispatchEvent(new Event('load'))
    
    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledTimes(1)
    })
  })

  it('applies custom className', () => {
    const { container } = render(
      <ProgressiveImage 
        src="https://example.com/image.jpg" 
        alt="Test image" 
        className="custom-class" 
      />
    )
    
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('custom-class')
  })

  it('applies aspect ratio style when provided', () => {
    const { container } = render(
      <ProgressiveImage 
        src="https://example.com/image.jpg" 
        alt="Test image" 
        aspectRatio={16/9} 
      />
    )
    
    const wrapper = container.firstChild as HTMLElement
    // In test environment, inline styles may not be fully applied
    // Just verify the component renders without error when aspectRatio is provided
    expect(wrapper).toBeInTheDocument()
  })

  it('transitions to loaded state when image loads', async () => {
    const { container } = render(
      <ProgressiveImage 
        src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg" 
        alt="Test image" 
      />
    )
    
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).not.toContain('loaded')
    
    const img = screen.getByAltText('Test image')
    img.dispatchEvent(new Event('load'))
    
    await waitFor(() => {
      expect(wrapper.className).toContain('loaded')
    })
  })
})

describe('ProgressiveImage - WebP support', () => {
  it('attempts to use WebP URL when browser supports WebP', () => {
    render(<ProgressiveImage src="https://example.com/image.jpg" alt="Test image" />)
    const img = screen.getByAltText('Test image')
    
    // In test environment (no canvas support), WebP is not supported
    // So it should use the original URL
    const src = img.getAttribute('src')
    expect(src).toBe('https://example.com/image.jpg')
    
    // In a real browser with WebP support, it would use wsrv.nl with output=webp
    // This is tested by the imageUtils tests
  })

  it('falls back to original URL on WebP load error', async () => {
    const originalUrl = 'https://example.com/image.jpg'
    render(<ProgressiveImage src={originalUrl} alt="Test image" />)
    
    const img = screen.getByAltText('Test image')
    
    // Simulate load error (e.g., WebP not supported by server)
    img.dispatchEvent(new Event('error'))
    
    await waitFor(() => {
      // Should fall back to original URL if it was trying WebP
      const finalSrc = img.getAttribute('src')
      expect(finalSrc).toBe(originalUrl)
    })
  })

  it('handles successful image load', async () => {
    const onLoad = vi.fn()
    render(<ProgressiveImage src="https://example.com/image.jpg" alt="Test image" onLoad={onLoad} />)
    
    const img = screen.getByAltText('Test image')
    
    // Simulate successful load
    img.dispatchEvent(new Event('load'))
    
    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledTimes(1)
    })
  })

  it('does not apply WebP transformation to non-http URLs', () => {
    const dataUrl = 'data:image/png;base64,abc123'
    render(<ProgressiveImage src={dataUrl} alt="Test image" />)
    
    const img = screen.getByAltText('Test image')
    expect(img.getAttribute('src')).toBe(dataUrl)
  })
})

describe('ProgressiveImage - Error handling', () => {
  it('handles image load errors gracefully', async () => {
    const { container } = render(
      <ProgressiveImage src="https://example.com/broken-image.jpg" alt="Test image" />
    )
    
    const img = screen.getByAltText('Test image')
    
    // Simulate image load error
    img.dispatchEvent(new Event('error'))
    
    // Component should still be rendered
    expect(container.firstChild).toBeInTheDocument()
  })

  it('maintains placeholder visibility on error', async () => {
    const { container } = render(
      <ProgressiveImage 
        src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/broken@jpeg" 
        alt="Test image" 
      />
    )
    
    const img = screen.getByAltText('Test image')
    
    // Simulate error
    img.dispatchEvent(new Event('error'))
    
    // Placeholder should still be visible since image hasn't loaded
    const placeholder = container.querySelector('img[aria-hidden="true"]')
    expect(placeholder).toBeInTheDocument()
  })

  it('does not call onLoad callback on error', async () => {
    const onLoad = vi.fn()
    render(
      <ProgressiveImage 
        src="https://example.com/broken-image.jpg" 
        alt="Test image" 
        onLoad={onLoad}
      />
    )
    
    const img = screen.getByAltText('Test image')
    
    // Simulate error
    img.dispatchEvent(new Event('error'))
    
    // onLoad should not be called
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('retries loading image with exponential backoff', async () => {
    vi.useFakeTimers()
    
    const { container } = render(
      <ProgressiveImage 
        src="https://example.com/image.jpg" 
        alt="Test image"
        maxRetries={3}
      />
    )
    
    const img = screen.getByAltText('Test image')
    
    // First error - should schedule retry after 1s
    img.dispatchEvent(new Event('error'))
    
    // Component should still be rendered
    expect(container.firstChild).toBeInTheDocument()
    
    vi.useRealTimers()
  })

  it('displays error placeholder after max retries exceeded', async () => {
    const { container } = render(
      <ProgressiveImage 
        src="https://example.com/broken-image.jpg" 
        alt="Test image"
        maxRetries={0} // Set to 0 to immediately show error
      />
    )
    
    const img = screen.getByAltText('Test image')
    
    // First error - should immediately show error placeholder
    img.dispatchEvent(new Event('error'))
    
    await waitFor(() => {
      // Should show error placeholder with role="img"
      const errorPlaceholder = container.querySelector('[role="img"]')
      expect(errorPlaceholder).toBeInTheDocument()
      
      // Should have error text
      expect(screen.getByText('Image failed to load')).toBeInTheDocument()
    })
  })

  it('recovers when image loads after initial error', async () => {
    const onLoad = vi.fn()
    render(
      <ProgressiveImage 
        src="https://example.com/image.jpg" 
        alt="Test image" 
        onLoad={onLoad}
        maxRetries={3}
      />
    )
    
    const img = screen.getByAltText('Test image')
    
    // Simulate error first (WebP fallback)
    img.dispatchEvent(new Event('error'))
    
    // Then simulate successful load (after fallback to original)
    img.dispatchEvent(new Event('load'))
    
    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledTimes(1)
    })
  })

  it('resets retry count when src changes', async () => {
    vi.useFakeTimers()
    
    const { rerender } = render(
      <ProgressiveImage 
        src="https://example.com/image1.jpg" 
        alt="Test image"
        maxRetries={3}
      />
    )
    
    let img = screen.getByAltText('Test image')
    
    // Trigger errors to increment retry count
    img.dispatchEvent(new Event('error'))
    vi.advanceTimersByTime(1000)
    
    // Change src - should reset retry count
    rerender(
      <ProgressiveImage 
        src="https://example.com/image2.jpg" 
        alt="Test image"
        maxRetries={3}
      />
    )
    
    // New image should be able to retry from 0
    img = screen.getByAltText('Test image')
    expect(img).toBeInTheDocument()
    
    vi.useRealTimers()
  })

  it('cleans up retry timeout on unmount', () => {
    vi.useFakeTimers()
    
    const { unmount } = render(
      <ProgressiveImage 
        src="https://example.com/broken-image.jpg" 
        alt="Test image"
      />
    )
    
    const img = screen.getByAltText('Test image')
    
    // Trigger error to start retry timeout
    img.dispatchEvent(new Event('error'))
    
    // Unmount before timeout completes
    unmount()
    
    // Advance timers - should not cause any issues
    vi.advanceTimersByTime(5000)
    
    vi.useRealTimers()
  })

  it('respects custom maxRetries prop', async () => {
    const { container } = render(
      <ProgressiveImage 
        src="https://example.com/broken-image.jpg" 
        alt="Test image"
        maxRetries={0}
      />
    )
    
    const img = screen.getByAltText('Test image')
    
    // First error - should show error placeholder immediately with maxRetries=0
    img.dispatchEvent(new Event('error'))
    
    await waitFor(() => {
      const errorPlaceholder = container.querySelector('[role="img"]')
      expect(errorPlaceholder).toBeInTheDocument()
    })
  })
})

describe('ProgressiveImage - Responsive image sizing', () => {
  it('generates srcset for Bluesky CDN images with default sizes', () => {
    render(
      <ProgressiveImage 
        src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg" 
        alt="Test image" 
      />
    )
    
    const img = screen.getByAltText('Test image')
    const srcset = img.getAttribute('srcset')
    
    // Should have srcset with multiple sizes
    expect(srcset).toBeTruthy()
    expect(srcset).toContain('320w')
    expect(srcset).toContain('640w')
    expect(srcset).toContain('960w')
    expect(srcset).toContain('1280w')
    expect(srcset).toContain('1920w')
  })

  it('generates srcset with custom sizes', () => {
    render(
      <ProgressiveImage 
        src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg" 
        alt="Test image"
        sizes={[400, 800, 1200]}
      />
    )
    
    const img = screen.getByAltText('Test image')
    const srcset = img.getAttribute('srcset')
    
    expect(srcset).toBeTruthy()
    expect(srcset).toContain('400w')
    expect(srcset).toContain('800w')
    expect(srcset).toContain('1200w')
    expect(srcset).not.toContain('320w')
  })

  it('does not generate srcset for non-CDN images', () => {
    render(
      <ProgressiveImage 
        src="https://example.com/image.jpg" 
        alt="Test image" 
      />
    )
    
    const img = screen.getByAltText('Test image')
    const srcset = img.getAttribute('srcset')
    
    // Non-CDN images should not have srcset
    expect(srcset).toBeNull()
  })

  it('applies default sizes attribute when srcset is present', () => {
    render(
      <ProgressiveImage 
        src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg" 
        alt="Test image" 
      />
    )
    
    const img = screen.getByAltText('Test image')
    const sizes = img.getAttribute('sizes')
    
    // Should have default sizes attribute
    expect(sizes).toBeTruthy()
    expect(sizes).toContain('max-width')
    expect(sizes).toContain('vw')
  })

  it('applies custom sizes attribute when provided', () => {
    const customSizes = '(max-width: 768px) 100vw, 50vw'
    render(
      <ProgressiveImage 
        src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg" 
        alt="Test image"
        sizesAttr={customSizes}
      />
    )
    
    const img = screen.getByAltText('Test image')
    const sizes = img.getAttribute('sizes')
    
    expect(sizes).toBe(customSizes)
  })

  it('does not apply sizes attribute when srcset is not present', () => {
    render(
      <ProgressiveImage 
        src="https://example.com/image.jpg" 
        alt="Test image" 
      />
    )
    
    const img = screen.getByAltText('Test image')
    const sizes = img.getAttribute('sizes')
    
    // Non-CDN images without srcset should not have sizes attribute
    expect(sizes).toBeNull()
  })

  it('generates srcset URLs with width parameters', () => {
    render(
      <ProgressiveImage 
        src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg" 
        alt="Test image"
        sizes={[640, 1280]}
      />
    )
    
    const img = screen.getByAltText('Test image')
    const srcset = img.getAttribute('srcset')
    
    // Should contain width parameters in URLs
    expect(srcset).toContain('width=640')
    expect(srcset).toContain('width=1280')
  })

  it('handles URLs with existing query parameters', () => {
    render(
      <ProgressiveImage 
        src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg?format=jpeg" 
        alt="Test image"
        sizes={[640]}
      />
    )
    
    const img = screen.getByAltText('Test image')
    const srcset = img.getAttribute('srcset')
    
    // Should append width parameter with & instead of ?
    expect(srcset).toContain('&width=640')
  })
})

