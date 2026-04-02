import type { BrandConfig } from '@/config/brand'
import { GlowBorder } from '@/components/ui/GlowBorder'

interface Props {
  brandConfig: BrandConfig
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function NotFoundContent({ brandConfig }: Props) {
  return (
    <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <GlowBorder borderRadius="1.5rem" useDarkTheme={false}>
          <div className="bg-white/15 backdrop-blur-[10px] rounded-3xl shadow-2xl border border-white/20 p-8 sm:p-12 max-w-lg w-full text-center">
            {/* 404 Icon */}
            <div className="mb-6">
              <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto border border-white/30">
                <span className="text-4xl font-bold text-white/80">404</span>
              </div>
            </div>

            {/* Title */}
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3 drop-shadow-lg">
              Page Not Found
            </h1>

            {/* Description */}
            <p className="text-white/80 mb-8">
              The page you&apos;re looking for doesn&apos;t exist or has been moved.
            </p>

            {/* CTA */}
            <a
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white/20 hover:bg-white/30 text-white font-semibold rounded-xl transition-all duration-200 border border-white/30 hover:border-white/50"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>Go Home</span>
            </a>
          </div>
        </GlowBorder>
    </main>
  )
}
