'use client'

import type { BrandConfig } from '@/config/brand'
import { ProfileCompletionWizard } from './ProfileCompletionWizard'

interface Props {
  brandConfig: BrandConfig
}

/**
 * Client wrapper for ProfileCompletionWizard.
 * This component is used in the server-side layout to include the wizard.
 */
export function ProfileCompletionWrapper({ brandConfig }: Props) {
  return <ProfileCompletionWizard brandConfig={brandConfig} />
}
