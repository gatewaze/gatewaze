'use client'

import { TimelineTabs } from './TimelineTabs'
import { TimelineSearch } from './TimelineSearch'
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
  onSearch,
  onClearSearch,
  isSearching,
  basePath,
  filterSuffix,
}: Props) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between mb-8 gap-4">
      <TimelineTabs brandConfig={brandConfig} upcomingCount={upcomingCount} pastCount={pastCount} basePath={basePath} filterSuffix={filterSuffix} />

      <TimelineSearch
        onSearch={onSearch}
        onClear={onClearSearch}
        isSearching={isSearching}
        primaryColor={brandConfig.primaryColor}
      />
    </div>
  )
}
