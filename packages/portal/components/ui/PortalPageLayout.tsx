import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Additional class names for the content container */
  className?: string
}

/**
 * Standard portal page layout container.
 * Wraps content in the max-w-7xl container with proper padding.
 * Background is now handled by PersistentBackground in the root layout.
 */
export function PortalPageLayout({
  children,
  className = '',
}: Props) {
  return (
    <main className="relative z-10">
      <div className={`max-w-7xl mx-auto px-6 sm:px-6 lg:px-8 py-12 ${className}`}>
        {children}
      </div>
    </main>
  )
}
