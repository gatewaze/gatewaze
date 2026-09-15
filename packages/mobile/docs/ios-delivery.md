# iOS delivery — from this laptop to TestFlight

State as of 2026-09-09: `.env` points at AAIF staging
(`staging-api.aaif.live` / `staging-supabase.aaif.live`, public cloudflared
hostnames), bundle id `io.gatewaze.health`, team `S682S9BLCH`
(Webkit Limited), app name "Gatewaze Health". App identity carries no AAIF
references (decided 2026-09-09); the AAIF-staging backend URLs are
infrastructure config, expected to move when the health product gets its
own brand deployment. Modules come from the local
`danthebaker/gatewaze-modules` checkout — the same code that is live on
staging.

## Does the phone need the build machine?

- **Installing** needs the laptop once (USB cable, or same-network Wi-Fi
  deploy after the first trust). After that:
- A **Release build** embeds the JS bundle. The installed app is fully
  standalone: it only needs internet access to the staging API and
  Supabase, never this laptop. This is the normal way to carry the app
  around.
- A **Debug build** (`npx expo run:ios --device` without
  `--configuration Release`) streams JS from Metro on the laptop — great
  for iterating (edit → reload), but the app goes blank when away from
  the dev server. Use it at the desk, use Release to leave the house.
- Expo Go is not usable here: the App Store Go targets a newer SDK than
  this project's SDK 55.

## Running on your iPhone (first time)

1. Plug the iPhone into this laptop. Trust the computer on the phone.
2. On the phone: Settings → Privacy & Security → Developer Mode → on
   (reboots the phone; iOS 16+ requirement).
3. From `packages/mobile`:
   ```bash
   npx expo run:ios --device --configuration Release
   ```
   Pick the phone from the device list. Signing uses the Webkit Limited
   team automatically (`APP_APPLE_TEAM_ID` in `.env` →
   `ios.appleTeamId`). The first run registers the device in the team's
   provisioning profile.
4. Sign in with a staging member email; the 6-digit code arrives by
   email. Prerequisites on the staging side if sign-in misbehaves:
   the GoTrue email template must include `{{ .Token }}` (not just the
   magic link), and the account must link to a person row (trainer
   invite or existing member).

Day-to-day iteration: `npx expo run:ios --device` (Debug) + edit files;
rebuild natively only when native deps/config change.

## The TestFlight pipeline (implemented 2026-09-09)

`scripts/release-testflight.sh` does the whole run headlessly: registry →
prebuild → `xcodebuild archive` with **App Store Connect API-key cloud
signing** (no Apple ID session, no local certificates — built for a CI
box) → `-exportArchive` with `destination: upload` straight to TestFlight.
Build number = the repo's commit count. Invoked via the
gatewaze-environments Makefile: `make mobile-testflight-local` (this
laptop) or `make mobile-testflight` (the Mac Studio, over SSH).

Remaining prerequisites, in order:

1. **App Store Connect API key** (account holder, one-time): App Store
   Connect → Users and Access → Integrations → App Store Connect API →
   generate a Team Key with the App Manager role, download the `.p8`
   (single chance). Then in gatewaze-environments:
   `sops -e AuthKey_XXXX.p8 > mobile-asc-key.enc.p8` plus a
   `mobile-asc-key.env` (sops-encrypted) holding `ASC_KEY_ID=` and
   `ASC_ISSUER_ID=`.
2. **App record** (account holder, one-time, web UI — the API cannot
   create app records): App Store Connect → Apps → “+” → New App, iOS,
   name "Gatewaze Health", bundle id `io.gatewaze.health`. Decide the final
   bundle id first: it is permanent per app.
3. **The Mac Studio blocker**: the box runs macOS 14.1 / Xcode 15.4
   (audited 2026-09-09); the app needs Xcode 26, which needs macOS 15+.
   Until the box's OS is upgraded (a disruptive change to live staging —
   schedule it), `make mobile-testflight-local` runs the identical
   pipeline from this laptop.

TestFlight distribution notes: internal testers (App Store Connect team
users) receive builds with no review; external groups need one-time beta
review, and the health-category paperwork (privacy labels, deletion — the
`DELETE /me` cascade API change) applies before external testing.

## Background: pipeline design notes

1. **EAS local builds on the Mac Studio.** `eas build --platform ios
   --profile preview --local` runs the entire EAS build (prebuild, pods,
   xcodebuild, signing) on the box itself — no Expo cloud build minutes,
   and the staging box is a Mac so it can. Needs Xcode + an Expo account
   login on the box.
2. **Credentials**: an App Store Connect **API key** (App Store Connect →
   Users and Access → Integrations → App Store Connect API) stored for
   EAS (`eas credentials`), so submissions are non-interactive. The
   distribution certificate + provisioning profile can be EAS-managed
   (recommended) — created once against the Webkit Limited account.
3. **Submit**: `eas submit --platform ios --path <ipa>` uploads to App
   Store Connect; the build appears in TestFlight within minutes.
   Internal testers (your team, up to 100) get it immediately with no
   review; external tester groups need a one-time beta review.
4. **App Store Connect setup (one-time)**: create the app record for
   `io.gatewaze.health` under Webkit Limited. Decide the final bundle id
   BEFORE this step — it cannot change later without being a new app.
5. **OTA between TestFlight builds**: `eas update --channel preview`
   pushes JS-only changes to installed builds; native changes need a new
   TestFlight upload.

A `make mobile-release` style target on the staging box would chain:
regenerate registry from the box's module checkout → `eas build --local`
→ `eas submit`. That is the "build releases on the staging server" flow,
and it slots into the existing staging-deploy conventions
(gatewaze-environments) when wanted.

Health-category note before EXTERNAL TestFlight testers / App Store:
privacy nutrition labels, the Play/App Store health declarations, and
account deletion must be in order (deletion currently depends on the
health-core `DELETE /me` cascade API change — see spec-mobile-app.md).
