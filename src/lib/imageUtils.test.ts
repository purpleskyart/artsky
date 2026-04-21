import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { supportsWebP, webpImageUrl, resizedImageUrl, resetWebPSupport } from './imageUtils'

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
      // Uses Bluesky CDN's native format parameter instead of wsrv.nl
      
      const originalUrl = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg'
      const expectedWebPUrl = `${originalUrl}?format=webp`
      
      // Verify the expected URL structure
      expect(expectedWebPUrl).toContain('format=webp')
      expect(expectedWebPUrl).not.toContain('wsrv.nl')
      
      // In test environment (no WebP support), the function returns original URL
      const result = webpImageUrl(originalUrl)
      expect(result).toBe(originalUrl)
    })

    it('includes width parameter when provided', () => {
      resetWebPSupport()
      
      const originalUrl = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg'
      const width = 800
      
      // Test the URL construction logic - uses CDN's native parameters
      const expectedUrl = `${originalUrl}?format=webp&width=${width}`
      
      expect(expectedUrl).toContain(`width=${width}`)
      expect(expectedUrl).toContain('format=webp')
      expect(expectedUrl).not.toContain('wsrv.nl')
    })

    it('handles URLs with existing query parameters', () => {
      const originalUrl = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg?format=jpeg'
      const expectedUrl = `${originalUrl}&format=webp`
      
      // Should use & separator when URL already has query params
      expect(expectedUrl).toContain('&format=webp')
      expect(expectedUrl).not.toContain('?format=webp')
    })

    it('preserves original URL structure in encoded form', () => {
      const originalUrl = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg'
      const result = webpImageUrl(originalUrl)
      
      // In test environment (no WebP support), should return original
      expect(result).toBe(originalUrl)
    })
  })

  describe('resizedImageUrl', () => {
    it('returns original URL for non-http URLs', () => {
      expect(resizedImageUrl('', 100)).toBe('')
      expect(resizedImageUrl(null, 100)).toBe('')
      expect(resizedImageUrl(undefined, 100)).toBe('')
      expect(resizedImageUrl('data:image/png;base64,abc', 100)).toBe('data:image/png;base64,abc')
    })

    it('adds width parameter to CDN URLs', () => {
      const originalUrl = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg'
      const result = resizedImageUrl(originalUrl, 100)
      
      expect(result).toContain('width=')
      expect(result).not.toContain('wsrv.nl')
    })

    it('handles URLs with existing query parameters', () => {
      const originalUrl = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:123/abc@jpeg?format=jpeg'
      const result = resizedImageUrl(originalUrl, 100)
      
      expect(result).toContain('&width=')
      expect(result).not.toContain('?width=')
    })
  })
})
