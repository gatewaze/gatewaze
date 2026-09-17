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
        // The launch screen is a frozen frame of the app's own ambient
        // mesh with the wordmark centred (assets/splash.png, rendered from
        // AmbientBackground's field specs — regenerate it if those change).
        // Launch screens must be static, so this is the mesh minus the
        // motion. The image is a 430pt-wide full-height frame: at that
        // imageWidth it covers every iPhone edge-to-edge, and the
        // backgroundColor is the app ground for any uncovered sliver.
        backgroundColor: process.env.APP_SPLASH_COLOR || '#090c14',
        image: process.env.APP_SPLASH_IMAGE || './assets/splash.png',
        imageWidth: 430,
      },
    ],
  ];

  // Full-bleed launch frame: only when a brand supplies one. The stock
  // splash plugin squares its image into a centred tile; this rewrites its
  // output during prebuild. UNSHIFTED, not pushed: dangerous mods run in
  // reverse insertion order, so being first in the array is what makes this
  // run AFTER expo-splash-screen has written the files it rewrites.
  // Android release signing. Inert without the keystore environment, so a
  // debug build and a CI prebuild are unaffected; see the plugin's header.
  plugins.push('./plugins/withAndroidUploadSigning');

  if (process.env.APP_SPLASH_IMAGE) {
    plugins.unshift(['./plugins/withFullBleedSplash', { image: process.env.APP_SPLASH_IMAGE }]);
  }

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
  // Notifications. Like HealthKit, added only when a baked module asks for it:
  // an app with nothing to notify about must not ship a push entitlement,
  // because App Store review asks what it is for and there is no answer.
  //
  // This was briefly behind an env flag, because the App Store provisioning
  // profile did not carry the Push Notifications capability and every archive
  // failed on the missing aps-environment entitlement. The App ID now has the
  // capability and the profile has been regenerated, so the flag is gone: a
  // build that silently omits push because an env var was unset is a worse
  // failure than one that stops.
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
    // The app icon, on the dark ground the app uses. A brand builds
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
      /**
       * Play orders builds by versionCode and refuses one it has already
       * seen. Without this every build ships versionCode 1 — the first
       * upload works, the second is rejected, and the message says nothing
       * about where the number comes from.
       *
       * Same source as the iOS build number so the two platforms stay
       * comparable, and an integer because Play requires one.
       */
      versionCode: Number(process.env.APP_BUILD_NUMBER) || 1,
      adaptiveIcon: process.env.APP_ICON
        ? { foregroundImage: process.env.APP_ICON, backgroundColor: '#090c14' }
        : undefined,
      edgeToEdgeEnabled: true,
    },
    plugins,
    experiments: { typedRoutes: false },
    extra: {
      router: {},
    },
  };
};
