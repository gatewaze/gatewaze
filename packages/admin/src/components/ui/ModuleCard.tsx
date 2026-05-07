import { ReactNode } from 'react';
import { ArrowPathIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import { Link } from 'react-router';
import { Card } from './Card';
import { Switch } from './Form/Switch';
import { Button } from './Button';

export interface ModuleCardProps {
  id: string;
  name: string;
  description: string;
  /** ISO timestamp of the most-recent change inside the module dir. */
  lastModifiedAt?: string;
  enabled: boolean;
  /** Whether the toggle is disabled (e.g., not a super admin) */
  disabled?: boolean;
  toggling?: boolean;
  onToggle: (id: string) => void;
  /** Called when clicking the card body (opens guide/details) */
  onInfo?: () => void;
  /** Route for the module's dedicated settings page (renders a gear icon) */
  settingsHref?: string;
  /** Update banner */
  update?: {
    fromVersion: string;
    toVersion: string;
    compatible: boolean;
    minPlatformVersion?: string;
    updating: boolean;
    onUpdate: () => void;
  };
  children?: ReactNode;
}

/** Format an ISO timestamp as "Updated <relative>" — coarse, no extra deps. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'Updated just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'Updated just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `Updated ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Updated ${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `Updated ${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `Updated ${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `Updated ${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `Updated ${yr}y ago`;
}

export function ModuleCard({
  id,
  name,
  description,
  lastModifiedAt,
  enabled,
  disabled,
  toggling,
  onToggle,
  onInfo,
  settingsHref,
  update,
  children,
}: ModuleCardProps) {
  const updatedLabel = lastModifiedAt ? formatRelative(lastModifiedAt) : '';
  return (
    <Card
      className={`p-4 transition-all ${
        onInfo ? 'cursor-pointer' : ''
      } ${
        enabled
          ? 'ring-2 ring-[var(--accent-9)] bg-[var(--accent-a2)]'
          : 'hover:bg-[var(--gray-a2)]'
      } ${toggling ? 'opacity-70 pointer-events-none' : ''}`}
      onClick={() => {
        if (onInfo) onInfo();
      }}
    >
      {/* Top row: name + switch */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-[var(--gray-12)] text-sm truncate">
              {name}
            </h4>
            {updatedLabel && (
              <span
                className="text-[10px] text-[var(--gray-a8)] shrink-0"
                title={lastModifiedAt}
              >
                {updatedLabel}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--gray-11)] line-clamp-2">
            {description}
          </p>
        </div>

        <div className="shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {settingsHref && enabled && (
            <Link
              to={settingsHref}
              aria-label={`${name} settings`}
              className="text-[var(--gray-a10)] hover:text-[var(--gray-12)] transition-colors"
            >
              <Cog6ToothIcon className="size-4" />
            </Link>
          )}
          <Switch
            checked={enabled}
            onChange={() => { if (!disabled && !toggling) onToggle(id); }}
            disabled={disabled || toggling}
            color="cyan"
          />
        </div>
      </div>

      {/* Update banner */}
      {update && (
        <div
          className={`mt-3 flex items-center justify-between gap-3 rounded-md px-3 py-2 ${
            update.compatible
              ? 'bg-blue-500/10 border border-blue-500/20'
              : 'bg-amber-500/10 border border-amber-500/20'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <p className={`text-xs font-medium ${update.compatible ? 'text-blue-400' : 'text-amber-400'}`}>
              {update.compatible ? 'Update available' : 'Update blocked'}
            </p>
            <p className="text-[10px] text-[var(--gray-a9)]">
              v{update.fromVersion} → v{update.toVersion}
            </p>
            {!update.compatible && update.minPlatformVersion && (
              <p className="text-[10px] text-amber-400/80 mt-0.5">
                Requires platform v{update.minPlatformVersion}
              </p>
            )}
          </div>
          <Button
            onClick={update.onUpdate}
            size="1"
            disabled={update.updating || !update.compatible}
          >
            <ArrowPathIcon className={`size-3 mr-1 ${update.updating ? 'animate-spin' : ''}`} />
            {update.updating ? '...' : 'Update'}
          </Button>
        </div>
      )}

      {children}
    </Card>
  );
}
