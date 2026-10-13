import { EMBED_CAPABILITIES, EMBED_CONTRACT } from './contract';

/**
 * The /embed/manifest.json the loader reads. Built here rather than inline in
 * vite.embed.config.ts so the shape (in particular `contract` and
 * `capabilities`, which the loader checks before importing anything) is
 * covered by a unit test.
 */
export function buildEmbedManifest(input: {
  entry: string;
  stylesheet: string;
  modules: string[];
  version: string;
  builtAt: string;
}) {
  return {
    contract: EMBED_CONTRACT,
    // Optional features the loader can check for (see contract.ts).
    capabilities: [...EMBED_CAPABILITIES],
    version: input.version,
    entry: input.entry,
    stylesheet: input.stylesheet,
    modules: input.modules,
    builtAt: input.builtAt,
  };
}
