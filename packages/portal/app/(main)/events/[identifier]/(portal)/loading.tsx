export default function EventPortalLoading() {
  return (
    <div className="min-h-screen">
      <main className="relative z-10">
        <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8">
          {/* Hero Section Skeleton */}
          <div className="pt-2 pb-8 lg:pt-4 lg:pb-8">
            <div className="flex flex-col lg:flex-row gap-6 lg:gap-12 items-start">
              {/* Left Column - Image Placeholder */}
              <div className="w-full lg:w-[320px] flex-shrink-0">
                <div className="animate-pulse">
                  <div className="bg-white/15 backdrop-blur-[10px] rounded-2xl border border-white/20 aspect-square" />
                </div>
              </div>

              {/* Right Column - Event Details Skeleton */}
              <div className="flex-1 min-w-0 flex flex-col items-center lg:items-start">
                {/* Title skeleton */}
                <div className="animate-pulse w-full mb-6">
                  <div className="h-10 lg:h-12 bg-white/15 rounded-lg w-3/4 mx-auto lg:mx-0" />
                  <div className="h-10 lg:h-12 bg-white/15 rounded-lg w-1/2 mx-auto lg:mx-0 mt-2" />
                </div>

                {/* Date & Location skeleton */}
                <div className="flex flex-col gap-4 w-full">
                  {/* Date */}
                  <div className="flex items-center gap-3 lg:gap-4 animate-pulse">
                    <div className="flex-shrink-0 w-12 h-12 lg:w-14 lg:h-14 rounded-lg bg-white/15" />
                    <div className="flex-1">
                      <div className="h-5 bg-white/15 rounded w-40 mb-1" />
                      <div className="h-4 bg-white/10 rounded w-24" />
                    </div>
                  </div>

                  {/* Location */}
                  <div className="flex items-center gap-3 lg:gap-4 animate-pulse">
                    <div className="flex-shrink-0 w-12 h-12 lg:w-14 lg:h-14 rounded-lg bg-white/15" />
                    <div className="flex-1">
                      <div className="h-5 bg-white/15 rounded w-48 mb-1" />
                      <div className="h-4 bg-white/10 rounded w-32" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile Actions Skeleton */}
          <div className="lg:hidden pb-6 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-12 bg-white/15 backdrop-blur-[10px] rounded-xl border border-white/20" />
              <div className="w-12 h-12 bg-white/15 backdrop-blur-[10px] rounded-xl border border-white/20" />
            </div>
          </div>

          {/* Two-column layout: Sidebar + Content */}
          <div className="flex flex-col lg:flex-row gap-6 lg:gap-12 pb-12">
            {/* Left Sidebar Skeleton - Desktop only */}
            <div className="hidden lg:block w-[320px] flex-shrink-0 space-y-4 animate-pulse">
              {/* Register button placeholder */}
              <div className="h-12 bg-white/15 backdrop-blur-[10px] rounded-2xl border border-white/20" />

              {/* Nav panel */}
              <div className="bg-white/15 backdrop-blur-[10px] rounded-2xl border border-white/20 p-2">
                <div className="flex flex-col gap-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-3 p-1">
                      <div className="w-11 h-11 rounded-xl bg-white/10" />
                      <div className="h-4 bg-white/10 rounded w-20" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Content Skeleton */}
            <div className="flex-1 min-w-0 animate-pulse">
              <div className="bg-white/15 backdrop-blur-[10px] rounded-2xl border border-white/20 p-6 sm:p-8">
                {/* Content blocks */}
                <div className="space-y-4">
                  <div className="h-6 bg-white/10 rounded w-1/3" />
                  <div className="h-4 bg-white/10 rounded w-full" />
                  <div className="h-4 bg-white/10 rounded w-full" />
                  <div className="h-4 bg-white/10 rounded w-5/6" />
                  <div className="h-4 bg-white/10 rounded w-4/5" />
                </div>

                <div className="mt-8 space-y-4">
                  <div className="h-6 bg-white/10 rounded w-1/4" />
                  <div className="h-4 bg-white/10 rounded w-full" />
                  <div className="h-4 bg-white/10 rounded w-3/4" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
