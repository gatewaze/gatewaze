# @gatewaze/connect

One command to connect your AI clients to a Gatewaze MCP server.

```
npx @gatewaze/connect
```

The tool finds the AI clients installed on your machine, asks which ones you want to connect, and writes the right connector entry for each. No secrets are stored: each client opens your normal sign-in page in the browser the first time you use the connector.

## Usage

```
npx @gatewaze/connect [options]

Options:
  --server <url>    MCP server URL (default: https://mcp.aaif.live/)
  --name <label>    Connector name (default: derived from the server hostname, e.g. "aaif")
  --all             Configure every detected client, no prompts
  --client <id>     Configure a specific client (repeatable):
                    claude-desktop, claude-code, goose, chatgpt
  --force           Overwrite an existing entry with the same name
  --dry-run         Show what would change without writing anything
  -h, --help        Show help
```

Examples:

```
# Interactive: detect clients and choose which to connect
npx @gatewaze/connect

# Connect everything found, non-interactive
npx @gatewaze/connect --all

# A different server, specific clients, preview only
npx @gatewaze/connect --server https://mcp.example.org --client claude-desktop --client goose --dry-run
```

## What it does per client

**Claude Desktop** — adds an entry to `claude_desktop_config.json` (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows, `~/.config/Claude/` on Linux):

```json
"mcpServers": {
  "aaif": { "command": "npx", "args": ["-y", "mcp-remote", "https://mcp.aaif.live/"] }
}
```

Claude Desktop's config cannot take a bare remote URL, so the entry goes through [mcp-remote](https://www.npmjs.com/package/mcp-remote), which opens the OAuth sign-in in your browser. All existing config content is kept, the file is backed up first, and an existing entry with the same name is never overwritten without confirmation (or `--force`). Restart Claude Desktop after connecting.

**Claude Code** — runs `claude mcp add --scope user --transport http <name> <url>`. If the command cannot run, the tool prints it so you can run it yourself.

**Goose** (CLI and Desktop share one config) — appends an entry to the `extensions:` map in `~/.config/goose/config.yaml`:

```yaml
extensions:
  aaif:
    enabled: true
    name: aaif
    type: streamable_http
    uri: https://mcp.aaif.live/
    timeout: 300
```

The rest of the file, including comments, is preserved, and a backup is written to `config.yaml.bak-<timestamp>` first. The tool also prints a `goose://extension?...` deep link as a one-click alternative for Goose Desktop.

**ChatGPT** — connectors are managed in the ChatGPT web app, so the tool prints the steps: Settings -> Connectors -> Add, paste the server URL, sign in.

## Development

```
npm install
npm run build     # tsc -> dist/
npm run dev       # run from source via tsx
npm test          # unit tests for the config mutators
```

Requires Node 18 or newer.
