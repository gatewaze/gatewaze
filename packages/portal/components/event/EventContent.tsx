'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import type { Event } from '@/types/event'

interface Props {
  event: Event
  useDarkText: boolean
}

export function EventContent({ event, useDarkText }: Props) {
  const [sanitizedHtml, setSanitizedHtml] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Content priority: page_content → luma_processed_html → meetup_processed_html
  const processedHtml = event.page_content || event.luma_processed_html || event.meetup_processed_html

  // Sanitize HTML and process portrait images
  useEffect(() => {
    if (processedHtml && typeof window !== 'undefined') {
      import('dompurify').then((DOMPurify) => {
        const clean = DOMPurify.default.sanitize(processedHtml, {
          ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'code', 'pre', 'hr', 'u', 's', 'sub', 'sup', 'div', 'span'],
          ALLOWED_ATTR: ['href', 'src', 'alt', 'width', 'height', 'target', 'rel', 'class', 'style'],
        })

        // Parse and process portrait images (add max-height style on desktop)
        const isDesktop = window.matchMedia('(min-width: 1024px)').matches
        if (isDesktop) {
          const parser = new DOMParser()
          const doc = parser.parseFromString(clean, 'text/html')
          const images = doc.querySelectorAll('img')

          images.forEach((img) => {
            const width = parseInt(img.getAttribute('width') || '0', 10)
            const height = parseInt(img.getAttribute('height') || '0', 10)
            // If we have dimensions and it's portrait orientation
            if (width > 0 && height > 0 && height > width) {
              img.style.maxHeight = '400px'
              img.style.width = 'auto'
              img.setAttribute('data-portrait', 'true')
            }
          })

          setSanitizedHtml(doc.body.innerHTML)
        } else {
          setSanitizedHtml(clean)
        }
      })
    }
  }, [processedHtml])

  // Fallback: resize portrait images that didn't have width/height attributes
  useEffect(() => {
    if (!sanitizedHtml || !contentRef.current) return

    const isDesktop = window.matchMedia('(min-width: 1024px)').matches
    if (!isDesktop) return

    const images = contentRef.current.querySelectorAll<HTMLImageElement>('img:not([data-portrait])')

    const handleImageLoad = (img: HTMLImageElement) => {
      const { naturalWidth, naturalHeight } = img
      if (naturalHeight > naturalWidth) {
        img.style.maxHeight = '400px'
        img.style.width = 'auto'
      }
    }

    images.forEach((img) => {
      if (img.complete && img.naturalWidth) {
        handleImageLoad(img)
      } else {
        img.addEventListener('load', () => handleImageLoad(img), { once: true })
      }
    })
  }, [sanitizedHtml])

  // Theme colors based on background luminance
  const theme = useMemo(() => ({
    textColor: useDarkText ? '#1f2937' : '#ffffff',
    textMutedColor: useDarkText ? '#374151' : 'rgba(255,255,255,0.85)',
    headingColor: useDarkText ? '#111827' : '#ffffff',
    linkColor: useDarkText ? '#2563eb' : '#93c5fd',
    blockquoteBorder: useDarkText ? '#d1d5db' : 'rgba(255,255,255,0.3)',
    blockquoteBg: useDarkText ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.08)',
    codeBg: useDarkText ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
  }), [useDarkText])

  // Check if we have any content to display
  const hasContent = processedHtml || event.event_description || event.listing_intro

  if (!hasContent) {
    return null
  }

  return (
    <div>
      {processedHtml ? (
        sanitizedHtml ? (
          <div
            ref={contentRef}
            className={`
              prose prose-lg max-w-none

              [&_p]:mb-5 [&_p]:leading-[1.8] [&_p]:text-[1.0625rem]

              [&_h1]:text-3xl [&_h1]:sm:text-4xl [&_h1]:font-bold [&_h1]:mb-6 [&_h1]:mt-10 [&_h1]:first:mt-0 [&_h1]:leading-tight [&_h1]:tracking-tight
              [&_h2]:text-2xl [&_h2]:sm:text-3xl [&_h2]:font-bold [&_h2]:mb-5 [&_h2]:mt-10 [&_h2]:first:mt-0 [&_h2]:leading-tight
              [&_h3]:text-xl [&_h3]:sm:text-2xl [&_h3]:font-semibold [&_h3]:mb-4 [&_h3]:mt-8 [&_h3]:first:mt-0
              [&_h4]:text-lg [&_h4]:sm:text-xl [&_h4]:font-semibold [&_h4]:mb-3 [&_h4]:mt-6 [&_h4]:first:mt-0

              [&_img]:my-8 [&_img]:max-w-full [&_img]:rounded-2xl [&_img]:mx-auto [&_img]:shadow-xl
              [&_div>img]:my-0 [&_div>img]:mx-0
              [&>div]:mb-8

              [&_a]:underline [&_a]:underline-offset-4 [&_a]:decoration-1 [&_a]:transition-all [&_a]:duration-200 [&_a]:hover:opacity-80 [&_a]:cursor-pointer

              [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:mb-5 [&_ul]:space-y-2
              [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:mb-5 [&_ol]:space-y-2
              [&_li]:leading-[1.75] [&_li]:text-[1.0625rem] [&_li_p]:mb-2

              [&_blockquote]:border-l-4 [&_blockquote]:pl-6 [&_blockquote]:pr-4 [&_blockquote]:py-4 [&_blockquote]:my-8 [&_blockquote]:rounded-r-lg
              [&_blockquote_p]:mb-0 [&_blockquote_p]:text-[1.125rem] [&_blockquote_p]:leading-[1.75] [&_blockquote_p]:italic

              [&_code]:px-2 [&_code]:py-1 [&_code]:rounded-md [&_code]:text-sm [&_code]:font-mono
              [&_pre]:p-5 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:my-6 [&_pre]:text-sm

              [&_hr]:my-10 [&_hr]:border-current [&_hr]:opacity-20

              [&_strong]:font-bold
              [&_em]:italic
            `}
            style={{
              color: theme.textMutedColor,
              ['--heading-color' as string]: theme.headingColor,
            }}
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        ) : (
          // Loading state while sanitizing
          <div className="animate-pulse space-y-4" style={{ color: theme.textMutedColor }}>
            <div className="h-6 bg-white/10 rounded w-3/4"></div>
            <div className="h-4 bg-white/10 rounded w-full"></div>
            <div className="h-4 bg-white/10 rounded w-5/6"></div>
          </div>
        )
      ) : (
        <p
          className="whitespace-pre-wrap leading-[1.8] text-lg"
          style={{ color: theme.textMutedColor }}
        >
          {event.event_description || event.listing_intro}
        </p>
      )}

      <style jsx>{`
        div :global(h1),
        div :global(h2),
        div :global(h3),
        div :global(h4) {
          color: ${theme.headingColor};
        }
        div :global(a) {
          color: ${theme.linkColor};
        }
        div :global(blockquote) {
          border-color: ${theme.blockquoteBorder};
          background-color: ${theme.blockquoteBg};
        }
        div :global(code) {
          background-color: ${theme.codeBg};
        }
        div :global(pre) {
          background-color: ${theme.codeBg};
        }
      `}</style>
    </div>
  )
}
