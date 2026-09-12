import type { ExpoConfig, ConfigContext } from 'expo/config';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * App identity comes entirely from the environment (per EAS build profile).
 * The open-source core carries no brand or module values — a build without
 * configuration produces a generic shell for local development only.
 *
 * Capability-driven configuration: the registry generator writes
 * src/generated/capabilities.json (the union of baked modules'
 * requiredCapabilities). Only the plugins/permissions those capabilities
 * need are enabled, so e.g. a build with no camera-using module ships no
 * camera permission strings.
 */

function readCapabilities(): string[] {
  try {
    const p = resolve(__dirname, 'src/generated/capabilities.json');
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8')) as string[];
  } catch {
    // fall through — no capabilities
  }
  return [];
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const caps = new Set(readCapabilities());

  const name = process.env.APP_NAME || 'Gatewaze';
  const slug = process.env.APP_SLUG || 'gatewaze-app';
  const scheme = process.env.APP_SCHEME || 'gatewaze';
  const bundleId = process.env.APP_BUNDLE_ID || 'app.gatewaze.dev';

  const plugins: (string | [string, Record<string, unknown>])[] = [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    // Match the app's dark ground so launch does not flash white.
    [
      'expo-splash-screen',
      {
        backgroundColor: process.env.APP_SPLASH_COLOR || '#06080d',
        image: process.env.APP_ICON || './assets/icon.png',
        imageWidth: 180,
      },
    ],
  ];

  // HealthKit. The entitlement is only requested when a baked module asks
  // for it: an app with no health module must not ship a health entitlement,
  // because App Store review asks what it is for.
  if (caps.has('health')) {
    plugins.push([
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription:
          process.env.APP_HEALTH_READ_PERMISSION_TEXT ||
          'Reads your weight, activity and sleep from Apple Health so your coach can use them.',
        NSHealthUpdateUsageDescription:
          process.env.APP_HEALTH_WRITE_PERMISSION_TEXT ||
          'Writes the workouts and measurements you log here back to Apple Health.',
        // Needed for HKObserverQuery to wake the app when new samples land.
        // Without it the app only ever syncs while open.
        background: true,
      },
    ]);
  }

  if (caps.has('camera') || caps.has('barcode')) {
    plugins.push([
      'expo-camera',
      {
        cameraPermission:
          process.env.APP_CAMERA_PERMISSION_TEXT ||
          `Allow ${name} to use the camera to capture photos and scan barcodes.`,
      },
    ]);
  }
  if (caps.has('microphone')) {
    plugins.push([
      'expo-audio',
      {
        microphonePermission:
          process.env.APP_MICROPHONE_PERMISSION_TEXT ||
          `Allow ${name} to use the microphone so you can speak to the coach instead of typing.`,
      },
    ]);
  }
  // Notifications. Like HealthKit, the plugin is only added when a baked module
  // asks for it: an app with nothing to notify about must not ship a push
  // entitlement, because App Store review asks what it is for and there would be
  // no answer.
  if (caps.has('notifications')) {
    plugins.push([
      'expo-notifications',
      {
        // No custom icon or sound yet. Declared explicitly so the defaults are
        // a decision rather than an omission.
        enableBackgroundRemoteNotifications: false,
      },
    ]);
  }

  if (caps.has('image-picker')) {
    plugins.push([
      'expo-image-picker',
      {
        photosPermission:
          process.env.APP_PHOTOS_PERMISSION_TEXT ||
          `Allow ${name} to access your photo library so you can attach photos.`,
      },
    ]);
  }

  return {
    ...config,
    name,
    slug,
    scheme,
    version: process.env.APP_VERSION || '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    // The Gatewaze mark, on the dark ground the app uses. A brand builds
    // its own app by pointing APP_ICON at its own 1024x1024 opaque PNG.
    icon: process.env.APP_ICON || './assets/icon.png',
    newArchEnabled: true,
    ios: {
      bundleIdentifier: bundleId,
      supportsTablet: false,
      // Build number must rise with every upload. Apple reads
      // CFBundleVersion, which xcodebuild's CURRENT_PROJECT_VERSION does
      // not override in a managed Expo project, so set it here.
      buildNumber: process.env.APP_BUILD_NUMBER || '1',
      infoPlist: {
        // The app's only cryptography is HTTPS/TLS plus standard AES used
        // to protect the auth token at rest, both of which fall in Apple's
        // exempt categories. Declaring it here stops App Store Connect
        // asking on every upload.
        ITSAppUsesNonExemptEncryption: false,
      },
      ...(process.env.APP_APPLE_TEAM_ID
        ? { appleTeamId: process.env.APP_APPLE_TEAM_ID }
        : {}),
    },
    android: {
      package: bundleId,
    },
    plugins,
    experiments: { typedRoutes: false },
    extra: {
      router: {},
    },
  };
};
