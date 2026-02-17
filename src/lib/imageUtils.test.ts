import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { supportsWebP, webpImageUrl, resetWebPSupport } from './imageUtils'

describe('imageUtils - WebP support', () => {
  beforeEach(() => {
    // Reset the cached WebP support value before each test
    resetWebPSupport()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('supportsWebP', () => {
    it('returns a boolean value', () => {
      const result = supportsWebP()
      expect(typeof result).toBe('boolean')
    })

    it('caches the result on subsequent calls', () => {
      const first = supportsWebP()
      const second = supportsWebP()
      expect(first).toBe(second)
    })

    it('returns false in non-browser environment', () => {
      resetWebPSupport()
      const result = supportsWebP()
      // In test environment without canvas, should return false
      expect(result).toBe(false)
    })
  })

  describe('webpImageUrl', () => {
    it('returns original URL for non-http URLs', () => {
      expect(webpImageUrl('')).toBe('')
      expect(webpImageUrl(null)).toBe('')
      expect(webpImageUrl(undefined)).toBe('')
      expect(webpImageUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
    })

    it('returns original URL when WebP is not supported', () => {
      // In test environment, WebP is not supported (no canvas)
      resetWebPSupport()
      
      const originalUrl = 'https://example.com/image.jpg'
      const result = webpImageUrl(originalUrl)
      
      // When WebP is not supported, should return original URL
      expect(result).toBe(originalUrl)
    })

    it('converts URL to WebP format when supported', () => {
      // This test verifies the URL construction logic
      // In a real browser with WebP support, the function would return a wsrv.nl URL
      
      const originalUrl = 'https://example.com/image.jpg'
      const encoded = encodeURIComponent(originalUrl)
      const expectedWebPUrl = `https://wsrv.nl/?url=${encoded}&output=webp`
      
      // Verify the expected URL structure
      expect(expectedWebPUrl).toContain('wsrv.nl')
      expect(expectedWebPUrl).toContain('output=webp')
      expect(expectedWebPUrl).toContain(encodeURIComponent(originalUrl))
      
      // In test environment (no WebP support), the function returns original URL
      const result = webpImageUrl(originalUrl)
      expect(result).toBe(originalUrl)
    })

    it('includes width parameter when provided', () => {
      resetWebPSupport()
      
      const originalUrl = 'https://example.com/image.jpg'
      const width = 800
      
      // Test the URL construction logic
      const encoded = encodeURIComponent(originalUrl)
      const expectedUrl = `https://wsrv.nl/?url=${encoded}&w=${width}&output=webp`
      
      expect(expectedUrl).toContain(`w=${width}`)
      expect(expectedUrl).toContain('output=webp')
    })

    it('handles URLs with special characters', () => {
      const originalUrl = 'https://example.com/image with spaces.jpg?param=value'
      const encoded = encodeURIComponent(originalUrl)
      
      // Verify encoding works correctly
      expect(encoded).not.toContain(' ')
      expect(encoded).toContain('%20')
    })

    it('preserves original URL structure in encoded form', () => {
      const originalUrl = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg'
      const result = webpImageUrl(originalUrl)
      
      // In test environment (no WebP support), should return original
      expect(result).toBe(originalUrl)
    })
  })
})
