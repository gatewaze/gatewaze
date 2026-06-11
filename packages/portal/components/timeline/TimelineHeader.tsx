'use client'

import { TimelineTabs } from './TimelineTabs'
import type { BrandConfig } from '@/config/brand'

interface Props {
  brandConfig: BrandConfig
  upcomingCount: number
  pastCount: number
  onSearch: (query: string) => void
  onClearSearch: () => void
  isSearching: boolean
  basePath?: string
  filterSuffix?: string
}

export function TimelineHeader({
  brandConfig,
  upcomingCount,
  pastCount,
  basePath,
  filterSuffix,
}: Props) {
  return (
    <div className="mb-8 flex justify-center sm:justify-start">
      <TimelineTabs brandConfig={brandConfig} upcomingCount={upcomingCount} pastCount={pastCount} basePath={basePath} filterSuffix={filterSuffix} />
    </div>
  )
}
