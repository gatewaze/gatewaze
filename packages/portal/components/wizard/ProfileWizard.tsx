'use client'

import { useState, ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { BrandConfig } from '@/config/brand'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { PortalButton } from '@/components/ui/PortalButton'

export interface WizardStep {
  id: string
  title: string
  component: ReactNode
  /** Whether this step counts toward progress */
  countInProgress?: boolean
  /** Validation function - return true if step is valid, or returns error messages. Can be async. */
  validate?: () => true | Record<string, string> | Promise<true | Record<string, string>>
}

interface Props {
  brandConfig: BrandConfig
  steps: WizardStep[]
  onComplete: () => void
  onClose?: () => void
}

/**
 * Wizard component for multi-step flows (e.g., profile completion).
 * Features:
 * - Progress bar at the top
 * - Animated step transitions
 * - Next/Previous navigation at the bottom
 * - Glass panel styling
 */
export function ProfileWizard({ brandConfig, steps, onComplete, onClose }: Props) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [direction, setDirection] = useState(0) // -1 for prev, 1 for next
  const [isSubmitting, setIsSubmitting] = useState(false)

  const currentStep = steps[currentStepIndex]
  const isFirstStep = currentStepIndex === 0
  const isLastStep = currentStepIndex === steps.length - 1

  // Calculate progress
  const progressSteps = steps.filter(s => s.countInProgress !== false)
  const currentProgressIndex = progressSteps.findIndex(s => s.id === currentStep.id)
  const progressPercentage = progressSteps.length > 1
    ? Math.max(5, ((currentProgressIndex) / (progressSteps.length - 1)) * 100)
    : 100

  const [isValidating, setIsValidating] = useState(false)

  const handleNext = async () => {
    // Validate current step if validation function exists
    // The validate function handles setting errors in the parent component
    if (currentStep.validate) {
      setIsValidating(true)
      try {
        const result = await currentStep.validate()
        if (result !== true) {
          setIsValidating(false)
          return
        }
      } finally {
        setIsValidating(false)
      }
    }

    if (isLastStep) {
      setIsSubmitting(true)
      try {
        await onComplete()
      } finally {
        setIsSubmitting(false)
      }
    } else {
      setDirection(1)
      setCurrentStepIndex(prev => prev + 1)
    }
  }

  const handlePrevious = () => {
    if (!isFirstStep) {
      setDirection(-1)
      setCurrentStepIndex(prev => prev - 1)
    }
  }

  // Animation variants
  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 50 : -50,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 50 : -50,
      opacity: 0,
    }),
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Wizard panel */}
      <div className="relative w-full max-w-xl">
        <GlassPanel padding="p-0" className="overflow-hidden">
          {/* Progress bar */}
          <div className="px-6 pt-6">
            <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: brandConfig.primaryColor }}
                initial={{ width: 0 }}
                animate={{ width: `${progressPercentage}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
            <p className="text-white/60 text-xs mt-2 text-center">
              Step {currentProgressIndex + 1} of {progressSteps.length}
            </p>
          </div>

          {/* Step content */}
          <div className="px-6 py-6 min-h-[300px]">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={currentStep.id}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: 'tween', duration: 0.3, ease: 'easeOut' }}
              >
                <h2 className="text-xl font-semibold text-white mb-6 text-center">
                  {currentStep.title}
                </h2>
                {currentStep.component}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Navigation buttons */}
          <div className="px-6 pb-6 flex items-center justify-between gap-4">
            <PortalButton
              variant="secondary"
              onClick={handlePrevious}
              disabled={isFirstStep}
              className={isFirstStep ? 'opacity-0 pointer-events-none' : ''}
            >
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Previous
            </PortalButton>

            <PortalButton
              variant="primary"
              primaryColor={brandConfig.primaryColor}
              onClick={handleNext}
              isLoading={isSubmitting || isValidating}
              glow={isLastStep}
            >
              {isLastStep ? 'Complete' : 'Next'}
              {!isLastStep && (
                <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </PortalButton>
          </div>
        </GlassPanel>
      </div>
    </div>
  )
}
