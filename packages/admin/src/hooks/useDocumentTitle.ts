import { useLayoutEffect, useRef } from 'react'

import { useUnmount } from './index'

type UseDocumentTitleOptions = {
  preserveTitleOnUnmount?: boolean
}

export function useDocumentTitle(
  title: string,
  options: UseDocumentTitleOptions = {},
): void {
  const { preserveTitleOnUnmount = true } = options
  const defaultTitle = useRef<string | null>(null)

  useLayoutEffect(() => {
    defaultTitle.current = window.document.title
  }, [])

  useLayoutEffect(() => {
    window.document.title = title
  }, [title])

  useUnmount(() => {
    if (!preserveTitleOnUnmount && defaultTitle.current) {
      window.document.title = defaultTitle.current
    }
  })
}