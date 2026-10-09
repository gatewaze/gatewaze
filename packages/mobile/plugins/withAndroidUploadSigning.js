/**
 * Release signing for Android, applied at prebuild.
 *
 * ── WHY A PLUGIN AND NOT A FILE IN android/ ───────────────────────────────
 *
 * `android/` is generated. `expo prebuild --clean` deletes and rewrites it,
 * which the release script does on every build, so anything hand-edited in
 * there survives exactly until the next release and then vanishes — and it
 * vanishes silently, producing an unsigned or debug-signed artifact that the
 * Play Console rejects at upload with a message about the wrong certificate.
 * The generated project is an output; this is the input that produces it.
 *
 * ── WHY THE PASSWORDS COME FROM THE ENVIRONMENT ───────────────────────────
 *
 * The keystore and its passwords are the app's identity: whoever holds them
 * can publish a build that Android will accept as an update to this one. They
 * live in a 0600 file outside the repo (~/Library/gatewaze/android/
 * signing.env) which the release script sources, so nothing secret is written
 * into the generated project, into git, or into a build log.
 *
 * Absent credentials are not an error. A debug build, a CI typecheck and a
 * local `expo run:android` all prebuild without ever signing a release, and
 * failing those because a release key is missing would be answering a
 * question nobody asked. The release script checks for itself and refuses.
 */

// `expo/config-plugins`, not `@expo/config-plugins`. The scoped package is
// present in the tree but is not a dependency of this workspace package, so
// under pnpm's strict layout it does not resolve from here — the build fails
// at config load with "Cannot find module". Expo re-exports it for exactly
// this reason, and the splash plugin next door uses the same import.
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING_CONFIG = `
        release {
            // Injected by plugins/withAndroidUploadSigning.js at prebuild.
            // Values come from the environment; see the plugin's header.
            storeFile file(System.getenv("HELF_UPLOAD_STORE_FILE") ?: "upload.keystore")
            storePassword System.getenv("HELF_UPLOAD_STORE_PASSWORD")
            keyAlias System.getenv("HELF_UPLOAD_KEY_ALIAS")
            keyPassword System.getenv("HELF_UPLOAD_KEY_PASSWORD")
        }`;

module.exports = function withAndroidUploadSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;

    if (gradle.includes('HELF_UPLOAD_STORE_FILE')) return cfg;

    /**
     * Add a `release` signing config beside the `debug` one Expo generates.
     *
     * Anchored on the debug block rather than on `signingConfigs {` itself,
     * because the opening brace appears in `buildTypes` too and matching the
     * wrong one produces a file that parses and signs nothing.
     */
    const withConfig = gradle.replace(
      /(signingConfigs \{\s*\n\s*debug \{[\s\S]*?\n\s{8}\})/,
      `$1\n${SIGNING_CONFIG}`,
    );
    if (withConfig === gradle) {
      throw new Error('withAndroidUploadSigning: could not find the signingConfigs block to extend.');
    }
    gradle = withConfig;

    /**
     * Point the RELEASE BUILD TYPE at it.
     *
     * This has to operate on the buildTypes block specifically. A regex for
     * `release { ... signingConfig signingConfigs.debug` matches the signing
     * config named `release` that was just inserted above, then runs forward
     * into buildTypes and rewrites the DEBUG build type instead — leaving the
     * release build signed with the debug key while looking, in the diff, as
     * though it had worked. That produced an 84 MB bundle carrying
     * "CN=Android Debug", which Play rejects at upload.
     */
    const btStart = gradle.indexOf('buildTypes {');
    if (btStart < 0) throw new Error('withAndroidUploadSigning: no buildTypes block.');
    const relStart = gradle.indexOf('release {', btStart);
    if (relStart < 0) throw new Error('withAndroidUploadSigning: no release build type.');
    const relEnd = gradle.indexOf('\n        }', relStart);
    const before = gradle.slice(0, relStart);
    const block = gradle.slice(relStart, relEnd);
    const after = gradle.slice(relEnd);

    if (!block.includes('signingConfig signingConfigs.debug')) {
      throw new Error('withAndroidUploadSigning: release build type does not reference the debug signing config; template changed.');
    }
    gradle = before
      + block.replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release')
      + after;

    /**
     * And prove it. A silent no-op here is the whole failure mode: everything
     * builds, everything looks right, and the artifact is rejected at the end
     * of a twenty minute upload with a message about the wrong certificate.
     */
    const releaseBlock = gradle.slice(gradle.indexOf('release {', gradle.indexOf('buildTypes {')));
    if (!releaseBlock.startsWith('release {') || !releaseBlock.includes('signingConfigs.release')) {
      throw new Error('withAndroidUploadSigning: release build type was not switched to the upload key.');
    }

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
