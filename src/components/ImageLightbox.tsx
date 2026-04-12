import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ImageLightbox.module.css'

interface ImageLightboxProps {
  imageUrl: string
  alt?: string
  onClose: () => void
}

export default function ImageLightbox({ imageUrl, alt = '', onClose }: ImageLightboxProps) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const positionStartRef = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

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

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev * 1.5, 5))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale((prev) => {
      const newScale = Math.max(prev / 1.5, 1)
      if (newScale === 1) {
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
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setScale((prev) => {
      const newScale = Math.min(Math.max(prev * delta, 1), 5)
      if (newScale === 1) {
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

  // Touch handlers for mobile pan
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (scale > 1 && e.touches.length === 1) {
      setIsDragging(true)
      dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      positionStartRef.current = { ...position }
    }
  }, [scale, position])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || scale <= 1 || e.touches.length !== 1) return
    const deltaX = e.touches[0].clientX - dragStartRef.current.x
    const deltaY = e.touches[0].clientY - dragStartRef.current.y
    setPosition({
      x: positionStartRef.current.x + deltaX,
      y: positionStartRef.current.y + deltaY,
    })
  }, [isDragging, scale])

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Handle click on backdrop to close (but not when clicking the image)
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current) {
      onClose()
    }
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
          onClick={onClose}
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

      <div className={styles.imageContainer}>
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
        Double-click to zoom • Drag to pan • Scroll to zoom
      </div>
    </div>,
    document.body
  )
}
