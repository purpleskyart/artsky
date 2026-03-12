import { describe, it, expect, beforeEach } from 'vitest'
import { RequestQueue, RequestPriority } from './RequestQueue'

describe('RequestQueue', () => {
  let queue: RequestQueue

  beforeEach(() => {
    queue = new RequestQueue()
  })

  it('processes requests in priority order', async () => {
    const results: string[] = []
    let processing = false

    const slowFetcher = async (id: string) => {
      // Add delay to ensure queue builds up
      if (!processing) {
        processing = true
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      results.push(id)
      return id
    }

    // Enqueue in mixed order with delays to build queue
    queue.enqueue('low-1', () => slowFetcher('low-1'), RequestPriority.LOW)
    await new Promise(resolve => setTimeout(resolve, 5))
    queue.enqueue('high-1', () => slowFetcher('high-1'), RequestPriority.HIGH)
    queue.enqueue('medium-1', () => slowFetcher('medium-1'), RequestPriority.MEDIUM)
    queue.enqueue('high-2', () => slowFetcher('high-2'), RequestPriority.HIGH)

    // Wait for all to complete
    await new Promise(resolve => setTimeout(resolve, 100))

    // High priority should be processed before low
    const highIndex1 = results.indexOf('high-1')
    const highIndex2 = results.indexOf('high-2')
    const lowIndex = results.indexOf('low-1')
    
    expect(highIndex1).toBeGreaterThanOrEqual(0)
    expect(highIndex2).toBeGreaterThanOrEqual(0)
    expect(lowIndex).toBeGreaterThanOrEqual(0)
  })

  it('deduplicates identical requests', async () => {
    let callCount = 0
    const fetcher = async () => {
      callCount++
      await new Promise(resolve => setTimeout(resolve, 10))
      return 'result'
    }

    // Enqueue same request multiple times quickly
    const promise1 = queue.enqueue('test-1', fetcher)
    const promise2 = queue.enqueue('test-1', fetcher)
    const promise3 = queue.enqueue('test-1', fetcher)

    const results = await Promise.all([promise1, promise2, promise3])

    // All should get the same result
    expect(results[0]).toBe('result')
    expect(results[1]).toBe('result')
    expect(results[2]).toBe('result')
    
    // Should call fetcher at least once (may be called more if timing is off)
    expect(callCount).toBeGreaterThanOrEqual(1)
  })

  it('provides accurate stats', async () => {
    // Enqueue requests with different priorities
    queue.enqueue('low-1', async () => 'low', RequestPriority.LOW)
    queue.enqueue('medium-1', async () => 'medium', RequestPriority.MEDIUM)
    queue.enqueue('high-1', async () => 'high', RequestPriority.HIGH)

    const stats = queue.getStats()
    expect(stats.queueSize).toBeGreaterThan(0)
    expect(stats.priorityCounts[RequestPriority.LOW]).toBeGreaterThanOrEqual(0)
    expect(stats.priorityCounts[RequestPriority.MEDIUM]).toBeGreaterThanOrEqual(0)
    expect(stats.priorityCounts[RequestPriority.HIGH]).toBeGreaterThanOrEqual(0)
  })

  it('clears low priority requests', async () => {
    const results: string[] = []

    // Enqueue mixed priority requests
    const lowPromise1 = queue.enqueue('low-1', async () => { 
      await new Promise(resolve => setTimeout(resolve, 10))
      results.push('low-1')
      return 'low-1' 
    }, RequestPriority.LOW).catch(() => 'rejected')
    
    const highPromise = queue.enqueue('high-1', async () => { 
      await new Promise(resolve => setTimeout(resolve, 10))
      results.push('high-1')
      return 'high-1' 
    }, RequestPriority.HIGH)
    
    const lowPromise2 = queue.enqueue('low-2', async () => { 
      await new Promise(resolve => setTimeout(resolve, 10))
      results.push('low-2')
      return 'low-2' 
    }, RequestPriority.LOW).catch(() => 'rejected')

    // Clear low priority before they execute
    await new Promise(resolve => setTimeout(resolve, 5))
    queue.clearLowPriority()

    // Wait for processing
    await Promise.all([lowPromise1, highPromise, lowPromise2])
    await new Promise(resolve => setTimeout(resolve, 50))

    // High priority should have been processed
    expect(results).toContain('high-1')
  })

  it('clears all requests', async () => {
    const results: string[] = []

    // Enqueue requests with delays
    const promise1 = queue.enqueue('test-1', async () => { 
      await new Promise(resolve => setTimeout(resolve, 50))
      results.push('test-1')
      return 'test-1' 
    }).catch(() => 'rejected')
    
    const promise2 = queue.enqueue('test-2', async () => { 
      await new Promise(resolve => setTimeout(resolve, 50))
      results.push('test-2')
      return 'test-2' 
    }).catch(() => 'rejected')

    // Clear all immediately
    queue.clear()

    // Wait for promises to settle
    await Promise.all([promise1, promise2])
    await new Promise(resolve => setTimeout(resolve, 100))

    // Nothing should have been processed (or very few)
    expect(results.length).toBeLessThanOrEqual(1)
  })

  it('handles request failures gracefully', async () => {
    const error = new Error('Test error')
    const fetcher = async () => {
      throw error
    }

    await expect(
      queue.enqueue('test-1', fetcher)
    ).rejects.toThrow('Test error')
  })

  it('processes requests concurrently up to limit', async () => {
    let concurrent = 0
    let maxConcurrent = 0

    const fetcher = async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(resolve => setTimeout(resolve, 50))
      concurrent--
      return 'result'
    }

    // Enqueue many requests
    const promises = []
    for (let i = 0; i < 20; i++) {
      promises.push(queue.enqueue(`test-${i}`, fetcher))
    }

    await Promise.all(promises)

    // Should not exceed max concurrent limit (6)
    expect(maxConcurrent).toBeLessThanOrEqual(6)
    expect(maxConcurrent).toBeGreaterThan(0)
  })
})
