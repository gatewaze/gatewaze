import React from 'react';
import './LoadingSpinner.css';
import { getBrandConfig } from '../../config/brands';

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

  return (
    <div
      className={`loader ${sizeClass}`}
      style={{
        '--primary-color': finalPrimaryColor,
        '--secondary-color': finalSecondaryColor
      } as React.CSSProperties}
    />
  );
};

export default LoadingSpinner;
