'use client'

import type { BrandConfig } from '@/config/brand'
import { ProfileCompletionWizard } from './ProfileCompletionWizard'

interface Props {
  brandConfig: BrandConfig
  /** Whether the `lists` module is enabled — gates the Communication Preferences step. */
  listsEnabled?: boolean
}

/**
 * Client wrapper for ProfileCompletionWizard.
 * This component is used in the server-side layout to include the wizard.
 */
export function ProfileCompletionWrapper({ brandConfig, listsEnabled = false }: Props) {
  return <ProfileCompletionWizard brandConfig={brandConfig} listsEnabled={listsEnabled} />
}
