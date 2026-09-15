#!/bin/zsh
# Build the Gatewaze mobile app and upload it to TestFlight — headless.
#
# Designed for a CI/staging Mac with NO Apple ID signed in: authentication
# is an App Store Connect API key. Signing is MANUAL against a distribution
# certificate and App Store profile created once through the API (Xcode's
# cloud signing refuses this key with "Cloud signing permission error").
# A new build machine therefore needs the certificate in its login keychain
# and the profile in ~/Library/MobileDevice/Provisioning Profiles/.
#
# Required environment (beyond packages/mobile/.env for the app itself):
#   ASC_KEY_PATH    path to the AuthKey_XXXX.p8 (App Store Connect API key)
#   ASC_KEY_ID      the key id (e.g. ABC123DEFG)
#   ASC_ISSUER_ID   the issuer id (UUID from the ASC Integrations page)
#   APP_APPLE_TEAM_ID  (usually already in .env)
#
# One-time prerequisites (account holder, web UI):
#   - App Store Connect app record exists for the bundle id
#   - Program License Agreement + Paid/Free Apps agreements accepted
#
# Build number: the repo's commit count, so every upload increases and maps
# back to a commit. Marketing version comes from APP_VERSION in .env.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${ASC_KEY_PATH:?set ASC_KEY_PATH to the .p8 API key}"
: "${ASC_KEY_ID:?set ASC_KEY_ID}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"

# Load the app .env (identity, backends, module sources) without clobbering
# real environment variables.
if [[ -f .env ]]; then
  while IFS= read -r line; do
    [[ "$line" == \#* || "$line" != *=* ]] && continue
    key="${line%%=*}"
    [[ -z "${(P)key:-}" ]] && export "$line"
  done < .env
fi

TEAM_ID="${APP_APPLE_TEAM_ID:?APP_APPLE_TEAM_ID missing (set in .env)}"
# Apple requires a strictly increasing build number per upload. The commit
# count gives that for free and maps a build back to a commit, but it only
# advances when the work is committed: releasing twice from the same commit
# would upload a duplicate and Apple rejects it. Setting APP_BUILD_NUMBER
# overrides it for those cases.
BUILD_NUMBER="${APP_BUILD_NUMBER:-$(git rev-list --count HEAD)}"
export APP_BUILD_NUMBER="$BUILD_NUMBER"
MARKETING_VERSION="${APP_VERSION:-0.1.0}"

# React Native fetches a prebuilt Hermes from repo.reactnative.dev (via a
# Maven Central redirect). When that mirror is down it returns 404, and the
# hermes-engine podspec silently falls back to compiling Hermes from GitHub
# main, which fails. A local prebuilt tarball short-circuits that. Create
# one from a previous successful build's CocoaPods cache:
#   tar -czf .hermes-prebuilt.tar.gz \
#     -C ~/Library/Caches/CocoaPods/Pods/External/hermes-engine/<hash> destroot LICENSE
if [[ -f .hermes-prebuilt.tar.gz ]]; then
  export HERMES_ENGINE_TARBALL_PATH="$PWD/.hermes-prebuilt.tar.gz"
  echo "==> Using local prebuilt Hermes ($HERMES_ENGINE_TARBALL_PATH)"
fi

echo "==> Registry + prebuild (${APP_NAME:-Gatewaze})"
pnpm generate
npx expo prebuild -p ios --clean

WORKSPACE=$(ls -d ios/*.xcworkspace | head -1)
SCHEME=$(basename "$WORKSPACE" .xcworkspace)
ARCHIVE="ios/build/${SCHEME}.xcarchive"

echo "==> Archive ${SCHEME} (build ${MARKETING_VERSION} (${BUILD_NUMBER}))"
xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  PROVISIONING_PROFILE_SPECIFIER="${APP_PROVISIONING_PROFILE:-Gatewaze Health App Store}" \
  CODE_SIGN_IDENTITY="iPhone Distribution" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  MARKETING_VERSION="$MARKETING_VERSION" \
  archive

# Manual signing. Xcode's cloud signing returned "Cloud signing permission
# error" with this App Store Connect key, so the distribution certificate
# and App Store profile are created once via the API and reused. Set
# APP_PROVISIONING_PROFILE to the profile name; the matching certificate
# must be in the login keychain.
PROFILE_NAME="${APP_PROVISIONING_PROFILE:-Gatewaze Health App Store}"

EXPORT_PLIST=$(mktemp -t exportOptions).plist
cat > "$EXPORT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>signingStyle</key><string>manual</string>
  <key>teamID</key><string>${TEAM_ID}</string>
  <key>uploadSymbols</key><true/>
  <key>provisioningProfiles</key>
  <dict>
    <key>${APP_BUNDLE_ID}</key><string>${PROFILE_NAME}</string>
  </dict>
</dict>
</plist>
PLIST

echo "==> Export + upload to TestFlight"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$EXPORT_PLIST" \
  -exportPath ios/build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

rm -f "$EXPORT_PLIST"
echo "==> Uploaded ${SCHEME} ${MARKETING_VERSION} (${BUILD_NUMBER})."

# Uploading does not put a build in testers' hands: it must also finish
# Apple's processing and be attached to a beta group. Do both here so a
# release is one command.
if [[ -n "${APP_STORE_APP_ID:-}" ]]; then
  echo "==> Waiting for processing, then releasing to testers"
  node scripts/testflight-release-build.mjs "$APP_STORE_APP_ID" "$BUILD_NUMBER" "${APP_BETA_GROUP:-Internal Testers}"
else
  echo "==> Set APP_STORE_APP_ID in .env to auto-release to TestFlight testers."
fi
