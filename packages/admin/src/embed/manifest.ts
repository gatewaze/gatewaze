import { EMBED_CAPABILITIES, EMBED_CONTRACT } from './contract';

/**
 * The /embed/manifest.json the loader reads. Built here rather than inline in
 * vite.embed.config.ts so the shape (in particular `contract` and
 * `capabilities`, which the loader checks before importing anything) is
 * covered by a unit test.
 *
 * `preload` lists the chunks the entry imports statically (its whole static
 * import graph, entry excluded), as file names relative to the manifest. A
 * loader that knows the field adds a `<link rel="modulepreload">` for each,
 * so the browser fetches them alongside the entry instead of discovering
 * them one import at a time. Optional and additive: loaders before 1.2.0
 * ignore fields they do not know, and the field is left out when empty.
 */
export function buildEmbedManifest(input: {
  entry: string;
  stylesheet: string;
  modules: string[];
  version: string;
  builtAt: string;
  preload?: string[];
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
    ...(input.preload && input.preload.length > 0 ? { preload: [...input.preload] } : {}),
  };
}

/**
 * The preload list is read from the bundle's own entry chunk in
 * generateBundle, and the manifest names the entry file found on disk in
 * closeBundle. They must be the same file, or the list belongs to another
 * build. Throws when they differ.
 */
export function assertSameEntry(bundleEntry: string | undefined, entryOnDisk: string): void {
  if (bundleEntry !== entryOnDisk) {
    throw new Error(`[vite-embed-config] entry chunk ${bundleEntry ?? '(none)'} does not match ${entryOnDisk} on disk`);
  }
}

/** The parts of a Rollup/Rolldown output chunk staticImportGraph reads. */
interface ChunkLike {
  type: 'chunk' | 'asset';
  fileName: string;
  isEntry?: boolean;
  imports?: readonly string[];
}

/**
 * The file names the entry chunk reaches through static imports, in
 * breadth-first order, the entry itself excluded. Dynamic imports are left
 * out on purpose: they are the lazy routes, which must stay lazy.
 */
export function staticImportGraph(bundle: Record<string, ChunkLike>, entryFileName: string): string[] {
  const seen = new Set<string>([entryFileName]);
  const order: string[] = [];
  const queue = [...(bundle[entryFileName]?.imports ?? [])];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    if (seen.has(name)) continue;
    seen.add(name);
    const chunk = bundle[name];
    if (!chunk || chunk.type !== 'chunk') continue;
    order.push(name);
    queue.push(...(chunk.imports ?? []));
  }
  return order;
}
