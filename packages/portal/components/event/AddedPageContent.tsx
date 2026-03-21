'use client'

import { useState, useEffect } from 'react'
import { useEventContext } from './EventContext'

export function AddedPageContent() {
  const { event, useDarkText, theme } = useEventContext()
  const [sanitizedHtml, setSanitizedHtml] = useState<string | null>(null)

  useEffect(() => {
    if (event.addedpage_content && typeof window !== 'undefined') {
      import('dompurify').then((DOMPurify) => {
        const clean = DOMPurify.default.sanitize(event.addedpage_content!, {
          ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'code', 'pre', 'hr', 'u', 's', 'sub', 'sup', 'div', 'span'],
          ALLOWED_ATTR: ['href', 'src', 'alt', 'width', 'height', 'target', 'rel', 'class', 'style'],
        })
        setSanitizedHtml(clean)
      })
    }
  }, [event.addedpage_content])

  if (!sanitizedHtml) {
    return (
      <div className="animate-pulse space-y-4">
        <div className={`h-6 ${useDarkText ? 'bg-gray-900/10' : 'bg-white/10'} rounded w-3/4`} />
        <div className={`h-4 ${useDarkText ? 'bg-gray-900/10' : 'bg-white/10'} rounded w-full`} />
        <div className={`h-4 ${useDarkText ? 'bg-gray-900/10' : 'bg-white/10'} rounded w-5/6`} />
      </div>
    )
  }

  const textColor = useDarkText ? 'text-gray-900' : 'text-white'

  return (
    <div className="space-y-6">
      <h1 className={`text-2xl sm:text-3xl font-bold ${textColor}`}>
        {event.addedpage_title || 'Workshops'}
      </h1>
      <div
        className="prose prose-lg max-w-none [&_p]:mb-5 [&_p]:leading-[1.8] [&_p]:text-[1.0625rem] [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-6 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-5 [&_h2]:mt-10 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mb-4 [&_h3]:mt-8 [&_a]:underline [&_a]:underline-offset-4 [&_ul]:list-disc [&_ul]:ml-6 [&_ol]:list-decimal [&_ol]:ml-6 [&_img]:my-8 [&_img]:rounded-2xl [&_img]:mx-auto [&_img]:shadow-xl [&_blockquote]:border-l-4 [&_blockquote]:pl-6 [&_blockquote]:my-8"
        style={{ color: theme.textMutedColor }}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    </div>
  )
}
