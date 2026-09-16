/**
 * The core component kit — the native UI primitives module screens are
 * built from, so screens from different module repos look like one app.
 *
 * Theme-aware since the coach rebrand: components read the active palette
 * with useTheme(). The exported API is unchanged, so module screens keep
 * working while they are restyled.
 */

import React, { useState } from 'react';
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
  type TextProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { usePressScale } from './usePressScale';
import Animated, { FadeInDown, LinearTransition, ReduceMotion } from 'react-native-reanimated';

/** Pressable that can take an animated style. */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The app-wide "state changed" motion. Anything whose size or position
 * changes in place — a card growing an edit form, a row appearing — glides
 * there instead of jumping. One curve everywhere, so the app moves as one
 * thing. Opted out of Reduce Motion for the same reason the press-scale is:
 * this is feedback about what just happened, not decoration, and with the
 * setting on it would jump exactly as before.
 */
export const STATE_CHANGE = LinearTransition.duration(220).reduceMotion(ReduceMotion.Never);

/**
 * Kit wrapper for "this block just appeared": fades and settles downward.
 * Module code cannot import reanimated directly (the dependency allowlist),
 * so revealed state — an edit form expanding, an option row arriving — goes
 * through this instead. Same Reduce Motion stance as STATE_CHANGE.
 */
export function Reveal({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View
      entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.Never)}
      layout={STATE_CHANGE}
      style={style}
    >
      {children}
    </Animated.View>
  );
}
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
export function Title({ children, style, ...rest }: TextProps & { children: React.ReactNode }) {
  return <RNText {...rest} style={[useTextStyle(type.title), style]}>{children}</RNText>;
}
export function CardTitle({ children, style, ...rest }: TextProps & { children: React.ReactNode }) {
  return <RNText {...rest} style={[useTextStyle(type.cardTitle), style]}>{children}</RNText>;
}
export function Heading({ children, style, ...rest }: TextProps & { children: React.ReactNode }) {
  return <RNText {...rest} style={[useTextStyle(type.heading), style]}>{children}</RNText>;
}
export function Body({ children, style, ...rest }: TextProps & { children: React.ReactNode }) {
  return <RNText {...rest} style={[useTextStyle(type.body), style]}>{children}</RNText>;
}
export function Label({ children, style, ...rest }: TextProps & { children: React.ReactNode }) {
  return <RNText {...rest} style={[useTextStyle(type.label, 'secondary'), style]}>{children}</RNText>;
}
export function Caption({ children, style, ...rest }: TextProps & { children: React.ReactNode }) {
  return <RNText {...rest} style={[useTextStyle(type.caption, 'muted'), style]}>{children}</RNText>;
}
export function Caps({ children, style, ...rest }: TextProps & { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <RNText {...rest} style={[type.caps, { color: theme.sectionLabel, textTransform: 'uppercase' }, style]}>
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

/**
 * How much background colour a glass card lays over the material.
 *
 * Glass with nothing behind it is a window, not a surface. Liquid Glass is a
 * material that refracts what is behind it, so over a dark photographic
 * gradient a card with no wash puts light text on whatever happens to be
 * there — which in the thread meant a food card's names and numbers sitting
 * directly on the wallpaper with no backing at all.
 *
 * Higher than the composer's 0.45 because a card carries dense content that
 * has to be read and compared: a product name, a brand, a weight, a calorie
 * figure and three macros, several of those stacked. The composer holds one
 * line of text the member is actively typing and can afford to be lighter.
 */
const CARD_TINT = 0.6;

export function Card({
  children,
  style,
  onPress,
  glass = true,
  tint = CARD_TINT,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Glass by default; pass false for an opaque card. */
  glass?: boolean;
  /** Override the wash laid over the glass, 0 to 1. */
  tint?: number;
}) {
  const theme = useTheme();
  const inner = <View style={styles.cardInner}>{children}</View>;
  const body = glass ? (
    <GlassPanel radius={radius.lg} style={style} tint={tint}>
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
  // Every card glides when its content grows or shrinks — expanding an edit
  // form, a row arriving — rather than snapping to the new size.
  const animated = <Animated.View layout={STATE_CHANGE}>{body}</Animated.View>;
  if (!onPress) return animated;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.pressed : undefined)}>
      {animated}
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
  compact = false,
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
  /** Row-of-links form: tighter padding, smaller type and icon, so three can
   *  share one row without spilling off the screen. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  /**
   * Primary and secondary moved off the accent fills: once the mesh
   * background brightened, accent and accentSoft read as pale lilac pills
   * floating on it. Dark glass with a light edge and white text reads on any
   * patch of the mesh. Coach (green) and danger keep their meanings.
   */
  const bg =
    variant === 'primary' ? theme.buttonFill
    : variant === 'coach' ? theme.coach
    : variant === 'danger' ? theme.danger
    : variant === 'secondary' ? theme.buttonFillSoft
    : 'transparent';
  const fg =
    variant === 'coach' ? theme.onAccent
    : variant === 'danger' ? '#fff'
    /* Ghost text was accent-tinted, which read as lilac links scattered over
       the brightened mesh. Ghost buttons now speak in the same white ink as
       the filled buttons; weight and the leading icon carry tappability. */
    : theme.buttonText;
  const edge =
    variant === 'primary' || variant === 'secondary'
      ? { borderWidth: 1, borderColor: theme.buttonBorder }
      : null;
  // Grows while held, matching the platform. The dim on press stays: on a
  // ghost button there is no fill to see the scale against, so opacity is
  // what actually reads there.
  const press = usePressScale(1.03);
  /**
   * Pressed, in React state rather than Pressable's style-function.
   *
   * The two cannot be combined: an AnimatedPressable resolves ANIMATED styles,
   * and Pressable's function-style form returns a fresh array per render that
   * Reanimated does not process — so the whole array was dropped and every
   * Button in the app rendered with no fill, no colour, no shape. The styling
   * "disappeared" the moment the scale was added. A static array is the form
   * both systems agree on, and the press state the scale already tracks drives
   * the dim as well.
   */
  const [held, setHeld] = useState(false);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => { press.onPressIn(); setHeld(true); }}
      onPressOut={() => { press.onPressOut(); setHeld(false); }}
      disabled={disabled || loading}
      style={[
        styles.button,
        compact ? styles.buttonCompact : null,
        { backgroundColor: bg, opacity: disabled ? 0.4 : held ? 0.85 : 1 },
        // `edge` was computed and silently unused for a few builds — the
        // dark buttons shipped without their white border. Keep it in the
        // array, before the caller's style so a screen can still override.
        edge,
        style,
        press.style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Row style={{ gap: compact ? spacing.xs : spacing.sm }}>
          {icon ? <Icon name={icon} size={compact ? 15 : 18} color={fg} /> : null}
          <RNText style={[type.button, { color: fg, fontSize: compact ? 13 : 15 }]}>{title}</RNText>
        </Row>
      )}
    </AnimatedPressable>
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
  buttonCompact: {
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
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
