import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import './styles.css';
import { useEffect, useMemo, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3002';

type McpTool = { name: string; description: string };
type McpResource = { uriTemplate: string; name: string; description: string };
type ModuleContribution = {
  moduleId: string;
  moduleName: string;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpTool[];
};
type McpRegistry = {
  transport: { stdio: boolean; http: boolean };
  core: { tools: McpTool[] };
  modules: ModuleContribution[];
};

type Tab = 'rest' | 'mcp';

function DocsApp() {
  const [tab, setTab] = useState<Tab>('rest');
  const [mcpRegistry, setMcpRegistry] = useState<McpRegistry | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);

  useEffect(() => {
    if (mcpRegistry || mcpError) return;
    fetch(`${API_URL}/api/v1/mcp/tools`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setMcpRegistry)
      .catch((e) => setMcpError(e.message));
  }, [mcpRegistry, mcpError]);

  const scalarConfig = useMemo(() => ({ url: `${API_URL}/api/v1/openapi.json` }), []);

  return (
    <>
      <header className="docs-header">
        <div className="docs-header__left">
          <img src="/theme/gatewaze/logo.svg" alt="Gatewaze" className="docs-logo" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          <div>
            <div className="docs-header__title">Developer Docs</div>
            <div className="docs-header__subtitle">Public REST API and MCP server reference</div>
          </div>
        </div>
        <nav className="docs-tabs">
          <button
            type="button"
            onClick={() => setTab('rest')}
            className={`docs-tab ${tab === 'rest' ? 'docs-tab--active' : ''}`}
          >
            REST API
          </button>
          <button
            type="button"
            onClick={() => setTab('mcp')}
            className={`docs-tab ${tab === 'mcp' ? 'docs-tab--active' : ''}`}
          >
            MCP Server
          </button>
        </nav>
      </header>

      <main className="docs-main">
        <div style={{ display: tab === 'rest' ? 'block' : 'none' }}>
          <ApiReferenceReact configuration={scalarConfig} />
        </div>
        {tab === 'mcp' && <McpDocs registry={mcpRegistry} error={mcpError} />}
      </main>
    </>
  );
}

function McpDocs({ registry, error }: { registry: McpRegistry | null; error: string | null }) {
  return (
    <div className="mcp-content">
      <section>
        <h2>About the MCP Server</h2>
        <p>
          The Gatewaze MCP server exposes domain-aware tools to AI assistants like Claude Code. It
          calls the public REST API with an API key — no direct database access. Tools are
          namespaced by module (e.g. <code>events_search</code>).
        </p>
        <h3>Connecting from Claude Code</h3>
        <p>Add to your <code>.mcp.json</code>:</p>
        <pre>
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
        <p style={{ color: '#6b7280', fontSize: 13 }}>
          Create an API key in Platform Settings → API Keys.
        </p>
      </section>

      {error && <div className="mcp-error">Failed to load MCP registry: {error}</div>}

      {registry && (
        <>
          <section>
            <h2>Core Tools</h2>
            <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
              Always available regardless of which modules are enabled.
            </p>
            <ToolList tools={registry.core.tools} />
          </section>

          <section>
            <h2>Module Contributions</h2>
            <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
              Tools, resources, and prompts contributed by enabled modules.
            </p>
            {registry.modules.length === 0 && (
              <p style={{ fontStyle: 'italic', color: '#6b7280' }}>No enabled modules contribute MCP tools.</p>
            )}
            {registry.modules.map((mod) => (
              <div key={mod.moduleId} className="mcp-module">
                <div className="mcp-module__header">
                  <div className="mcp-module__title">{mod.moduleName}</div>
                  <code className="mcp-module__id">{mod.moduleId}</code>
                </div>
                <div className="mcp-module__body">
                  {mod.tools.length > 0 && (
                    <div>
                      <h4>Tools</h4>
                      <ToolList tools={mod.tools} />
                    </div>
                  )}
                  {mod.resources.length > 0 && (
                    <div>
                      <h4>Resources</h4>
                      <ul className="mcp-tool-list">
                        {mod.resources.map((r) => (
                          <li key={r.uriTemplate}>
                            <code>{r.uriTemplate}</code>
                            <span style={{ color: '#6b7280' }}>{r.description}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {mod.prompts.length > 0 && (
                    <div>
                      <h4>Prompts</h4>
                      <ToolList tools={mod.prompts} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {!registry && !error && <div className="mcp-loading">Loading MCP registry…</div>}
    </div>
  );
}

function ToolList({ tools }: { tools: { name: string; description: string }[] }) {
  return (
    <ul className="mcp-tool-list">
      {tools.map((t) => (
        <li key={t.name}>
          <code>{t.name}</code>
          <span style={{ color: '#374151' }}>{t.description}</span>
        </li>
      ))}
    </ul>
  );
}

createRoot(document.getElementById('docs-root')!).render(
  <StrictMode>
    <DocsApp />
  </StrictMode>
);
