import { ReactNode } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { Card } from './Card';
import { Switch } from './Form/Switch';
import { Button } from './Button';

export interface ModuleCardProps {
  id: string;
  name: string;
  description: string;
  version?: string;
  enabled: boolean;
  /** Whether the toggle is disabled (e.g., not a super admin) */
  disabled?: boolean;
  toggling?: boolean;
  onToggle: (id: string) => void;
  /** Called when clicking the card body (opens guide/details) */
  onInfo?: () => void;
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

export function ModuleCard({
  id,
  name,
  description,
  version,
  enabled,
  disabled,
  toggling,
  onToggle,
  onInfo,
  update,
  children,
}: ModuleCardProps) {
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
            {version && (
              <span className="text-[10px] text-[var(--gray-a8)] shrink-0">
                v{version}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--gray-11)] line-clamp-2">
            {description}
          </p>
        </div>

        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
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
