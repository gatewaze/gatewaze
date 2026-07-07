'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { useAnalytics } from '@/hooks/useAnalytics'
import { moduleFromPath } from '@/lib/analytics'

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { page } = useAnalytics()
  const lastTrackedPath = useRef<string | null>(null)

  // Scroll to top on navigation and track page view. The ref guard keeps
  // one page view per actual path change — strict-mode double effects and
  // `page` identity changes otherwise duplicate them.
  useEffect(() => {
    window.scrollTo(0, 0)
    if (lastTrackedPath.current === pathname) return
    lastTrackedPath.current = pathname
    page(undefined, { path: pathname, module: moduleFromPath(pathname) })
  }, [pathname, page])

  return (
    <motion.div
      // Fade only — no transform. A transform on this wrapper changes the
      // containing block for `position: fixed` descendants, which mispositioned
      // fixed-centered page content (e.g. sign-in) until the animation cleared,
      // causing a left→centre jump. Opacity creates no containing block, so
      // fixed content stays viewport-relative throughout.
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        type: 'tween',
        duration: 0.32,
        ease: 'easeOut',
      }}
    >
      {children}
    </motion.div>
  )
}
