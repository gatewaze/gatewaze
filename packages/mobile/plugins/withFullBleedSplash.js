/**
 * Full-bleed launch screen (brand-neutral mechanism).
 *
 * expo-splash-screen treats its image strictly as a LOGO: whatever you give
 * it is padded into a square and centred at `imageWidth` points, which turns
 * a full-height brand frame into a small square tile on the background
 * colour. There is no supported full-bleed mode, so this plugin runs after
 * it during prebuild and rewrites the generated artifacts:
 *
 *  1. The SplashScreenLogo imageset's three scales are replaced with the
 *     supplied image (downscaled per scale with sips — iOS builds only run
 *     on macOS, so sips is always there; if it ever is not, the source file
 *     is copied as-is and iOS scales at runtime).
 *  2. The storyboard's image view is switched to scaleAspectFill and pinned
 *     to the container's edges, replacing the centreX/centreY constraints.
 *
 * The plugin is inert unless the app config passes an image, so unbranded
 * builds keep stock behaviour. If expo-splash-screen ever grows a real
 * full-bleed option, delete this file and use it.
 */

const { withDangerousMod } = require('expo/config-plugins');

/**
 * The storyboard mod pipe, resolved lazily and through expo's own dependency
 * chain — deliberately, twice over:
 *
 * - Internal path: it is the only pipe through which the generated
 *   storyboard can be edited without a later mod overwriting the edit.
 * - Lazy + chained: pnpm's strict layout means '@expo/prebuild-config' is
 *   not resolvable from this package directly, only via expo → @expo/cli.
 *   And the EXConstants build phase re-evaluates the app config in a context
 *   that may not resolve it at all — that context only serialises the
 *   config, never executes mods, so returning null there and skipping the
 *   storyboard registration is correct, not a silent failure. Prebuild
 *   itself resolves fine, and its guards below still throw loudly.
 */
function getStoryboardPipe() {
  const candidates = [];
  try {
    candidates.push(require.resolve('@expo/prebuild-config/build/plugins/unversioned/expo-splash-screen/withIosSplashScreenStoryboard'));
  } catch {
    try {
      const expoDir = path.dirname(require.resolve('expo/package.json'));
      const cliDir = path.dirname(require.resolve('@expo/cli/package.json', { paths: [expoDir] }));
      candidates.push(require.resolve(
        '@expo/prebuild-config/build/plugins/unversioned/expo-splash-screen/withIosSplashScreenStoryboard',
        { paths: [cliDir, expoDir] }
      ));
    } catch {
      return null;
    }
  }
  return require(candidates[0]).withIosSplashScreenStoryboard;
}
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function replaceImageset(imagesetDir, sourceImage) {
  // @1x/@2x/@3x for a 430pt-wide frame. Downscaling failures fall back to
  // copying the source; iOS resamples at runtime and only memory is wasted.
  const scales = [
    ['image.png', 430],
    ['image@2x.png', 860],
    ['image@3x.png', 1290],
  ];
  for (const [name, width] of scales) {
    const out = path.join(imagesetDir, name);
    try {
      execFileSync('sips', ['--resampleWidth', String(width), sourceImage, '--out', out], {
        stdio: 'ignore',
      });
    } catch {
      fs.copyFileSync(sourceImage, out);
    }
  }
}

/** Depth-first search of the xml2js storyboard object for a node whose $.id matches. */
function findNode(node, id) {
  if (!node || typeof node !== 'object') return null;
  if (node.$ && node.$.id === id) return node;
  for (const key of Object.keys(node)) {
    if (key === '$') continue;
    const children = Array.isArray(node[key]) ? node[key] : [node[key]];
    for (const child of children) {
      const hit = findNode(child, id);
      if (hit) return hit;
    }
  }
  return null;
}

function edge(attr) {
  return {
    $: {
      firstItem: 'EXPO-SplashScreen',
      firstAttribute: attr,
      secondItem: 'EXPO-ContainerView',
      secondAttribute: attr,
      id: `fullbleed-${attr}`,
    },
  };
}

function patchStoryboardDocument(document) {
  const imageView = findNode(document, 'EXPO-SplashScreen');
  const container = findNode(document, 'EXPO-ContainerView');
  if (!imageView || !container || !container.constraints) {
    throw new Error(
      '[withFullBleedSplash] storyboard shape not recognised — expo-splash-screen output changed; update this plugin.'
    );
  }
  imageView.$.contentMode = 'scaleAspectFill';
  container.constraints = [
    { constraint: ['top', 'bottom', 'leading', 'trailing'].map(edge) },
  ];
}

module.exports = function withFullBleedSplash(config, { image } = {}) {
  if (!image) return config;
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const projectName = cfg.modRequest.projectName;
      const iosRoot = path.join(cfg.modRequest.platformProjectRoot, projectName);
      replaceImageset(
        path.join(iosRoot, 'Images.xcassets', 'SplashScreenLogo.imageset'),
        image
      );
      return cfg;
    },
  ]);
  const withStoryboard = getStoryboardPipe();
  if (!withStoryboard) return config;
  return withStoryboard(config, (cfg) => {
    patchStoryboardDocument(cfg.modResults.document);
    return cfg;
  });
};
