# Android: building and getting a beta to testers

## The short answer on testers

**They do not need developer options, and there is no 24-hour wait.** That is
the sideloading route, and it is not the one to use.

Use the Play Console's **Internal testing** track. It is the direct equivalent
of TestFlight:

- Up to **100 testers**, invited by email address or by a shareable opt-in link.
- Testers install from the **Play Store app** like any other app. No developer
  mode, no "unknown sources", no warnings.
- Builds appear in **minutes**. Internal testing is not subject to the review
  queue that gates production releases.
- Updates arrive the same way any Play Store update does.

The waits people remember are real but belong elsewhere: the 14-day closed
testing requirement applies to **new personal developer accounts publishing to
production**, and full app review applies to **production**. Internal testing
is exempt from both.

## What you need once, before any of this works

1. **A Google Play Developer account** — $25, paid once, at
   <https://play.google.com/console/signup>. Registering as an **organisation**
   (Webkit Ltd) rather than a personal account avoids the 14-day/12-tester
   production rule later, but needs a D-U-N-S number, which takes a few days to
   obtain. A personal account works immediately and is fine for internal
   testing; it only constrains production.
2. **Identity verification.** Google verifies the account. This can take a day
   or two, and is the one genuine wait in the process. Start it first.
3. **Create the app** in the console: HELF, package `you.helf.app`.

## The upload key, and why it matters more than it looks

`~/Library/gatewaze/android/helf-upload.keystore` is the app's identity. Anyone
holding it and its password can publish something Android will accept as an
update to HELF.

- The keystore and `signing.env` (0600) are **outside the repo** and are not in
  git.
- **Back both up somewhere you will still have in five years.** If you enrol in
  Play App Signing when you first upload — do, it is the default — Google holds
  the real app signing key and this is only the *upload* key, so losing it is
  recoverable by asking Google to reset it. Losing it *without* Play App
  Signing means you can never update the app again.

Current fingerprint:

```
SHA256: C3:82:60:BC:E3:D7:D7:24:EA:CF:DB:84:56:00:44:E5:CF:B8:C2:6C:F1:EC:CC:1C:D6:AA:15:FF:04:AA:8B:BF
Owner:  CN=HELF, OU=Mobile, O=Webkit Ltd, L=London, C=GB
```

## Building a release

```bash
cd packages/mobile
set -a; . ~/Library/gatewaze/android/signing.env; set +a
. ~/Library/gatewaze/android/toolchain.env
./scripts/release-android.sh
```

It prints the path of the finished `.aab` (also copied to
`~/Library/gatewaze/android/helf-<versionCode>.aab`).

`versionCode` defaults to the commit count, the same rule iOS uses. Play
refuses a version code it has already seen, so pass `APP_BUILD_NUMBER=<n>` to
override — which is also how you retry an upload without making a commit.

The script refuses to start without a signing key, checks the gradle file
before spending four minutes on a bundle, and verifies the finished artifact's
certificate against the keystore. That last check exists because the failure it
catches is invisible: Gradle's template falls back to the **debug** keystore
when the release config is missing, so the build succeeds and produces
something Play rejects at the end of the upload.

## Getting it to testers

1. Play Console → **HELF** → **Testing** → **Internal testing**.
2. **Create new release** → drop in the `.aab` → **Save**.
3. **Testers** tab → create an email list → add their addresses → **Save**.
4. **Review release** → **Start rollout to Internal testing**.
5. Copy the **join link** from the Testers tab and send it to them. They open
   it, accept, and get a Play Store link to install.

Subsequent builds: repeat 1, 2 and 4. Testers get an update automatically.

## The toolchain

Installed outside the repo, so a clean checkout does not carry 500 MB of SDK:

```
~/Library/Android/jdk-17.*/          Temurin JDK 17 (arm64)
~/Library/Android/sdk/               platform-tools, platforms;android-36, build-tools;36.0.0
~/Library/gatewaze/android/          keystore, signing.env, toolchain.env, built .aab files
```

`toolchain.env` sets `JAVA_HOME`, `ANDROID_HOME` and `PATH`. Source it in any
shell that runs a Gradle build.

**JDK 17 specifically.** The machine's existing JDKs were 18 and 8, both Intel
builds running under Rosetta. React Native 0.83 wants 17, and an arm64 JDK
builds considerably faster on this hardware.

## What does not work on Android, and why

**Apple Health.** HealthKit has no Android equivalent, and this is the only
real gap. `health-body-metrics` is the single module that needs it, and the
capability system means an Android build can simply omit it. Nothing crashes:
`capabilities/health.ts` reports unavailable on Android, and the module checks
before every call.

The Android equivalent is **Health Connect**, which is a different API with its
own permission model and data types. That is a project in itself, not a port.

**Push notifications.** The device token store is already multi-platform: the
`hn_devices` table has a `token_kind` column constrained to `'apns' | 'fcm'`,
with validation for both, and the app already returns an `fcm` token on
Android. What is missing is the sending half — an FCM sender alongside
`health-notify/lib/apns.ts`, and a Firebase project. Until that exists, an
Android build registers a token nobody sends to.

**Haptics and message tones.** Silently disabled on Android. They degrade
rather than break, but Android users get a quieter app.

**Liquid Glass.** iOS 26 only. `GlassPanel` falls back to a solid themed fill,
which is correct but has never been looked at by a person. Expect the first
Android build to need visual work — the design leans hard on translucency.
