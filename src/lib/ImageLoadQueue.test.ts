import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ImageLoadQueue } from './ImageLoadQueue'

describe('ImageLoadQueue', () => {
  let queue: ImageLoadQueue

  beforeEach(() => {
    queue = new ImageLoadQueue()
  })

  describe('error handling', () => {
    it('handles load function that throws error', () => {
      const errorFn = vi.fn(() => {
        throw new Error('Load failed')
      })
      const successFn = vi.fn()
      
      // Enqueue error function
      expect(() => queue.enqueue(errorFn)).toThrow('Load failed')
      
      // Queue should still be functional
      queue.enqueue(successFn)
      expect(successFn).toHaveBeenCalledTimes(1)
    })

    it('continues processing queue after load function error', () => {
      const errorFn = vi.fn(() => {
        throw new Error('Load failed')
      })
      const successFns = Array.from({ length: 3 }, () => vi.fn())
      
      // Enqueue functions
      try {
        queue.enqueue(errorFn)
      } catch {
        // Expected error
      }
      successFns.forEach(fn => queue.enqueue(fn))
      
      // Success functions should still execute
      successFns.forEach(fn => {
        expect(fn).toHaveBeenCalled()
      })
    })

    it('handles complete called with errors in queue', () => {
      const errorFn = vi.fn(() => {
        throw new Error('Load failed')
      })
      const successFn = vi.fn()
      
      // Fill queue to max
      const fillFns = Array.from({ length: 6 }, () => vi.fn())
      fillFns.forEach(fn => queue.enqueue(fn))
      
      // Add error function to queue
      queue.enqueue(errorFn)
      queue.enqueue(successFn)
      
      // Complete one to trigger error function from queue
      expect(() => queue.complete()).toThrow('Load failed')
      
      // Queue should still have the success function
      expect(queue.getQueueLength()).toBe(1)
      
      // Complete again to process success function
      queue.complete()
      expect(successFn).toHaveBeenCalled()
    })
  })

  describe('concurrent request limiting', () => {
    it('enforces limit with rapid enqueues', () => {
      const loadFns = Array.from({ length: 100 }, () => vi.fn())
      
      // Rapidly enqueue many functions
      loadFns.forEach(fn => queue.enqueue(fn))
      
      // Should never exceed limit
      expect(queue.getActiveCount()).toBe(6)
      expect(queue.getQueueLength()).toBe(94)
    })

    it('maintains limit during mixed enqueue/complete operations', () => {
      const loadFns = Array.from({ length: 20 }, () => vi.fn())
      
      // Enqueue some
      for (let i = 0; i < 10; i++) {
        queue.enqueue(loadFns[i])
      }
      
      // Complete some
      queue.complete()
      queue.complete()
      
      // Enqueue more
      for (let i = 10; i < 20; i++) {
        queue.enqueue(loadFns[i])
      }
      
      // Should maintain limit
      expect(queue.getActiveCount()).toBeLessThanOrEqual(6)
    })

    it('handles burst of completions', () => {
      const loadFns = Array.from({ length: 15 }, () => vi.fn())
      
      // Enqueue all
      loadFns.forEach(fn => queue.enqueue(fn))
      
      // Burst of completions
      for (let i = 0; i < 10; i++) {
        queue.complete()
      }
      
      // Should process queue correctly
      expect(queue.getActiveCount()).toBeLessThanOrEqual(6)
      expect(queue.getQueueLength()).toBe(0)
    })
  })

  describe('basic functionality', () => {
    it('executes load function immediately when under limit', () => {
      const loadFn = vi.fn()
      queue.enqueue(loadFn)
      
      expect(loadFn).toHaveBeenCalledTimes(1)
      expect(queue.getActiveCount()).toBe(1)
    })

    it('queues load function when at concurrent limit', () => {
      const loadFns = Array.from({ length: 7 }, () => vi.fn())
      
      // Enqueue 7 functions (max is 6)
      loadFns.forEach(fn => queue.enqueue(fn))
      
      // First 6 should execute immediately
      loadFns.slice(0, 6).forEach(fn => {
        expect(fn).toHaveBeenCalledTimes(1)
      })
      
      // 7th should be queued
      expect(loadFns[6]).not.toHaveBeenCalled()
      expect(queue.getQueueLength()).toBe(1)
      expect(queue.getActiveCount()).toBe(6)
    })

    it('processes queued items when complete is called', () => {
      const loadFns = Array.from({ length: 7 }, () => vi.fn())
      
      // Enqueue 7 functions
      loadFns.forEach(fn => queue.enqueue(fn))
      
      // Complete one
      queue.complete()
      
      // 7th function should now execute
      expect(loadFns[6]).toHaveBeenCalledTimes(1)
      expect(queue.getQueueLength()).toBe(0)
      expect(queue.getActiveCount()).toBe(6)
    })

    it('handles multiple completions correctly', () => {
      const loadFns = Array.from({ length: 10 }, () => vi.fn())
      
      // Enqueue 10 functions
      loadFns.forEach(fn => queue.enqueue(fn))
      
      // First 6 execute immediately
      expect(queue.getActiveCount()).toBe(6)
      expect(queue.getQueueLength()).toBe(4)
      
      // Complete 3
      queue.complete()
      queue.complete()
      queue.complete()
      
      // 3 more should execute
      expect(loadFns[6]).toHaveBeenCalled()
      expect(loadFns[7]).toHaveBeenCalled()
      expect(loadFns[8]).toHaveBeenCalled()
      expect(queue.getActiveCount()).toBe(6)
      expect(queue.getQueueLength()).toBe(1)
      
      // Complete 1 more
      queue.complete()
      
      // Last one should execute
      expect(loadFns[9]).toHaveBeenCalled()
      expect(queue.getActiveCount()).toBe(6)
      expect(queue.getQueueLength()).toBe(0)
    })
  })

  describe('custom concurrent limit', () => {
    it('respects custom maxConcurrent value', () => {
      const customQueue = new ImageLoadQueue(3)
      const loadFns = Array.from({ length: 5 }, () => vi.fn())
      
      loadFns.forEach(fn => customQueue.enqueue(fn))
      
      // First 3 should execute
      expect(loadFns[0]).toHaveBeenCalled()
      expect(loadFns[1]).toHaveBeenCalled()
      expect(loadFns[2]).toHaveBeenCalled()
      
      // Last 2 should be queued
      expect(loadFns[3]).not.toHaveBeenCalled()
      expect(loadFns[4]).not.toHaveBeenCalled()
      expect(customQueue.getActiveCount()).toBe(3)
      expect(customQueue.getQueueLength()).toBe(2)
    })
  })

  describe('edge cases', () => {
    it('handles complete called when active is 0', () => {
      expect(queue.getActiveCount()).toBe(0)
      queue.complete()
      expect(queue.getActiveCount()).toBe(0)
    })

    it('handles complete called more times than enqueued', () => {
      const loadFn = vi.fn()
      queue.enqueue(loadFn)
      
      queue.complete()
      queue.complete()
      queue.complete()
      
      expect(queue.getActiveCount()).toBe(0)
    })

    it('clears queue and resets active count', () => {
      const loadFns = Array.from({ length: 10 }, () => vi.fn())
      loadFns.forEach(fn => queue.enqueue(fn))
      
      expect(queue.getActiveCount()).toBe(6)
      expect(queue.getQueueLength()).toBe(4)
      
      queue.clear()
      
      expect(queue.getActiveCount()).toBe(0)
      expect(queue.getQueueLength()).toBe(0)
    })

    it('handles empty queue dequeue', () => {
      expect(queue.getQueueLength()).toBe(0)
      queue.complete() // Should not throw
      expect(queue.getQueueLength()).toBe(0)
    })
  })

  describe('queue ordering', () => {
    it('processes queued items in FIFO order', () => {
      const executionOrder: number[] = []
      const loadFns = Array.from({ length: 10 }, (_, i) => 
        vi.fn(() => executionOrder.push(i))
      )
      
      // Enqueue all
      loadFns.forEach(fn => queue.enqueue(fn))
      
      // Complete all
      for (let i = 0; i < 10; i++) {
        queue.complete()
      }
      
      // Should execute in order 0-9
      expect(executionOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })
  })

  describe('concurrent limit enforcement', () => {
    it('never exceeds maxConcurrent active count', () => {
      const loadFns = Array.from({ length: 20 }, () => vi.fn())
      
      loadFns.forEach(fn => queue.enqueue(fn))
      
      // Should never exceed 6
      expect(queue.getActiveCount()).toBe(6)
      
      // Complete some and check again
      for (let i = 0; i < 5; i++) {
        queue.complete()
        expect(queue.getActiveCount()).toBeLessThanOrEqual(6)
      }
    })
  })
})
