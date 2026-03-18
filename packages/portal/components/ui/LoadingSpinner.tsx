import type { BrandConfig } from '@/config/brand'

interface LoadingSpinnerProps {
  size?: 'small' | 'medium' | 'large'
  message?: string
  brandConfig: BrandConfig
}

/**
 * Loading spinner with 2-dot animation using brand colors
 */
export function LoadingSpinner({ size = 'medium', message, brandConfig }: LoadingSpinnerProps) {
  const sizeClass = `loader-${size}`

  return (
    <div className="flex flex-col items-center justify-center">
      <div
        className={`loader ${sizeClass}`}
        style={
          {
            '--primary-color': brandConfig.primaryColor,
            '--secondary-color': brandConfig.secondaryColor,
          } as React.CSSProperties
        }
      />
      {message && <p className="text-gray-600 mt-4">{message}</p>}
    </div>
  )
}
