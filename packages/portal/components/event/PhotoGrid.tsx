'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import { useEventContext } from './EventContext'

interface Photo {
  id: string
  media_url: string
  caption?: string
}

interface PhotoGridProps {
  photos: Photo[]
  onPhotoClick: (index: number) => void
}

export function PhotoGrid({ photos, onPhotoClick }: PhotoGridProps) {
  const { primaryColor, useDarkText } = useEventContext()
  const [isLayoutComplete, setIsLayoutComplete] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevPhotoCountRef = useRef(0)

  const calculateColumns = useCallback(() => {
    const width = window.innerWidth
    if (width > 1200) return 6
    if (width > 900) return 4
    if (width > 600) return 3
    return 2
  }, [])

  const calculateLayout = useCallback(() => {
    if (!containerRef.current) return

    const cols = calculateColumns()
    const container = containerRef.current
    const items = container.querySelectorAll<HTMLElement>('.photo-grid-item')
    const gap = 16
    const containerWidth = container.offsetWidth
    const columnWidth = (containerWidth - gap * (cols - 1)) / cols

    const heights = new Array(cols).fill(0)

    items.forEach((item) => {
      const img = item.querySelector('img')
      if (!img) return

      const shortestColumn = heights.indexOf(Math.min(...heights))
      const left = shortestColumn * (columnWidth + gap)
      const top = heights[shortestColumn]

      item.style.position = 'absolute'
      item.style.left = `${left}px`
      item.style.top = `${top}px`
      item.style.width = `${columnWidth}px`
      item.style.display = 'block'

      heights[shortestColumn] += item.offsetHeight + gap
    })

    const maxHeight = Math.max(...heights)
    container.style.height = `${maxHeight}px`
    setIsLayoutComplete(true)
  }, [calculateColumns])

  useEffect(() => {
    if (photos.length === 0) {
      setIsLayoutComplete(true)
      return
    }

    const isLazyLoad = isLayoutComplete && photos.length > prevPhotoCountRef.current
    if (!isLayoutComplete) {
      setIsLayoutComplete(false)
    }

    const imagesToLoad = isLazyLoad
      ? photos.slice(prevPhotoCountRef.current)
      : photos

    const imagePromises = imagesToLoad.map((photo) => {
      return new Promise<void>((resolve) => {
        const img = new Image()
        img.onload = () => resolve()
        img.onerror = () => resolve()
        img.src = photo.media_url
      })
    })

    Promise.all(imagePromises).then(() => {
      setTimeout(() => {
        calculateLayout()
        prevPhotoCountRef.current = photos.length
      }, 100)
    })
  }, [photos, calculateLayout, isLayoutComplete])

  useEffect(() => {
    const handleResize = () => {
      if (isLayoutComplete) {
        calculateLayout()
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isLayoutComplete, calculateLayout])

  const panelTheme = {
    textMuted: useDarkText ? 'text-gray-600' : 'text-white/70',
  }

  if (photos.length === 0) {
    return (
      <div className="text-center py-12">
        <p className={panelTheme.textMuted}>No photos available.</p>
      </div>
    )
  }

  return (
    <div className="relative w-full min-h-[400px]">
      {!isLayoutComplete && (
        <div className="flex flex-col items-center justify-center py-16 min-h-[400px]">
          <div
            className="loader mx-auto mb-4"
            style={{
              '--primary-color': '#fff',
              '--secondary-color': primaryColor,
            } as React.CSSProperties}
          />
          <p className={panelTheme.textMuted}>Loading photos...</p>
        </div>
      )}
      <div
        ref={containerRef}
        className={`relative w-full min-h-[200px] transition-opacity duration-300 ${
          isLayoutComplete ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {photos.map((photo, index) => (
          <div
            key={photo.id}
            className="photo-grid-item cursor-pointer overflow-hidden rounded-lg transition-all duration-200 hover:translate-y-[-4px] hover:shadow-[0_8px_16px_rgba(0,0,0,0.2)]"
            style={{ display: 'none', background: useDarkText ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)' }}
            onClick={() => onPhotoClick(index)}
          >
            <Image
              src={photo.media_url}
              alt={photo.caption || `Photo ${index + 1}`}
              width={800}
              height={600}
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="w-full h-auto block"
              unoptimized
            />
            {photo.caption && (
              <div className="px-2 py-1.5 bg-black/70 text-white text-xs">
                <p className="m-0 whitespace-nowrap overflow-hidden text-ellipsis">
                  {photo.caption}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
