'use client'

import Link from 'next/link'

interface Props {
  className?: string
}

export function WhiteLabelFooter({ className = '' }: Props) {
  return (
    <footer className={`relative z-10 py-8 ${className}`}>
      <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8">
        <div className="text-base text-white/60 flex gap-4 justify-center flex-wrap">
          <Link
            href="/privacy"
            className="cursor-pointer relative hover:text-white transition-colors group"
          >
            Privacy Policy
            <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-white/60 transition-all duration-300 group-hover:w-full" />
          </Link>
          <span className="text-white/30">|</span>
          <Link
            href="/terms"
            className="cursor-pointer relative hover:text-white transition-colors group"
          >
            Terms of Service
            <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-white/60 transition-all duration-300 group-hover:w-full" />
          </Link>
          <span className="text-white/30">|</span>
          <Link
            href="/do-not-sell"
            className="cursor-pointer relative hover:text-white transition-colors group"
          >
            Do Not Sell My Info
            <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-white/60 transition-all duration-300 group-hover:w-full" />
          </Link>
          <span className="text-white/30">|</span>
          <a
            href="https://gatewaze.com"
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-pointer relative hover:text-white transition-colors group"
          >
            Powered by Gatewaze
            <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-white/60 transition-all duration-300 group-hover:w-full" />
          </a>
        </div>
      </div>
    </footer>
  )
}
