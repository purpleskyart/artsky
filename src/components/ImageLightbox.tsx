import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ImageLightbox.module.css'

const MIN_SCALE = 1
const MAX_SCALE = 5
const WHEEL_SENSITIVITY = 0.002 // Lower = less sensitive
const PINCH_SENSITIVITY = 0.005 // Lower = less sensitive for pinch
const WHEEL_MIN_DELTA = 0.01 // Minimum zoom change per wheel tick

interface ImageLightboxProps {
  imageUrl: string
  alt?: string
  onClose: () => void
  onPrevious?: () => void
  onNext?: () => void
}

export default function ImageLightbox({ imageUrl, alt = '', onClose, onPrevious, onNext }: ImageLightboxProps) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const positionStartRef = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const imageContainerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  // Pinch gesture refs
  const pinchStartDistanceRef = useRef(0)
  const pinchStartScaleRef = useRef(1)
  const isPinchingRef = useRef(false)
  const lastTouchEndTimeRef = useRef(0)
  const pinchCenterRef = useRef({ x: 0, y: 0 })
  const justDoubleTappedRef = useRef(false)
  const verticalSwipeStartYRef = useRef(0)
  const isVerticalSwipingRef = useRef(false)
  const horizontalSwipeStartXRef = useRef(0)
  const isHorizontalSwipingRef = useRef(false)

  // Reset zoom when image changes
  useEffect(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [imageUrl])

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Prevent body scroll while lightbox is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  const handleZoomIn = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setScale((prev) => Math.min(prev + 0.5, MAX_SCALE))
  }, [])

  const handleZoomOut = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setScale((prev) => {
      const newScale = Math.max(prev - 0.5, MIN_SCALE)
      if (newScale <= MIN_SCALE) {
        setPosition({ x: 0, y: 0 })
      }
      return newScale
    })
  }, [])

  const handleDoubleClick = useCallback(() => {
    if (scale > 1) {
      setScale(1)
      setPosition({ x: 0, y: 0 })
    } else {
      setScale(2.5)
    }
  }, [scale])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    
    // Get normalized delta - handles different devices (trackpad vs mouse wheel)
    const deltaY = e.deltaY
    
    // Calculate scale change based on delta with dampening
    // Use additive scaling instead of multiplicative for finer control
    const scaleDelta = -deltaY * WHEEL_SENSITIVITY
    
    // Clamp to minimum change to avoid tiny adjustments feeling stuck
    const clampedDelta = Math.abs(scaleDelta) < WHEEL_MIN_DELTA 
      ? (scaleDelta > 0 ? WHEEL_MIN_DELTA : -WHEEL_MIN_DELTA) 
      : scaleDelta
    
    setScale((prev) => {
      const newScale = Math.min(Math.max(prev + clampedDelta, MIN_SCALE), MAX_SCALE)
      if (newScale <= MIN_SCALE) {
        setPosition({ x: 0, y: 0 })
      }
      return newScale
    })
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale > 1) {
      e.preventDefault()
      setIsDragging(true)
      dragStartRef.current = { x: e.clientX, y: e.clientY }
      positionStartRef.current = { ...position }
    }
  }, [scale, position])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return
    const deltaX = e.clientX - dragStartRef.current.x
    const deltaY = e.clientY - dragStartRef.current.y
    setPosition({
      x: positionStartRef.current.x + deltaX,
      y: positionStartRef.current.y + deltaY,
    })
  }, [isDragging, scale])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Touch handlers for mobile pan and pinch
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation()
    if (e.touches.length === 2) {
      // Start pinch gesture
      isPinchingRef.current = true
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]

      // Calculate initial distance and center
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      )
      pinchStartDistanceRef.current = distance
      pinchStartScaleRef.current = scale

      // Calculate center point of pinch
      pinchCenterRef.current = {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
      }
    } else if (scale > 1 && e.touches.length === 1 && !isPinchingRef.current) {
      setIsDragging(true)
      dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      positionStartRef.current = { ...position }
    } else if (scale === 1 && e.touches.length === 1 && !isPinchingRef.current) {
      // Start swipe detection when zoomed out
      verticalSwipeStartYRef.current = e.touches[0].clientY
      horizontalSwipeStartXRef.current = e.touches[0].clientX
      isVerticalSwipingRef.current = false
      isHorizontalSwipingRef.current = false
    }
  }, [scale, position])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && isPinchingRef.current) {
      // Handle pinch zoom
      e.stopPropagation()
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]

      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      )

      // Calculate scale based on distance change with dampening
      const scaleDelta = (distance - pinchStartDistanceRef.current) * PINCH_SENSITIVITY
      const newScale = Math.min(
        Math.max(pinchStartScaleRef.current + scaleDelta, MIN_SCALE),
        MAX_SCALE
      )

      setScale(newScale)
      if (newScale <= MIN_SCALE) {
        setPosition({ x: 0, y: 0 })
      }
    } else if (isDragging && scale > 1 && e.touches.length === 1 && !isPinchingRef.current) {
      // Handle pan
      e.stopPropagation()
      const deltaX = e.touches[0].clientX - dragStartRef.current.x
      const deltaY = e.touches[0].clientY - dragStartRef.current.y
      setPosition({
        x: positionStartRef.current.x + deltaX,
        y: positionStartRef.current.y + deltaY,
      })
    } else if (scale === 1 && e.touches.length === 1 && !isPinchingRef.current) {
      // Detect swipe direction when zoomed out
      const deltaX = e.touches[0].clientX - horizontalSwipeStartXRef.current
      const deltaY = e.touches[0].clientY - verticalSwipeStartYRef.current
      const SWIPE_THRESHOLD = 50

      // Determine if horizontal or vertical swipe based on which moved more
      if (!isVerticalSwipingRef.current && !isHorizontalSwipingRef.current) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_THRESHOLD) {
          isHorizontalSwipingRef.current = true
        } else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > SWIPE_THRESHOLD) {
          isVerticalSwipingRef.current = true
        }
      }
    }
  }, [isDragging, scale])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.stopPropagation()
    // Detect if pinch ended (fewer than 2 touches)
    if (e.touches.length < 2) {
      isPinchingRef.current = false
    }

    // Handle double tap to zoom (check before swipe handling)
    if (e.touches.length === 0 && !isPinchingRef.current) {
      const now = Date.now()
      const timeSinceLastTouch = now - lastTouchEndTimeRef.current

      if (timeSinceLastTouch < 300) {
        // Double tap detected - reset swipe flags to prevent interference
        isHorizontalSwipingRef.current = false
        isVerticalSwipingRef.current = false
        justDoubleTappedRef.current = true
        setTimeout(() => {
          justDoubleTappedRef.current = false
        }, 200)
        if (scale > 1) {
          setScale(1)
          setPosition({ x: 0, y: 0 })
        } else {
          setScale(2.5)
        }
        lastTouchEndTimeRef.current = now
        setIsDragging(false)
        return
      }
      lastTouchEndTimeRef.current = now
    }

    // Handle horizontal swipe navigation when zoomed out
    if (scale === 1 && e.touches.length === 0 && isHorizontalSwipingRef.current) {
      const deltaX = e.changedTouches[0].clientX - horizontalSwipeStartXRef.current
      const SWIPE_NAV_THRESHOLD = 100
      if (Math.abs(deltaX) > SWIPE_NAV_THRESHOLD) {
        if (deltaX < 0 && onNext) {
          // Swipe left - next image
          onNext()
        } else if (deltaX > 0 && onPrevious) {
          // Swipe right - previous image
          onPrevious()
        }
      }
      isHorizontalSwipingRef.current = false
      isVerticalSwipingRef.current = false
      return
    }

    // Handle vertical swipe to close when zoomed out
    if (scale === 1 && e.touches.length === 0 && isVerticalSwipingRef.current) {
      const deltaY = e.changedTouches[0].clientY - verticalSwipeStartYRef.current
      const SWIPE_CLOSE_THRESHOLD = 100
      if (Math.abs(deltaY) > SWIPE_CLOSE_THRESHOLD) {
        onClose()
        isVerticalSwipingRef.current = false
        return
      }
      isVerticalSwipingRef.current = false
    }

    setIsDragging(false)
  }, [scale, onClose, onNext, onPrevious])

  // Handle click on backdrop to close (but not when clicking the image)
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    // Don't close if clicking on the actual image element
    if (e.target === imageRef.current) {
      return
    }
    // Don't close if we just double-tapped
    if (justDoubleTappedRef.current) {
      return
    }
    // Close when clicking anywhere else (backdrop, top bar, hint text, etc.)
    onClose()
  }, [onClose])

  return createPortal(
    <div
      ref={containerRef}
      className={styles.lightbox}
      onClick={handleBackdropClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <div className={styles.topBar}>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label="Close"
        >
          ×
        </button>
        <div className={styles.zoomControls}>
          <button
            type="button"
            className={styles.zoomBtn}
            onClick={handleZoomOut}
            disabled={scale <= 1}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className={styles.zoomLevel}>{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className={styles.zoomBtn}
            onClick={handleZoomIn}
            disabled={scale >= 5}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div
        ref={imageContainerRef}
        className={styles.imageContainer}
      >
        <img
          ref={imageRef}
          src={imageUrl}
          alt={alt}
          className={`${styles.image} ${scale > 1 ? styles.imageZoomed : ''} ${isDragging ? styles.imageDragging : ''}`}
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
          }}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          draggable={false}
        />
      </div>

      <div className={styles.hint}>
        Double-click to zoom • Drag to pan • Scroll to zoom • Pinch to zoom on mobile
      </div>
    </div>,
    document.body
  )
}
