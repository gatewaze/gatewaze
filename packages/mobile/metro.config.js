/* eslint-disable @typescript-eslint/no-require-imports */
// Metro config for a pnpm monorepo + external module sources.
//
// The registry generator writes src/generated/mobile-dirs.json with the
// resolved module source directories (which live OUTSIDE this repo — e.g.
// a sibling private modules checkout). Metro only bundles files inside
// watchFolders, so those dirs are appended here. Module code resolves its
// dependencies from this package's node_modules (the capability-kit
// contract: modules bring no dependencies of their own).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

const moduleDirs = (() => {
  try {
    const p = path.join(projectRoot, 'src/generated/mobile-dirs.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    /* no module sources configured */
  }
  return [];
})();

config.watchFolders = [workspaceRoot, ...moduleDirs];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Module mobile code imports the core kit via the stable '@gatewaze/mobile'
// specifier (the mobile twin of admin module pages importing
// '@/components/ui'). Map it to src/ so '@gatewaze/mobile' → src/index.ts
// and '@gatewaze/mobile/x' → src/x. '@gatewaze/shared' resolves to source
// so external module files don't need the built package.
config.resolver.extraNodeModules = {
  '@gatewaze/mobile': path.resolve(projectRoot, 'src'),
  // Types-only view of shared: the full shared barrel pulls Node (fs/path)
  // code that must never enter an RN bundle. Module code imports types via
  // `import type`, which the bundler erases anyway; this mapping keeps an
  // accidental value-import from dragging Node code in.
  '@gatewaze/shared': path.resolve(workspaceRoot, 'packages/shared/src/types'),
};

/**
 * Node ESM's '.js' specifiers, resolved to the '.ts' files they name.
 *
 * A module's SERVER code is authored as Node ESM, where a relative import must
 * carry an explicit extension, and it writes '.js' while the file on disk is
 * '.ts'. Mobile code in the same module legitimately shares pure logic with
 * that server code — health-menopause's offline red-flag rules have to reach
 * the same verdict as the server's, so there is one evaluator and both import
 * it — and those specifiers reach Metro, which does not do the mapping and
 * fails the bundle.
 *
 * Only relative specifiers ending in '.js' are retried, and only after the
 * normal resolution has already failed, so nothing that resolves today changes.
 */
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest;
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, moduleName.slice(0, -'.js'.length), platform);
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
