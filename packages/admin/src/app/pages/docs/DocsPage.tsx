import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3002';

type McpTool = { name: string; description: string };
type McpResource = { uriTemplate: string; name: string; description: string };
type McpPrompt = { name: string; description: string };
type ModuleContribution = {
  moduleId: string;
  moduleName: string;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
};
type McpRegistry = {
  transport: { stdio: boolean; http: boolean };
  core: { tools: McpTool[] };
  modules: ModuleContribution[];
};

type Tab = 'rest' | 'mcp';

export function DocsPage() {
  const [tab, setTab] = useState<Tab>('rest');
  const [mcpRegistry, setMcpRegistry] = useState<McpRegistry | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'mcp' || mcpRegistry || mcpError) return;
    fetch(`${API_URL}/api/v1/mcp/tools`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setMcpRegistry)
      .catch((e) => setMcpError(e.message));
  }, [tab, mcpRegistry, mcpError]);

  // Inject Scalar via CDN script tag once when REST tab is active
  useEffect(() => {
    if (tab !== 'rest') return;
    const existing = document.getElementById('scalar-script');
    if (existing) return;
    const script = document.createElement('script');
    script.id = 'scalar-script';
    script.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';
    document.body.appendChild(script);
  }, [tab]);

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-dark-900 dark:text-dark-50">
      <header className="border-b border-gray-200 dark:border-dark-600 bg-white dark:bg-dark-800">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Gatewaze Developer Docs</h1>
            <p className="text-sm text-gray-500 dark:text-dark-300">
              Public REST API and MCP server reference
            </p>
          </div>
          <nav className="flex gap-1 bg-gray-100 dark:bg-dark-700 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setTab('rest')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === 'rest'
                  ? 'bg-white dark:bg-dark-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-dark-200 hover:text-gray-900'
              }`}
            >
              REST API
            </button>
            <button
              type="button"
              onClick={() => setTab('mcp')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === 'mcp'
                  ? 'bg-white dark:bg-dark-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-dark-200 hover:text-gray-900'
              }`}
            >
              MCP Server
            </button>
          </nav>
        </div>
      </header>

      <main>
        {tab === 'rest' ? (
          <section>
            <script
              id="api-reference"
              data-url={`${API_URL}/api/v1/openapi.json`}
            />
          </section>
        ) : (
          <McpDocs registry={mcpRegistry} error={mcpError} />
        )}
      </main>
    </div>
  );
}

function McpDocs({ registry, error }: { registry: McpRegistry | null; error: string | null }) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
      <section>
        <h2 className="text-xl font-semibold mb-3">About the MCP Server</h2>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <p>
            The Gatewaze MCP server exposes domain-aware tools to AI assistants like Claude Code. It
            calls the public REST API with an API key — no direct database access. Tools are
            namespaced by module (e.g. <code>events_search</code>).
          </p>
          <h3 className="mt-6">Connecting from Claude Code</h3>
          <p>Add to your <code>.mcp.json</code>:</p>
          <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">
{`{
  "mcpServers": {
    "gatewaze": {
      "command": "npx",
      "args": ["tsx", "packages/mcp/src/index.ts"],
      "env": {
        "GATEWAZE_API_URL": "${API_URL}",
        "GATEWAZE_MCP_API_KEY": "gw_live_..."
      }
    }
  }
}`}
          </pre>
          <p className="text-sm text-gray-500 dark:text-dark-300">
            Create an API key in Platform Settings → API Keys.
          </p>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200">
          Failed to load MCP registry: {error}
        </div>
      )}

      {registry && (
        <>
          <section>
            <h2 className="text-xl font-semibold mb-3">Core Tools</h2>
            <p className="text-sm text-gray-500 dark:text-dark-300 mb-4">
              Always available regardless of which modules are enabled.
            </p>
            <ToolList tools={registry.core.tools} />
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Module Contributions</h2>
            <p className="text-sm text-gray-500 dark:text-dark-300 mb-4">
              Tools, resources, and prompts contributed by enabled modules.
            </p>
            {registry.modules.length === 0 && (
              <p className="text-sm italic text-gray-500">No enabled modules contribute MCP tools.</p>
            )}
            {registry.modules.map((mod) => (
              <div
                key={mod.moduleId}
                className="rounded-lg border border-gray-200 dark:border-dark-600 mb-6 overflow-hidden"
              >
                <div className="bg-gray-50 dark:bg-dark-800 px-4 py-3 border-b border-gray-200 dark:border-dark-600">
                  <h3 className="font-semibold">{mod.moduleName}</h3>
                  <code className="text-xs text-gray-500 dark:text-dark-300">{mod.moduleId}</code>
                </div>
                <div className="p-4 space-y-4">
                  {mod.tools.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Tools</h4>
                      <ToolList tools={mod.tools} />
                    </div>
                  )}
                  {mod.resources.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Resources</h4>
                      <ul className="space-y-2">
                        {mod.resources.map((r) => (
                          <li key={r.uriTemplate} className="text-sm">
                            <code className="text-xs bg-gray-100 dark:bg-dark-700 px-1.5 py-0.5 rounded">
                              {r.uriTemplate}
                            </code>
                            <span className="text-gray-500 dark:text-dark-300 ml-2">{r.description}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {mod.prompts.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Prompts</h4>
                      <ToolList tools={mod.prompts} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {!registry && !error && (
        <div className="text-center py-12 text-gray-500">Loading MCP registry…</div>
      )}
    </div>
  );
}

function ToolList({ tools }: { tools: { name: string; description: string }[] }) {
  return (
    <ul className="space-y-2">
      {tools.map((t) => (
        <li key={t.name} className="flex flex-col sm:flex-row sm:items-baseline gap-2">
          <code className="text-sm bg-gray-100 dark:bg-dark-700 px-2 py-0.5 rounded font-mono whitespace-nowrap">
            {t.name}
          </code>
          <span className="text-sm text-gray-600 dark:text-dark-200">{t.description}</span>
        </li>
      ))}
    </ul>
  );
}

export default DocsPage;
