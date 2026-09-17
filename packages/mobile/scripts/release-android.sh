#!/usr/bin/env bash
#
# Build a signed Android App Bundle for the Play Console.
#
# Usage, from packages/mobile:
#   set -a; . ~/Library/gatewaze/android/signing.env; set +a
#   . ~/Library/gatewaze/android/toolchain.env
#   ./scripts/release-android.sh
#
# Environment:
#   HELF_UPLOAD_STORE_FILE      the upload keystore
#   HELF_UPLOAD_STORE_PASSWORD  its password
#   HELF_UPLOAD_KEY_ALIAS       the key inside it
#   HELF_UPLOAD_KEY_PASSWORD    that key's password
#   JAVA_HOME / ANDROID_HOME    the toolchain (toolchain.env sets both)
#   APP_BUILD_NUMBER            optional; otherwise derived, see below
#
# The counterpart of scripts/release-testflight.sh. It does NOT upload:
# Play has no equivalent of altool that is worth the credential surface for a
# handful of releases a week, so the last step is dragging one file into the
# Play Console. See docs/android-release.md.
set -euo pipefail

cd "$(dirname "$0")/.."

# ── The signing key is the app's identity ──────────────────────────────────
#
# Refuse rather than build. Gradle's template falls back to the DEBUG keystore
# when a release config is absent, so a missing key does not fail the build —
# it produces a bundle signed "CN=Android Debug" that looks fine until the
# Play Console rejects it at the end of the upload. That happened once here
# already, from a regex matching the wrong block.
: "${HELF_UPLOAD_STORE_FILE:?set HELF_UPLOAD_STORE_FILE — source ~/Library/gatewaze/android/signing.env}"
: "${HELF_UPLOAD_STORE_PASSWORD:?set HELF_UPLOAD_STORE_PASSWORD}"
: "${HELF_UPLOAD_KEY_ALIAS:?set HELF_UPLOAD_KEY_ALIAS}"
: "${HELF_UPLOAD_KEY_PASSWORD:?set HELF_UPLOAD_KEY_PASSWORD}"
: "${ANDROID_HOME:?set ANDROID_HOME — source ~/Library/gatewaze/android/toolchain.env}"
[ -f "$HELF_UPLOAD_STORE_FILE" ] || { echo "keystore not found: $HELF_UPLOAD_STORE_FILE" >&2; exit 1; }

# ── Version code ───────────────────────────────────────────────────────────
#
# Play orders builds by versionCode and refuses one it has seen. The commit
# count is monotonic and needs no state, which is the same rule iOS uses; the
# override exists because the two platforms' histories can diverge and because
# an upload that fails after the build should not need a new commit to retry.
BUILD_NUMBER="${APP_BUILD_NUMBER:-$(git rev-list --count HEAD)}"
export APP_BUILD_NUMBER="$BUILD_NUMBER"

echo "==> Registry + prebuild (${APP_NAME:-HELF}) — versionCode $BUILD_NUMBER"
pnpm run generate >/dev/null
npx expo prebuild --platform android --clean

# Prove the signing config actually landed BEFORE spending four minutes on a
# bundle. The plugin throws if it cannot rewrite the gradle file, but a
# template change could still leave something that parses and signs wrongly.
grep -q 'signingConfig signingConfigs.release' android/app/build.gradle \
  || { echo "release build type is not using the upload key; check plugins/withAndroidUploadSigning.js" >&2; exit 1; }

echo "==> Bundle"
( cd android && ./gradlew :app:bundleRelease --no-daemon )

AAB=android/app/build/outputs/bundle/release/app-release.aab
[ -f "$AAB" ] || { echo "no bundle produced" >&2; exit 1; }

# ── Verify what we are about to hand to Google ─────────────────────────────
# -storepass:env passes the NAME of the variable, not the password itself.
# Spelled the other way the password sits in this process's argv, where any
# other user on the machine can read it out of the process table for as long
# as keytool runs. That is a small window on a single-developer laptop, but
# this script's whole claim is that nothing secret reaches a log, a file or
# the generated project, and argv is none of those only by accident.
EXPECTED=$(keytool -list -v -keystore "$HELF_UPLOAD_STORE_FILE" \
  -storepass:env HELF_UPLOAD_STORE_PASSWORD 2>/dev/null \
  | grep -oE 'SHA256: [0-9A-F:]+' | head -1)
ACTUAL=$(keytool -printcert -jarfile "$AAB" 2>/dev/null \
  | grep -oE 'SHA256: [0-9A-F:]+' | head -1)
if [ -z "$ACTUAL" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "SIGNATURE MISMATCH — this bundle would be rejected." >&2
  echo "  keystore: $EXPECTED" >&2
  echo "  bundle  : $ACTUAL" >&2
  exit 1
fi

OUT="$HOME/Library/gatewaze/android/helf-${BUILD_NUMBER}.aab"
cp "$AAB" "$OUT"

echo
echo "==> Done. versionCode $BUILD_NUMBER"
echo "    $OUT"
echo "    $(keytool -printcert -jarfile "$AAB" 2>/dev/null | grep Owner | head -1)"
echo
echo "Upload it at https://play.google.com/console → HELF → Testing → Internal testing"
echo "→ Create new release → drop the .aab in → Save → Review → Start rollout."
