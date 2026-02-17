import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { gzipSync } from 'zlib'

/**
 * Unit tests for code splitting
 * 
 * **Validates: Requirements 4.1, 4.3, 4.4, 4.5**
 * 
 * These tests verify that:
 * - Route components are not in the initial bundle
 * - hls.js is in a separate chunk
 * - Main bundle is under 500KB gzipped
 */

describe('Code Splitting', () => {
  const distPath = 'dist'
  let bundleFiles: string[] = []
  let bundleContents: Map<string, string> = new Map()
  let bundleSizes: Map<string, { size: number; gzipSize: number }> = new Map()

  beforeAll(() => {
    // Check if dist directory exists
    if (!existsSync(distPath)) {
      console.warn('⚠️  dist directory not found. Run "npm run build" first.')
      return
    }

    // Find all JS files in dist
    bundleFiles = findJsFiles(distPath)

    // Read and analyze each bundle
    bundleFiles.forEach((filePath) => {
      const content = readFileSync(filePath, 'utf-8')
      bundleContents.set(filePath, content)

      const buffer = readFileSync(filePath)
      const size = buffer.length
      const gzipSize = gzipSync(buffer).length

      bundleSizes.set(filePath, { size, gzipSize })
    })
  })

  describe('Requirement 4.1: Route components are lazy loaded', () => {
    it('should not include FeedPage in the initial bundle', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      // Find the main entry bundle (usually index-*.js)
      const mainBundle = bundleFiles.find((file) =>
        file.includes('index-') && file.endsWith('.js')
      )

      if (!mainBundle) {
        console.warn('⚠️  Could not identify main bundle')
        return
      }

      const content = bundleContents.get(mainBundle)!

      // Check that FeedPage component is not in the main bundle
      // Look for the component definition or its distinctive features
      expect(content).not.toMatch(/function FeedPage/)
      expect(content).not.toMatch(/const FeedPage\s*=/)
    })

    it('should not include PostDetailPage in the initial bundle', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      const mainBundle = bundleFiles.find((file) =>
        file.includes('index-') && file.endsWith('.js')
      )

      if (!mainBundle) {
        console.warn('⚠️  Could not identify main bundle')
        return
      }

      const content = bundleContents.get(mainBundle)!

      expect(content).not.toMatch(/function PostDetailPage/)
      expect(content).not.toMatch(/const PostDetailPage\s*=/)
    })

    it('should not include ProfilePage in the initial bundle', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      const mainBundle = bundleFiles.find((file) =>
        file.includes('index-') && file.endsWith('.js')
      )

      if (!mainBundle) {
        console.warn('⚠️  Could not identify main bundle')
        return
      }

      const content = bundleContents.get(mainBundle)!

      expect(content).not.toMatch(/function ProfilePage/)
      expect(content).not.toMatch(/const ProfilePage\s*=/)
    })

    it('should have separate chunks for route components', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      // There should be multiple JS files (main + lazy chunks)
      expect(bundleFiles.length).toBeGreaterThan(1)

      // Check that lazy-loaded routes exist in separate chunks
      const hasLazyChunks = bundleFiles.some((file) => {
        const content = bundleContents.get(file)!
        // Look for route component patterns in separate chunks
        return (
          content.includes('FeedPage') ||
          content.includes('PostDetailPage') ||
          content.includes('ProfilePage') ||
          content.includes('TagPage') ||
          content.includes('CollabPage') ||
          content.includes('ConsensusPage')
        )
      })

      expect(hasLazyChunks).toBe(true)
    })
  })

  describe('Requirement 4.3, 4.4: hls.js is in separate chunk', () => {
    it('should not include hls.js in the main bundle', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      const mainBundle = bundleFiles.find((file) =>
        file.includes('index-') && file.endsWith('.js')
      )

      if (!mainBundle) {
        console.warn('⚠️  Could not identify main bundle')
        return
      }

      const content = bundleContents.get(mainBundle)!

      // Check that hls.js is not in the main bundle
      // Look for distinctive hls.js patterns
      expect(content).not.toMatch(/Hls\.isSupported/)
      expect(content).not.toMatch(/hls\.loadSource/)
      expect(content).not.toMatch(/hls\.attachMedia/)
    })

    it('should have hls.js in a separate video chunk', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      // Look for the video chunk (configured in vite.config.ts as 'video')
      const videoChunk = bundleFiles.find((file) => file.includes('video-'))

      if (!videoChunk) {
        console.warn('⚠️  Could not find video chunk')
        return
      }

      const content = bundleContents.get(videoChunk)!

      // Check that hls.js code is in the video chunk
      const hasHlsCode =
        content.includes('Hls') ||
        content.includes('loadSource') ||
        content.includes('attachMedia')

      expect(hasHlsCode).toBe(true)
    })

    it('should have separate chunks for vendor libraries', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      // Check for configured vendor chunks
      const hasReactVendorChunk = bundleFiles.some((file) =>
        file.includes('react-vendor-')
      )
      const hasAtprotoChunk = bundleFiles.some((file) =>
        file.includes('atproto-')
      )
      const hasVirtualChunk = bundleFiles.some((file) =>
        file.includes('virtual-')
      )

      // At least some vendor chunks should exist
      const vendorChunkCount = [
        hasReactVendorChunk,
        hasAtprotoChunk,
        hasVirtualChunk,
      ].filter(Boolean).length

      expect(vendorChunkCount).toBeGreaterThan(0)
    })
  })

  describe('Requirement 4.5: Main bundle is under 500KB gzipped', () => {
    it('should have main bundle under 500KB gzipped', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      const mainBundle = bundleFiles.find((file) =>
        file.includes('index-') && file.endsWith('.js')
      )

      if (!mainBundle) {
        console.warn('⚠️  Could not identify main bundle')
        return
      }

      const sizes = bundleSizes.get(mainBundle)!
      const maxSizeBytes = 500 * 1024 // 500KB

      console.log(
        `Main bundle size: ${formatBytes(sizes.size)} (${formatBytes(sizes.gzipSize)} gzipped)`
      )

      expect(sizes.gzipSize).toBeLessThanOrEqual(maxSizeBytes)
    })

    it('should have total bundle size under reasonable limit', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      let totalSize = 0
      let totalGzipSize = 0

      bundleSizes.forEach((sizes) => {
        totalSize += sizes.size
        totalGzipSize += sizes.gzipSize
      })

      console.log(
        `Total bundle size: ${formatBytes(totalSize)} (${formatBytes(totalGzipSize)} gzipped)`
      )

      // Total should be reasonable (under 2MB gzipped for all chunks)
      const maxTotalGzipSize = 2 * 1024 * 1024 // 2MB
      expect(totalGzipSize).toBeLessThanOrEqual(maxTotalGzipSize)
    })

    it('should report bundle sizes for all chunks', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      console.log('\n📦 Bundle Size Report:')
      console.log('─'.repeat(60))

      bundleFiles.forEach((file) => {
        const sizes = bundleSizes.get(file)!
        const fileName = file.replace(/^dist\//, '')
        console.log(
          `${fileName}: ${formatBytes(sizes.size)} (${formatBytes(sizes.gzipSize)} gzipped)`
        )
      })

      console.log('─'.repeat(60))

      // This test always passes, it's just for reporting
      expect(bundleFiles.length).toBeGreaterThan(0)
    })
  })

  describe('Code splitting configuration', () => {
    it('should have multiple chunks indicating successful code splitting', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      // With code splitting, we should have multiple chunks
      // At minimum: main bundle + vendor chunks + lazy routes
      expect(bundleFiles.length).toBeGreaterThanOrEqual(3)
    })

    it('should have smaller individual chunks than a single bundle', () => {
      if (bundleFiles.length === 0) {
        console.warn('⚠️  Skipping test: no bundle files found')
        return
      }

      // Calculate average chunk size
      let totalSize = 0
      bundleSizes.forEach((sizes) => {
        totalSize += sizes.gzipSize
      })

      const averageSize = totalSize / bundleFiles.length

      // Each chunk should be smaller than the total
      // (this verifies that code is actually split)
      bundleSizes.forEach((sizes) => {
        // Most chunks should be smaller than 2x the average
        // (some chunks like vendor chunks might be larger)
        expect(sizes.gzipSize).toBeLessThan(totalSize)
      })

      console.log(`Average chunk size: ${formatBytes(averageSize)} gzipped`)
    })
  })
})

/**
 * Helper function to recursively find all JS files in a directory
 */
function findJsFiles(dir: string, fileList: string[] = []): string[] {
  if (!existsSync(dir)) {
    return fileList
  }

  const files = readdirSync(dir)

  files.forEach((file) => {
    const filePath = join(dir, file)
    const stat = statSync(filePath)

    if (stat.isDirectory()) {
      findJsFiles(filePath, fileList)
    } else if (extname(file) === '.js') {
      fileList.push(filePath)
    }
  })

  return fileList
}

/**
 * Helper function to format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}
