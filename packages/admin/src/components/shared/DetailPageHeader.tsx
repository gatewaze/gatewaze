import { useNavigate } from 'react-router';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Badge } from '@/components/ui';

interface DetailPageHeaderProps {
  title: string;
  subtitle?: string;
  backTo?: string;
  backLabel?: string;
  badges?: Array<{
    label: string;
    color?: 'green' | 'blue' | 'orange' | 'red' | 'gray' | 'neutral';
    variant?: 'soft' | 'solid' | 'outline';
  }>;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Shared detail page header with consistent back button, title, and optional badges.
 * Styled to match the event detail hero but shorter for non-event pages.
 *
 * @example
 * <DetailPageHeader
 *   title="Header Block"
 *   subtitle="header"
 *   backTo="/newsletters/templates/mlops"
 *   backLabel="Back"
 *   badges={[{ label: 'html_template', color: 'blue' }]}
 *   actions={<Button onClick={save}>Save</Button>}
 * />
 */
export function DetailPageHeader({
  title,
  subtitle,
  backTo,
  backLabel = 'Back',
  badges,
  actions,
  children,
}: DetailPageHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (backTo) {
      navigate(backTo);
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 -mx-6 -mt-6 mb-6 px-6 py-5">
      {/* Decorative gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent-9)]/10 to-transparent pointer-events-none" />

      <div className="relative">
        {/* Back button */}
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md
                     bg-white/90 backdrop-blur-md border border-white/40 text-gray-900
                     shadow-sm hover:bg-white transition-colors mb-3"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          {backLabel}
        </button>

        {/* Title row */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white">
              {title}
            </h1>
            {(subtitle || badges) && (
              <div className="flex items-center gap-2 mt-1">
                {subtitle && (
                  <span className="text-sm text-white/60">{subtitle}</span>
                )}
                {badges?.map((badge, i) => (
                  <Badge
                    key={i}
                    variant={badge.variant || 'soft'}
                    color={badge.color || 'blue'}
                    size="1"
                  >
                    {badge.label}
                  </Badge>
                ))}
              </div>
            )}
            {children && <div className="mt-2">{children}</div>}
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
