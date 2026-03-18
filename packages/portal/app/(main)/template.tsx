'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { useAnalytics } from '@/hooks/useAnalytics'

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { page } = useAnalytics()

  // Scroll to top on navigation and track page view
  useEffect(() => {
    window.scrollTo(0, 0)
    page(undefined, { path: pathname })
  }, [pathname, page])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        type: 'tween',
        duration: 0.4,
        delay: 0.15,
        ease: 'easeOut',
      }}
    >
      {children}
    </motion.div>
  )
}
