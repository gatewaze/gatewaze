import { useEffect, useRef, useState } from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { Modal, Button } from '@/components/ui';

interface TerminalOutputModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  isRunning: boolean;
  output: string[];
  onClear?: () => void;
  screenshotUrl?: string;
  eventTitle?: string;
  showScreenshotPreview?: boolean;
  onBrowserlessGeneration?: () => void;
  currentEventId?: string;
}

export function TerminalOutputModal({
  isOpen,
  onClose,
  title,
  isRunning,
  output,
  onClear,
  screenshotUrl,
  eventTitle,
  showScreenshotPreview = false,
  onBrowserlessGeneration,
  currentEventId
}: TerminalOutputModalProps) {
  const outputRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom when new output is added
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, autoScroll]);

  // Check if user has scrolled up (disable auto-scroll)
  const handleScroll = () => {
    if (outputRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
      setAutoScroll(isAtBottom);
    }
  };

  const scrollToBottom = () => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
      setAutoScroll(true);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(output.join('\\n'));
    } catch (err) {
      console.error('Failed to copy output:', err);
    }
  };

  const footer = (
    <div className="flex justify-between items-center w-full">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={copyToClipboard} title="Copy output to clipboard">
          <DocumentTextIcon className="size-4 mr-1" />
          Copy
        </Button>
        {onClear && (
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
        {onBrowserlessGeneration && !isRunning && (
          <Button variant="outline" onClick={onBrowserlessGeneration}>
            Force BrowserLess.io
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--gray-a9)]">
          {output.length} lines{isRunning ? ' | Running...' : ''}
        </span>
        {!isRunning && (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="2xl" footer={footer}>
      <div className="flex flex-col gap-4" style={{ minHeight: showScreenshotPreview ? '60vh' : '40vh' }}>
        {/* Status indicator */}
        {isRunning && (
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-green-600 dark:text-green-400">Running...</span>
          </div>
        )}

        {/* Terminal Output */}
        <div className="flex flex-col bg-gray-900 text-green-400 font-mono text-sm rounded-lg overflow-hidden flex-1">
          <div
            ref={outputRef}
            onScroll={handleScroll}
            className="flex-1 p-4 overflow-y-auto text-left"
            style={{ scrollBehavior: autoScroll ? 'smooth' : 'auto', maxHeight: showScreenshotPreview ? '30vh' : '50vh' }}
          >
            {output.length === 0 ? (
              <div className="text-gray-500">
                {isRunning ? 'Initializing...' : 'No output yet'}
              </div>
            ) : (
              output.map((line, index) => (
                <div key={index} className="mb-1 text-left">
                  <span className="text-gray-600 mr-2 select-none">{String(index + 1).padStart(3, ' ')}:</span>
                  <span className="text-green-400 whitespace-pre-wrap break-words">{line}</span>
                </div>
              ))
            )}

            {isRunning && (
              <div className="flex items-center gap-2 text-yellow-400 mt-2">
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                <span>Processing...</span>
              </div>
            )}
          </div>

          {!autoScroll && (
            <div className="p-2 border-t border-gray-700 flex justify-start">
              <Button
                variant="outline"
                onClick={scrollToBottom}
                className="text-xs text-gray-400 border-gray-600 hover:border-gray-500"
              >
                Scroll to bottom
              </Button>
            </div>
          )}
        </div>

        {/* Screenshot Preview */}
        {showScreenshotPreview && (
          <div className="bg-[var(--gray-a2)] border border-[var(--gray-a5)] rounded-lg p-4 flex flex-col">
            <h3 className="text-sm font-medium mb-2">Screenshot Preview</h3>
            <div className="flex items-center justify-center bg-[var(--color-surface)] border border-[var(--gray-a4)] rounded-lg overflow-hidden" style={{ minHeight: '200px' }}>
              {screenshotUrl ? (
                <div className="w-full flex items-center justify-center p-4">
                  <img
                    src={screenshotUrl}
                    alt={`Screenshot of ${eventTitle || 'event'}`}
                    className="max-w-full max-h-[250px] object-contain rounded shadow-lg"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      target.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  <div className="hidden text-[var(--gray-a9)] text-center">
                    <div className="text-4xl mb-2">🖼️</div>
                    <div>Screenshot not available</div>
                    <div className="text-xs mt-1">{screenshotUrl}</div>
                  </div>
                </div>
              ) : (
                <div className="text-[var(--gray-a9)] text-center py-8">
                  <div className="text-4xl mb-2">⏳</div>
                  <div>Waiting for screenshot...</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
