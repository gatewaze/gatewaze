/**
 * The '@gatewaze/mobile' surface module mobile code imports — the mobile
 * twin of the admin's '@/components/ui' house kit. Everything a module
 * screen needs from the core comes through here; module code never
 * deep-imports core internals.
 */

// Component kit
export {
  Greeting,
  Title,
  CardTitle,
  Heading,
  Body,
  Label,
  Caption,
  Caps,
  Stat,
  Screen,
  Card,
  Row,
  Spacer,
  Button,
  Input,
  ListItem,
  Badge,
  ProgressBar,
  EmptyState,
  LoadingState,
} from './components/primitives';
export { Icon } from './components/Icon';
export { GlassPanel } from './components/GlassPanel';
export { ModeSurface, type ModeSurfaceProps } from './components/ModeSurface';
export { ImageCarousel, type ImageCarouselProps } from './components/ImageCarousel';
export { ChatBubble, SuggestionChip, Chip } from './components/ChatBubble';
export { Slider } from './components/Slider';
export { AmbientBackground } from './components/AmbientBackground';
export { Ring, type RingSegment } from './components/Ring';
export { DayStrip, type DayStripDay } from './components/DayStrip';

// Capability kit (imports of these still require the matching
// requiredCapabilities declaration — the generator audits usage)
export {
  CameraSurface,
  ScanFrame,
  CaptureButton,
  useCameraPermissions,
  type BarcodeScanningResult,
} from './capabilities/camera';
export { BarcodeScannerView } from './capabilities/barcode';
export {
  isAvailable as isHealthDataAvailable,
  requestPermissions as requestHealthPermissions,
  ownSourceBundleId,
  readChanged as readHealthChanged,
  readChangedCategory as readHealthChangedCategory,
  readDailyTotals as readHealthDailyTotals,
  readDailyTotalsBySource as readHealthDailyTotalsBySource,
  observe as observeHealth,
  stopObserving as stopObservingHealth,
  writeSample as writeHealthSample,
  writeWorkout as writeHealthWorkout,
  deleteWritten as deleteHealthWritten,
  formatDateInZone,
  startOfDayInZone,
  deviceTimeZone,
  type HealthSample,
  type HealthDailyTotal,
  type AnchoredResult,
} from './capabilities/health';
export {
  isAvailable as notificationsAvailable,
  requestPermission as requestNotificationPermission,
  hasPermission as hasNotificationPermission,
  pushToken as notificationPushToken,
  onNoticeTapped,
  handOffToCoach as handNoticeToCoach,
  type NoticePayload,
} from './capabilities/notifications';
export {
  pickFromLibrary,
  captureWithSystemCamera,
  normalisePhoto,
  appendImage,
  type PickedImage,
} from './capabilities/imagePicker';

// Hooks + helpers
export { useModuleContext, newClientRef, useCachedQuery, isApiFailure } from './hooks';
export { useSession } from './core/auth/session';
export { useChromeInsets, type ChromeInsets } from './core/chrome';
export {
  onRecordChange,
  announceRecord,
  type RecordEvent,
  type RecordKind,
} from './core/records';
// Re-exported so a module can refresh when its screen comes back into view
// without depending on the navigation library directly. Modules resolve
// `@gatewaze/mobile` and nothing else at build time.
export { useFocusEffect } from 'expo-router';
export { SlideOver } from './components/SlideOver';

// Theme
export {
  colors,
  darkColors,
  lightColors,
  useTheme,
  spacing,
  radius,
  bubbleRadius,
  type,
  fonts,
  easing,
  layout,
  motion,
  type Palette,
} from './theme/tokens';
