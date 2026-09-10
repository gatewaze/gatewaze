/**
 * The core component kit — the native UI primitives module screens are
 * built from, so screens from different module repos look like one app.
 *
 * Theme-aware since the coach rebrand: components read the active palette
 * with useTheme(). The exported API is unchanged, so module screens keep
 * working while they are restyled.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  RefreshControl,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { GlassPanel } from './GlassPanel';
import { useHeaderHeight } from '@react-navigation/elements';
import { useChromeInsets } from '../core/chrome';
import { AmbientBackground } from './AmbientBackground';
import { useTheme, radius, spacing, type } from '../theme/tokens';

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function useTextStyle(base: TextStyle, muted?: 'secondary' | 'muted'): TextStyle {
  const theme = useTheme();
  const color =
    muted === 'secondary' ? theme.textSecondary : muted === 'muted' ? theme.textMuted : theme.text;
  return { ...base, color };
}

export function Greeting({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <RNText style={[useTextStyle(type.greeting), style]}>{children}</RNText>;
}
export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <RNText style={[useTextStyle(type.title), style]}>{children}</RNText>;
}
export function CardTitle({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <RNText style={[useTextStyle(type.cardTitle), style]}>{children}</RNText>;
}
export function Heading({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <RNText style={[useTextStyle(type.heading), style]}>{children}</RNText>;
}
export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <RNText style={[useTextStyle(type.body), style]}>{children}</RNText>;
}
export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <RNText style={[useTextStyle(type.label, 'secondary'), style]}>{children}</RNText>;
}
export function Caption({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <RNText style={[useTextStyle(type.caption, 'muted'), style]}>{children}</RNText>;
}
export function Caps({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return (
    <RNText style={[type.caps, { color: theme.sectionLabel, textTransform: 'uppercase' }, style]}>
      {children}
    </RNText>
  );
}
export function Stat({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <RNText style={[useTextStyle(type.stat), style]}>{children}</RNText>;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  padded = true,
  onRefresh,
  refreshing = false,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Pull-to-refresh handler. MUST bypass caches per the offline model. */
  onRefresh?: () => void;
  refreshing?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  // The screen is transparent so the app's living gradient, which is drawn
  // once behind the whole stack, shows through every screen.
  //
  // A transparent header does not inset its screen, so content starts under
  // it. Padding by the header's height puts the first item below it while
  // still letting the rest scroll underneath and fade. With no header (a
  // drawer destination) this is 0 and the safe-area edge applies instead.
  const headerHeight = useHeaderHeight();
  const chrome = useChromeInsets();
  // Two kinds of chrome, never both. A pushed route has a native header; a
  // drawer destination has the app's floating one, whose height arrives
  // through the chrome context. Either way the padding goes on the SCROLL
  // CONTENT, so content passes under the chrome and fades, instead of being
  // clipped at the edge of a padded container.
  const topInset = headerHeight > 0 ? headerHeight : chrome.top;
  // The composer bar floats over drawer destinations, so the last row of a
  // list has to be able to scroll clear of it.
  const bottomInset = chrome.bottom;
  const edges: Array<'top'> = topInset > 0 ? [] : ['top'];
  const inner = padded ? [styles.padded, style] : style;
  // `styles.padded` sets `padding`, so an inset placed before it is silently
  // overridden. These go last, and carry the padded value forward so the
  // content still has its own breathing room.
  const insetStyle = {
    paddingTop: topInset + (padded ? spacing.lg : 0),
    paddingBottom: bottomInset + (padded ? spacing.lg : 0),
  };
  // A pushed route paints its own ground, since the stack is opaque and the
  // gradient would otherwise stop at the coach route.
  const ambient = headerHeight > 0 ? <AmbientBackground /> : null;
  if (!scroll) {
    return (
      <SafeAreaView style={styles.fill} edges={edges}>
        {ambient}
        <View style={[styles.fill, inner, insetStyle]}>{children}</View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.fill} edges={edges}>
      {ambient}
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[inner, insetStyle]}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textMuted} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  onPress,
  glass = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Glass by default; pass false for an opaque card. */
  glass?: boolean;
}) {
  const theme = useTheme();
  const inner = <View style={styles.cardInner}>{children}</View>;
  const body = glass ? (
    <GlassPanel radius={radius.lg} style={style}>
      {inner}
    </GlassPanel>
  ) : (
    <View
      style={[
        { backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
        style,
      ]}
    >
      {inner}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.pressed : undefined)}>
      {body}
    </Pressable>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Spacer({ size = spacing.lg }: { size?: number }) {
  return <View style={{ height: size }} />;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  /** primary = accent fill, coach = teal (session actions), secondary =
   *  soft accent, danger, ghost = text only. */
  variant?: 'primary' | 'coach' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const bg =
    variant === 'primary' ? theme.accent
    : variant === 'coach' ? theme.coach
    : variant === 'danger' ? theme.danger
    : variant === 'secondary' ? theme.accentSoft
    : 'transparent';
  const fg =
    variant === 'primary' || variant === 'coach' ? theme.onAccent
    : variant === 'danger' ? '#fff'
    : theme.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Row style={{ gap: spacing.sm }}>
          {icon ? <Icon name={icon} size={18} color={fg} /> : null}
          <RNText style={[type.button, { color: fg, fontSize: 15 }]}>{title}</RNText>
        </Row>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string }) {
  const theme = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

export function ListItem({
  title,
  subtitle,
  below,
  right,
  leading,
  icon,
  onPress,
  destructive = false,
}: {
  title: string;
  subtitle?: string;
  /**
   * Rendered before the text, in place of `icon`. For a picture rather than a
   * glyph, such as an exercise thumbnail.
   */
  leading?: React.ReactNode;
  /**
   * Rendered under the subtitle, for detail a string cannot carry, such as a
   * row of coloured value indicators.
   */
  below?: React.ReactNode;
  right?: React.ReactNode;
  icon?: string;
  onPress?: () => void;
  destructive?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.listItem,
        { backgroundColor: theme.surface, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
    >
      {leading ??
        (icon ? (
          <Icon name={icon} size={22} color={destructive ? theme.danger : theme.textSecondary} />
        ) : null)}
      <View style={styles.fill}>
        <RNText style={[type.body, { color: destructive ? theme.danger : theme.text }]}>{title}</RNText>
        {subtitle ? <Caption>{subtitle}</Caption> : null}
        {below}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" size={20} color={theme.textMuted} /> : null)}
    </Pressable>
  );
}

/**
 * A translucent fill of `color`. Handles hex and rgb()/rgba() inputs —
 * naive hex concatenation breaks on the palette's rgba() values, which is
 * most of the dark theme's surfaces.
 */
export function withAlpha(color: string, alpha: number): string {
  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((n) => n.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const hex = color.replace('#', '');
  if (hex.length === 3 || hex.length === 6 || hex.length === 8) {
    const full =
      hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if (![r, g, b].some(Number.isNaN)) return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

export function Badge({ label, color }: { label: string; color?: string }) {
  const theme = useTheme();
  const c = color ?? theme.coach;
  return (
    <View style={[styles.badge, { backgroundColor: withAlpha(c, 0.16) }]}>
      <RNText style={{ color: c, fontSize: 12, fontWeight: '600' }}>{label}</RNText>
    </View>
  );
}

export function ProgressBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const theme = useTheme();
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
      <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color ?? theme.accent }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function EmptyState({
  icon = 'tray',
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={40} color={theme.textMuted} />
      <Heading style={{ textAlign: 'center' }}>{title}</Heading>
      {body ? <Body style={{ textAlign: 'center', color: theme.textSecondary }}>{body}</Body> : null}
      {action}
    </View>
  );
}

export function LoadingState() {
  const theme = useTheme();
  return (
    <View style={[styles.empty, { backgroundColor: theme.background }]}>
      <ActivityIndicator size="large" color={theme.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  padded: { padding: spacing.lg, gap: spacing.md },
  cardInner: { padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  pressed: { opacity: 0.7 },
  button: {
    borderRadius: radius.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    fontSize: 16,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  progressTrack: { height: 8, borderRadius: radius.full, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: radius.full },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
});
