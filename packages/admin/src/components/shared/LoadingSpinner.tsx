import React, { useState } from 'react';
import './LoadingSpinner.css';
import { getBrandConfig } from '../../config/brands';
import { HostIndicator } from '@/components/ui/Spinner/HostIndicator';
import { getHostLoadingIndicator } from '@/embed/hostLoadingIndicator';

interface LoadingSpinnerProps {
  size?: 'xs' | 'sm' | 'small' | 'medium' | 'large';
  primaryColor?: string;
  secondaryColor?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'medium',
  primaryColor,
  secondaryColor
}) => {
  const brandConfig = getBrandConfig();
  // Use brand colors by default - primaryColor for main spinner, secondaryColor for accent
  const finalPrimaryColor = primaryColor || brandConfig.ui.primaryColor || '#ca2b7f';
  const finalSecondaryColor = secondaryColor || brandConfig.ui.secondaryColor || '#4086c6';
  const sizeClass = `loader-${size}`;
  // Embedded with GwHostContext.loadingIndicator, the page-level sizes show
  // the host's spinner in the same box, so a page's loading state matches the
  // host's and the embed's route and permission spinners (PageLoadingSpinner).
  // xs and sm sit inline in buttons and rows and keep the embed's own loader.
  // Read once per mount: the factory only changes on unmount.
  const [hostFactory] = useState(getHostLoadingIndicator);
  const loader = (
    <div
      className={`loader ${sizeClass}`}
      style={{
        '--primary-color': finalPrimaryColor,
        '--secondary-color': finalSecondaryColor
      } as React.CSSProperties}
    />
  );
  if (!hostFactory || size === 'xs' || size === 'sm') return loader;
  return (
    <div className={`gw-loader-host ${sizeClass}`} role="status" aria-live="polite">
      <HostIndicator factory={hostFactory} fallback={loader} />
      <span className="sr-only">Loading</span>
    </div>
  );
};

export default LoadingSpinner;
