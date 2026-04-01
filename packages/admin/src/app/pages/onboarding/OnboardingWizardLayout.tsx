import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import GradientBackground from '@/components/shared/GradientBackground';

export interface WizardStep {
  label: string;
}

const STEPS: WizardStep[] = [
  { label: 'Platform' },
  { label: 'Account' },
  { label: 'Modules' },
  { label: 'Install' },
  { label: 'Branding' },
];

interface OnboardingWizardLayoutProps {
  currentStep: number;
  children: React.ReactNode;
  onNext?: () => void;
  onPrevious?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  showNext?: boolean;
  showPrevious?: boolean;
  /** Hide the step indicator (e.g. for the welcome screen) */
  hideSteps?: boolean;
  /** Hide the footer nav entirely (e.g. for auto-advancing steps) */
  hideFooter?: boolean;
}

export default function OnboardingWizardLayout({
  currentStep,
  children,
  onNext,
  onPrevious,
  nextLabel = 'Continue',
  nextDisabled = false,
  nextLoading = false,
  showNext = true,
  showPrevious = true,
  hideSteps = false,
  hideFooter = false,
}: OnboardingWizardLayoutProps) {
  return (
    <>
      <GradientBackground />
      <div className="flex min-h-[100svh] flex-col items-center justify-center p-4">
        {/* Logo — outside the card */}
        <div className="mb-6 flex justify-center">
          <img
            src="/theme/gatewaze/gatewaze-logo-black.svg"
            alt="Gatewaze"
            className="h-8"
          />
        </div>

        {/* Wizard card — fixed size, flex column layout */}
        <div className="flex w-full max-w-2xl flex-col rounded-xl border border-[var(--gray-a4)] bg-white shadow-lg"
             style={{ height: 'min(580px, calc(100svh - 120px))' }}>
          {/* Step indicator — always at the top */}
          {!hideSteps && (
            <div className="shrink-0 border-b border-[var(--gray-a4)] px-6 py-4">
              <div className="flex items-center justify-center gap-1">
                {STEPS.map((step, i) => (
                  <div key={step.label} className="flex items-center gap-1">
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                          i < currentStep
                            ? 'bg-[var(--accent-9)] text-white'
                            : i === currentStep
                              ? 'border-2 border-[var(--accent-9)] bg-white text-[var(--gray-12)]'
                              : 'bg-[var(--gray-a3)] text-[var(--gray-a8)]'
                        }`}
                      >
                        {i < currentStep ? '\u2713' : i + 1}
                      </div>
                      <span
                        className={`hidden text-xs font-medium sm:inline ${
                          i === currentStep
                            ? 'text-[var(--gray-12)]'
                            : i < currentStep
                              ? 'text-[var(--accent-9)]'
                              : 'text-[var(--gray-a8)]'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div
                        className={`mx-1 h-px w-4 sm:w-8 ${
                          i < currentStep ? 'bg-[var(--accent-9)]' : 'bg-[var(--gray-a4)]'
                        }`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto px-10 py-8">
            {children}
          </div>

          {/* Footer nav — always at the bottom */}
          {!hideFooter && (
            <div className="shrink-0 border-t border-[var(--gray-a4)] px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  {showPrevious && onPrevious ? (
                    <button
                      type="button"
                      onClick={onPrevious}
                      className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-[var(--gray-11)] hover:bg-[var(--gray-a3)] transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Back
                    </button>
                  ) : (
                    <div />
                  )}
                </div>
                <div>
                  {showNext && onNext && (
                    <Button
                      onClick={onNext}
                      disabled={nextDisabled || nextLoading}
                      size="3"
                    >
                      {nextLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          {nextLabel}
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
