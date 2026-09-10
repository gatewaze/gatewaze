/**
 * Design tokens (coach rebrand, spec-mobile-coach-rebrand.md).
 *
 * Dark is the primary theme, so the exported `colors` are the dark values
 * and the app is pinned to dark in app.config.ts. The light palette is
 * defined here too, and `useTheme()` already returns the active one, so
 * unpinning to follow the system is a config change plus migrating
 * consumers from the static export to the hook. Module screens still on
 * the static export therefore keep working while they are restyled.
 *
 * Values are the design's semantic colors. Materials (glass, blur) are NOT
 * tokens: those come from the native component in components/GlassPanel,
 * which adapts to the system appearance on its own.
 */

import { useColorScheme } from 'react-native';

export interface Palette {
  /** Deepest ground, e.g. the drawer canvas behind the app surface. */
  void: string;
  background: string;
  surface: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  sectionLabel: string;
  /** Primary action color ("Coach Blue"). */
  accent: string;
  /** Text/icon color on top of an accent fill. */
  onAccent: string;
  accentSoft: string;
  accentCaps: string;
  /** The coach's voice, success, an active session ("Vital Teal"). */
  coach: string;
  /** Ambient washes, and the second chart series ("Calm Purple"). */
  ambient: string;
  /** Recording, alerts, destructive ("Signal Coral"). */
  danger: string;
  success: string;
  warning: string;
  /** Chart series, in order. A module decides what each one means. */
  series1: string;
  series2: string;
  series3: string;
  /** Chat bubbles. */
  bubbleMember: string;
  bubbleCoach: string;
  bubbleBorderMember: string;
  bubbleBorderCoach: string;
  /** The coach bubble's border at the peak of a heartbeat. */
  bubbleGlowCoach: string;
  /** Inverted surface: the active mode pill and white primary buttons. */
  invert: string;
  onInvert: string;
  /** The composer's control fill and hairline, per the design system. */
  controlFill: string;
  controlBorder: string;
  /**
   * The colour the header fade resolves to. The design specifies its own
   * value here rather than reusing `background`, so it is kept separate.
   */
  headerScrim: string;
}

export const darkColors: Palette = {
  void: '#06080d',
  background: '#090c14',
  surface: 'rgba(255,255,255,0.16)',
  border: 'rgba(255,255,255,0.16)',
  text: '#eef1f6',
  textSecondary: '#c3cde0',
  textMuted: '#9fadc4',
  sectionLabel: '#7c8aa3',
  accent: '#6ea8ff',
  onAccent: '#0a1020',
  accentSoft: 'rgba(110,168,255,0.18)',
  accentCaps: '#a8c8ff',
  coach: '#63d9a0',
  ambient: '#a98be8',
  danger: '#ff6470',
  success: '#63d9a0',
  warning: '#f0b45a',
  series1: '#5fc3e8',
  series2: '#a98be8',
  series3: '#f0b45a',
  bubbleMember: 'rgba(110,168,255,0.42)',
  bubbleCoach: 'rgba(99,217,160,0.26)',
  bubbleBorderMember: 'rgba(110,168,255,0.35)',
  bubbleBorderCoach: 'rgba(99,217,160,0.28)',
  bubbleGlowCoach: 'rgba(99,217,160,0.36)',
  invert: '#ffffff',
  onInvert: '#0a1020',
  controlFill: 'rgba(255,255,255,0.14)',
  controlBorder: 'rgba(255,255,255,0.16)',
  headerScrim: '#0a101c',
};

export const lightColors: Palette = {
  void: '#e8ecf3',
  background: '#f6f8fb',
  surface: 'rgba(255,255,255,0.90)',
  border: 'rgba(16,21,28,0.10)',
  text: '#10151c',
  textSecondary: '#42506b',
  textMuted: '#8a94a3',
  sectionLabel: '#8a94a3',
  accent: '#2563d9',
  onAccent: '#ffffff',
  accentSoft: 'rgba(37,99,217,0.12)',
  accentCaps: '#2563d9',
  coach: '#178457',
  ambient: '#7b5bc4',
  danger: '#c8323f',
  success: '#178457',
  warning: '#a86a12',
  series1: '#2b8fb8',
  series2: '#7b5bc4',
  series3: '#a86a12',
  bubbleMember: '#2563d9',
  bubbleCoach: 'rgba(23,132,87,0.20)',
  bubbleBorderMember: '#2563d9',
  bubbleBorderCoach: 'rgba(23,132,87,0.28)',
  bubbleGlowCoach: 'rgba(23,132,87,0.32)',
  invert: '#10151c',
  onInvert: '#ffffff',
  controlFill: 'rgba(20,40,70,0.12)',
  controlBorder: 'rgba(20,40,70,0.14)',
  headerScrim: '#f6f8fb',
};

/** Dark is primary; the static export is what unmigrated screens import. */
export const colors: Palette = darkColors;

/** Theme-aware palette for core components and restyled module screens. */
export function useTheme(): Palette {
  const scheme = useColorScheme();
  return scheme === 'light' ? lightColors : darkColors;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  /** Micro controls, e.g. an in-card swap button. */
  xs: 7,
  /** In-card buttons. */
  sm: 11,
  md: 14,
  /** Cards. */
  lg: 16,
  /** Chat bubbles (see bubbleRadius for the asymmetric forms). */
  bubble: 18,
  /** Sheets and modals. */
  sheet: 20,
  /** The composer panel and the drawer reveal. */
  composer: 34,
  full: 999,
};

/** Asymmetric bubble corners: the tail corner tightens to 4. */
export const bubbleRadius = {
  coach: { borderRadius: 18, borderBottomLeftRadius: 4 },
  member: { borderRadius: 18, borderBottomRightRadius: 4 },
};

/**
 * Type scale. `display` uses Bricolage Grotesque (loaded at app start);
 * everything else uses the system stack, which is what the design
 * specifies for body copy.
 */
export const fonts = {
  display: 'BricolageGrotesque_700Bold',
};

export const type = {
  greeting: { fontSize: 34, lineHeight: 37, fontFamily: fonts.display, letterSpacing: -0.34 },
  title: { fontSize: 24, fontFamily: fonts.display },
  cardTitle: { fontSize: 19, fontFamily: fonts.display },
  heading: { fontSize: 20, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  chat: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  label: { fontSize: 14, fontWeight: '500' as const },
  button: { fontSize: 14, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  caps: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.77 },
  stat: { fontSize: 17, fontWeight: '700' as const },
};

/** One easing token for every animation in the app. */
export const easing = { x1: 0.32, y1: 0.72, x2: 0, y2: 1 };

export const motion = {
  /** Message entry, composer expand. */
  standard: 450,
  /** Drawer reveal. */
  drawer: 420,
  /** Mode-pill morph. */
  quick: 300,
  /**
   * The still gap between one coach lub-dub and the next.
   *
   * Only the gap is a token. The lub-dub itself is a fixed length in
   * ChatBubble, because the two need to vary independently: the beats stay
   * quick, and the calm comes from a long gap between them.
   */
  heartbeatRest: 1080,
};

/**
 * Fixed layout geometry. Anything that depends on the chrome's MEASURED size
 * is not here: a surface asks `useChromeInsets()` for that, because a fixed
 * guess went stale the moment the composer became a floating panel whose
 * height follows its content.
 */
export const layout = {
  /**
   * Header geometry. From the design's `padding: 64px 22px 18px` over
   * `linear-gradient(180deg, .97 0%, .85 55%, 0 100%)`, where the 64px top
   * is the status bar and becomes the safe-area inset at runtime.
   *
   * The design's 18px bottom padding is widened here so the fade has room
   * to reach zero cleanly. The scrim holds solid only across the top third
   * of the button row: enough to keep the buttons legible, while the
   * remainder stays sheer so message text is still readable through it.
   */
  headerTopGap: 6,
  headerButton: 36,
  headerFadeDrop: 28,
  /** How much of the button row sits on the solid part of the scrim. */
  headerSolidFraction: 1 / 3,
  headerPaddingH: 22,
  headerFadeStops: [0.97, 0.85, 0] as const,
  /** Gap between the composer and the screen edges. */
  composerMargin: 12,
  /**
   * The composer floats over the thread with its own fade, mirroring the
   * header. From the design's `padding: 26px 12px 10px` over
   * `linear-gradient(0deg, rgba(9,12,20,.97) 0%, .8 55%, 0 100%)`. CSS 0deg
   * runs bottom to top, so read against the top-down order used here the
   * stops are 0 at the top and .97 at the bottom.
   */
  composerPadTop: 26,
  composerPadBottom: 10,
  composerFadeStops: [0, 0.8, 0.97] as const,
  composerFadeLocations: [0, 0.45, 1] as const,
};

/**
 * Total height of the floating header for a given top safe-area inset, and
 * the fade's middle stop as a fraction of it. The middle stop sits a third
 * of the way down the button row, so the buttons keep a solid ground under
 * their tops while the thread stays visible through the rest.
 */
export function headerHeight(topInset: number): number {
  return topInset + layout.headerTopGap + layout.headerButton + layout.headerFadeDrop;
}

export function headerFadeLocations(topInset: number): [number, number, number] {
  const total = headerHeight(topInset);
  const solidTo =
    topInset + layout.headerTopGap + layout.headerButton * layout.headerSolidFraction;
  return [0, solidTo / total, 1];
}

/** Drawer reveal geometry (the active surface slides right and scales). */
export const drawer = {
  slide: 295,
  scale: 0.93,
  radius: radius.composer,
};
