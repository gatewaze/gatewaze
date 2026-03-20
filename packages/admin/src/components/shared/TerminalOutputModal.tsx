import { useEffect, useRef, useState } from 'react';
import { XMarkIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
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
      // You could add a toast notification here
    } catch (err) {
      console.error('Failed to copy output:', err);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <div className={`flex flex-col ${showScreenshotPreview ? 'h-[85vh]' : 'h-[80vh]'}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {title}
            </h2>
            {isRunning && (
              <span className="text-sm text-green-600 dark:text-green-400">
                Running...
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="flat"
              onClick={copyToClipboard}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title="Copy output to clipboard"
            >
              <DocumentTextIcon className="size-4" />
            </Button>
            {onClear && (
              <Button
                variant="flat"
                onClick={onClear}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title="Clear output"
              >
                Clear
              </Button>
            )}
            <Button
              variant="flat"
              isIcon
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <XMarkIcon className="size-5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Terminal Output */}
          <div className={`flex flex-col bg-gray-900 text-green-400 font-mono text-sm overflow-hidden ${showScreenshotPreview ? 'h-1/2' : 'flex-1'}`}>
            <div
              ref={outputRef}
              onScroll={handleScroll}
              className="flex-1 p-4 overflow-y-auto text-left"
              style={{
                scrollBehavior: autoScroll ? 'smooth' : 'auto'
              }}
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

            {/* Auto-scroll controls */}
            {!autoScroll && (
              <div className="p-2 border-t border-gray-700 flex justify-start">
                <Button
                  variant="outlined"
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
            <div className="h-1/2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                  Screenshot Preview
                </h3>
                {onBrowserlessGeneration && !isRunning && screenshotUrl && (
                  <Button
                    variant="outlined"
                    onClick={onBrowserlessGeneration}
                    className="text-xs bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-400"
                  >
                    🌐 Force BrowserLess.io
                  </Button>
                )}
              </div>
              <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                {screenshotUrl ? (
                  <div className="w-full h-full flex items-center justify-center p-4">
                    <img
                      src={screenshotUrl}
                      alt={`Screenshot of ${eventTitle || 'event'}`}
                      className="max-w-full max-h-full object-contain rounded shadow-lg"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        target.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                    <div className="hidden text-gray-500 dark:text-gray-400 text-center">
                      <div className="text-4xl mb-2">🖼️</div>
                      <div>Screenshot not available</div>
                      <div className="text-xs mt-1 text-gray-400">{screenshotUrl}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500 dark:text-gray-400 text-center">
                    <div className="text-4xl mb-2">⏳</div>
                    <div>Waiting for screenshot...</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-between items-center text-sm text-gray-600 dark:text-gray-400 flex-shrink-0">
          <span>
            {output.length} lines | Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
            {showScreenshotPreview && screenshotUrl && ' | Screenshot loaded'}
          </span>
          {!isRunning && (
            <Button
              variant="outlined"
              onClick={onClose}
              className="ml-auto"
            >
              Close
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}