# Android: building and getting a beta to testers

## What testers have to do

Testers do not need developer options, and there is no 24 hour wait. That is
the sideloading route, and it is not the one to use.

Use the Internal testing track in the Play Console. It does the same job as
TestFlight.

- Up to 100 testers. You invite them by email address, or by a link they open.
- They install from the Play Store app, the same as any other app. There is no
  developer mode, no "unknown sources" setting, and no warning screen.
- A build is live within minutes. Internal testing does not go through the
  review queue that holds up a production release.
- Updates reach them the same way any Play Store update does.

The waits people remember are real, but they apply elsewhere. The 14 day
closed testing requirement applies to a new personal developer account
publishing to production. Full app review applies to production. Internal
testing is exempt from both.

## What you need once, before any of this works

1. A Google Play developer account. It costs $25, paid once, at
   <https://play.google.com/console/signup>.

   This is a new publisher account for AutoDB Ltd. It is not the Apple
   account. That one belongs to the old company, Webkit Ltd, and is not being
   reused here, so the two stores have separate publishers and separate
   billing.

   Registering as an organisation rather than as a person avoids the 14 day
   rule later, but it needs a D-U-N-S number, which takes a few days to get. A
   personal account works immediately and is fine for internal testing. It
   only constrains production.

   The publisher name shown in the Play Store comes from this account. It does
   not come from the signing certificate.

2. Identity verification. Google verifies the account. This can take a day or
   two, and it is the one genuine wait in the process, so start it first.

3. The app itself, created in the console. Call it HELF, with the package name
   `you.helf.app`.

## The upload key

`~/Library/gatewaze/android/helf-upload.keystore` is the app's identity.
Anyone who holds it and its password can publish something that Android will
accept as an update to HELF.

The keystore and `signing.env` both sit outside the repo, and `signing.env` is
readable only by you. Neither is in git.

Back both of them up somewhere you will still have in five years. If you enrol
in Play App Signing on the first upload, which is the default and which you
should do, then Google holds the real signing key and this is only the upload
key. Losing the upload key is then recoverable, because you can ask Google to
reset it. Losing it without Play App Signing means you can never update the
app again.

The current key:

```
SHA256: FF:FD:72:42:0E:AD:CC:A8:72:08:91:3B:8E:05:CF:4A:46:23:A6:4C:34:ED:DE:5D:13:CF:54:31:14:71:F9:FC
Owner:  CN=HELF, OU=Mobile, O=AutoDB Ltd, L=London, C=GB
```

## Building a release

```bash
cd packages/mobile
set -a; . ~/Library/gatewaze/android/signing.env; set +a
. ~/Library/gatewaze/android/toolchain.env
./scripts/release-android.sh
```

The script prints the path of the finished `.aab`. It also copies it to
`~/Library/gatewaze/android/helf-<versionCode>.aab`.

The version code defaults to the commit count, which is the same rule iOS
uses. Play refuses a version code it has already seen, so pass
`APP_BUILD_NUMBER=<n>` to override it. That is also how you retry an upload
without making a commit.

The script refuses to start without a signing key. It checks the gradle file
before spending four minutes on a bundle, and it compares the finished
artifact's certificate against the keystore. That last check is there because
the failure it catches is invisible. Gradle's template falls back to the debug
keystore when the release config is missing, so the build succeeds and
produces something Play rejects at the end of the upload.

## Getting a build to testers

1. Open the Play Console, then HELF, then Testing, then Internal testing.
2. Choose Create new release, drop in the `.aab`, and save.
3. Open the Testers tab, create an email list, add their addresses, and save.
4. Choose Review release, then Start rollout to Internal testing.
5. Copy the join link from the Testers tab and send it to them. They open it,
   accept, and get a Play Store link to install from.

For later builds, repeat steps 1, 2 and 4. Testers get the update
automatically.

## The toolchain

The toolchain is installed outside the repo, so a clean checkout does not
carry 500 MB of Android SDK.

```
~/Library/Android/jdk-17.*/     Temurin JDK 17, arm64
~/Library/Android/sdk/          platform-tools, platforms;android-36, build-tools;36.0.0
~/Library/gatewaze/android/     keystore, signing.env, toolchain.env, built .aab files
```

`toolchain.env` sets `JAVA_HOME`, `ANDROID_HOME` and `PATH`. Source it in any
shell that runs a Gradle build.

It installs JDK 17 specifically. The two JDKs already on the machine were
version 18 and version 8, and both were Intel builds running under Rosetta.
React Native 0.83 wants 17, and an arm64 JDK builds a good deal faster on this
hardware.

## What does not work on Android yet

Apple Health does not exist on Android, and this is the only real gap.
`health-body-metrics` is the one module that needs it. The capability system
means an Android build can leave that module out. Nothing crashes if it is
included, because `capabilities/health.ts` reports the feature as unavailable
and the module checks before every call.

The Android equivalent is Health Connect. It is a different API, with its own
permission model and its own data types, so it is a project in itself rather
than a port.

Push notifications register but nothing sends them. The device table already
records whether a token is `apns` or `fcm`, it validates both, and the app
already returns an FCM token on Android. What is missing is the sending half,
which means an FCM sender alongside `health-notify/lib/apns.ts`, and a
Firebase project.

Haptics and message tones are switched off on Android. They degrade rather
than break, but the app is quieter there.

Liquid Glass is iOS 26 only. `GlassPanel` falls back to a solid themed fill,
which is correct in code, but no one has looked at it on a screen. Expect the
first Android build to need visual work, because the design leans hard on
translucency.

The status bar may still be worth a look. While the app was rendering in the
light palette it drew a pale strip with dark icons across the top, above its
own dark gradient. Forcing the dark palette fixed the palette bug, and the
strip has not been re-examined since on a real device, so it may already be
gone.

If it is not, two things are worth knowing. `react-native-edge-to-edge` is
installed and the generated theme is `Theme.EdgeToEdge`, and the theme sets a
transparent status bar colour, so both of those are already in place. That
library's `SystemBars` component is the API that can set the bar's appearance
on Android 15 and later, where the system ignores
`StatusBar.backgroundColor`. It was tried and reverted: its native module was
not registered by autolinking under pnpm, so the app crashed at launch with
"'RNEdgeToEdge' could not be found". Getting that autolinking working is the
next thing to try, not more theme XML.

## Running the emulator

```bash
. ~/Library/gatewaze/android/toolchain.env
emulator -avd helf-pixel &          # boots in about 30 seconds
adb wait-for-device

cd packages/mobile
adb reverse tcp:8081 tcp:8081       # so the emulator can reach Metro
npx expo start --dev-client &
(cd android && ./gradlew :app:assembleDebug)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n you.helf.app/.MainActivity
```

The AVD is a Pixel 7 on API 36, arm64, with 4 GB of RAM and an 8 GB data
partition. It is arm64 rather than x86, so it runs at native speed on this
hardware rather than emulating a different processor.

Two things that are not obvious. `adb reverse` is what lets the emulator
reach Metro on the Mac, and without it a debug build starts and exits with no
useful message. And `adb shell monkey` does not reliably launch this app, so
use `am start` with the explicit activity name.

Useful while developing:

```bash
adb logcat -d -t 400 | grep -iE "FATAL|AndroidRuntime|ReactNativeJS"
adb exec-out screencap -p > shot.png
adb shell am force-stop you.helf.app
```
