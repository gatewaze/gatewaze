import {
  ListBulletIcon,
  MicrophoneIcon,
  BuildingOfficeIcon,
  TrophyIcon,
  TicketIcon,
  HeartIcon,
  SwatchIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  ChatBubbleLeftRightIcon,
  PhotoIcon,
  SignalIcon,
  CubeTransparentIcon,
  EnvelopeIcon,
  PlayCircleIcon,
  ShieldCheckIcon,
  PresentationChartBarIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType } from 'react';

const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  ListBulletIcon,
  MicrophoneIcon,
  BuildingOfficeIcon,
  TrophyIcon,
  TicketIcon,
  HeartIcon,
  SwatchIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  ChatBubbleLeftRightIcon,
  PhotoIcon,
  SignalIcon,
  EnvelopeIcon,
  PlayCircleIcon,
  ShieldCheckIcon,
  PresentationChartBarIcon,
  VideoCameraIcon,
};

/**
 * Resolve a Heroicon component by name string.
 * Used by module slot metadata to reference icons without bundling them.
 */
export function resolveHeroIcon(name: string | undefined): ComponentType<{ className?: string }> {
  if (!name) return CubeTransparentIcon;
  return ICON_MAP[name] ?? CubeTransparentIcon;
}
