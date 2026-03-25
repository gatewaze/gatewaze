import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useHasModule } from '@/hooks/useModuleFeature';

interface ModuleDependencyNoticeProps {
  /** Module ID to check (e.g. 'event-speakers') */
  moduleId: string;
  /** Human-readable module name for display */
  moduleName: string;
  /** Description of what features are unavailable */
  featureDescription?: string;
}

/**
 * Displays an inline notice when a required module dependency is not enabled.
 * Returns null if the module is enabled.
 *
 * @example
 * <ModuleDependencyNotice
 *   moduleId="event-speakers"
 *   moduleName="Event Speakers"
 *   featureDescription="speaker assignments, talks, and talk duration tracking"
 * />
 */
export function ModuleDependencyNotice({ moduleId, moduleName, featureDescription }: ModuleDependencyNoticeProps) {
  const isEnabled = useHasModule(moduleId);

  if (isEnabled) return null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20">
      <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-medium text-amber-800 dark:text-amber-300">
          {moduleName} module is not enabled
        </p>
        <p className="text-amber-700 dark:text-amber-400 mt-0.5">
          {featureDescription
            ? `Enable the ${moduleName} module to use ${featureDescription}.`
            : `Some features require the ${moduleName} module to be enabled.`}
          {' '}You can enable it from the Modules page in Settings.
        </p>
      </div>
    </div>
  );
}
