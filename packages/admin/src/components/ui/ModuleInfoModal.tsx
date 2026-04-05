import { lazy, Suspense } from 'react';
import { Modal } from './Modal';
import { Switch } from './Form/Switch';

const GuideContent = lazy(() => import('./GuideContent'));

interface ModuleInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  moduleName: string;
  guide: string;
  /** If provided, shows an enable/disable toggle at the top */
  enabled?: boolean;
  onToggle?: () => void;
  toggleDisabled?: boolean;
}

export function ModuleInfoModal({
  isOpen, onClose, moduleName, guide,
  enabled, onToggle, toggleDisabled,
}: ModuleInfoModalProps) {
  const content = guide.replace(/^#\s+.+\n+/, '');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={moduleName} size="xl">
      {onToggle !== undefined && (
        <div className="flex items-center justify-between py-2 mb-3 border-b border-[var(--gray-a5)]">
          <span className="text-sm text-[var(--gray-11)]">
            {enabled ? 'Module enabled' : 'Module disabled'}
          </span>
          <Switch
            checked={!!enabled}
            onChange={onToggle}
            disabled={toggleDisabled}
            color="cyan"
          />
        </div>
      )}

      <Suspense fallback={
        <div className="flex justify-center py-12">
          <div className="size-5 border-2 border-[var(--accent-9)] border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <GuideContent content={content} />
      </Suspense>

      <style>{`
        .module-guide { color: var(--gray-11); font-size: 14px; line-height: 1.7; }
        .module-guide h1 { font-size: 1.5em; font-weight: 700; color: var(--gray-12); margin: 1.5em 0 0.5em; border-bottom: 1px solid var(--gray-a5); padding-bottom: 0.3em; }
        .module-guide h1:first-child { margin-top: 0; }
        .module-guide h2 { font-size: 1.25em; font-weight: 600; color: var(--gray-12); margin: 1.5em 0 0.5em; }
        .module-guide h3 { font-size: 1.1em; font-weight: 600; color: var(--gray-12); margin: 1.2em 0 0.4em; }
        .module-guide p { margin: 0.6em 0; }
        .module-guide ul { margin: 0.6em 0; padding-left: 1.5em; list-style: disc; }
        .module-guide ol { margin: 0.6em 0; padding-left: 1.5em; list-style: decimal; }
        .module-guide li { margin: 0.25em 0; display: list-item; }
        .module-guide code { background: var(--gray-a3); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; color: var(--accent-11); }
        .module-guide pre { background: var(--gray-a3); border: 1px solid var(--gray-a5); border-radius: 8px; padding: 1em; overflow-x: auto; margin: 0.8em 0; }
        .module-guide pre code { background: none; padding: 0; font-size: 0.85em; color: var(--gray-12); }
        .module-guide table { width: 100%; border-collapse: collapse; font-size: 0.9em; margin: 0.8em 0; }
        .module-guide th { text-align: left; font-weight: 600; color: var(--gray-12); border-bottom: 1px solid var(--gray-a5); padding: 0.5em 0.75em; }
        .module-guide td { border-bottom: 1px solid var(--gray-a3); padding: 0.5em 0.75em; }
        .module-guide blockquote { border-left: 3px solid var(--accent-9); margin: 0.8em 0; padding: 0.4em 1em; color: var(--gray-11); background: var(--gray-a2); border-radius: 0 6px 6px 0; }
        .module-guide hr { border: none; border-top: 1px solid var(--gray-a5); margin: 1.5em 0; }
        .module-guide a { color: var(--accent-9); text-decoration: none; }
        .module-guide a:hover { text-decoration: underline; }
        .module-guide strong { color: var(--gray-12); }
      `}</style>
    </Modal>
  );
}
