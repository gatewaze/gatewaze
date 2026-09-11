/**
 * The icon abstraction: SF Symbols on iOS, MaterialCommunityIcons
 * elsewhere (spec-mobile-coach-rebrand.md, native-first).
 *
 * Modules name icons in their manifests. Names already in use are
 * MaterialCommunityIcons names, so those keep working and are mapped to
 * the closest SF Symbol here. An unmapped name falls back to
 * MaterialCommunityIcons on every platform, so a module can never render
 * a blank square.
 */

import React from 'react';
import { Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';
import { DesignIcon, isDesignIcon } from './DesignIcons';
import { useTheme } from '../theme/tokens';

/** MaterialCommunityIcons name → SF Symbol name. */
const SF_SYMBOLS: Record<string, string> = {
  // Module destinations
  creation: 'sparkles',
  dumbbell: 'figure.strengthtraining.traditional',
  'silverware-fork-knife': 'fork.knife',
  'scale-bathroom': 'scalemass',
  'account-circle-outline': 'person.crop.circle',
  'calendar-check': 'calendar',
  pill: 'pills',
  // Chrome
  menu: 'line.3.horizontal',
  close: 'xmark',
  'chevron-right': 'chevron.right',
  'chevron-down': 'chevron.down',
  'arrow-left': 'chevron.backward',
  'cog-outline': 'gearshape',
  plus: 'plus',
  check: 'checkmark',
  send: 'arrow.up.circle.fill',
  microphone: 'mic',
  // Shown in place of the mic while a voice note is being recorded.
  stop: 'stop',
  camera: 'camera',
  barcode: 'barcode.viewfinder',
  magnify: 'magnifyingglass',
  image: 'photo',
  'message-outline': 'bubble.left',
  'message-plus-outline': 'square.and.pencil',
  history: 'clock.arrow.circlepath',
  flash: 'bolt.fill',
  'flash-off': 'bolt.slash',
  delete: 'trash',
  'trash-can-outline': 'trash',
  pencil: 'pencil',
  'swap-horizontal': 'arrow.left.arrow.right',
  'sync-alert': 'arrow.triangle.2.circlepath',
  stethoscope: 'stethoscope',
  logout: 'rectangle.portrait.and.arrow.right',
  'delete-forever-outline': 'trash.slash',
  'lock-outline': 'lock',
  'alert-circle-outline': 'exclamationmark.circle',
  'check-circle-outline': 'checkmark.circle',
  'account-question-outline': 'person.fill.questionmark',
  'camera-off': 'camera.fill',
  tray: 'tray',
  'camera-outline': 'camera',
  'calendar-check-outline': 'calendar',
  'share-variant-outline': 'square.and.arrow.up',
  'watch-variant': 'applewatch',
  'account-multiple-outline': 'person.2',
  'account-outline': 'person',
  'scale-bathroom-outline': 'scalemass',
  'link-variant': 'link',
  'link-off': 'link.badge.plus',
  information: 'info.circle',
  'information-outline': 'info.circle',
  'chart-line': 'chart.xyaxis.line',
  'food-apple-outline': 'carrot',
  'silverware-fork-knife-outline': 'fork.knife',
  'clock-outline': 'clock',
  'bell-outline': 'bell',
  'shield-check-outline': 'checkmark.shield',
};

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 24, color }: IconProps) {
  const theme = useTheme();
  const tint = color ?? theme.text;

  // Where the design specifies its own mark, draw that rather than a
  // platform icon — no SF Symbol matches these.
  if (isDesignIcon(name)) return <DesignIcon name={name} size={size} color={tint} />;

  const symbol = SF_SYMBOLS[name];

  if (Platform.OS === 'ios' && symbol) {
    return (
      <SymbolView
        name={symbol as never}
        size={size}
        tintColor={tint}
        resizeMode="scaleAspectFit"
        fallback={<MaterialCommunityIcons name={name as never} size={size} color={tint} />}
      />
    );
  }
  return <MaterialCommunityIcons name={name as never} size={size} color={tint} />;
}
