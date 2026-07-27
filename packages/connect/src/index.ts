#!/usr/bin/env node
import { parseArgs } from 'node:util';
import type { ApplyResult, ClientId, DetectedClient } from './types.js';
import { CLIENT_IDS } from './types.js';
import {
  DEFAULT_SERVER_URL,
  checkForNewerVersion,
  deriveName,
  fetchConnectorName,
  validateServerUrl,
} from './util.js';
import { detectClients } from './detect.js';
import { confirm, selectClients } from './prompt.js';
import { applyClaudeDesktopConfig, claudeDesktopConfigPath } from './clients/claude-desktop.js';
import { claudeCodeAddCommand, formatCommand, runClaudeCodeAdd } from './clients/claude-code.js';
import { applyGooseConfig, gooseConfigPath, gooseDeepLink } from './clients/goose.js';
import { chatgptInstructions } from './clients/chatgpt.js';

const HELP = `gatewaze-connect — connect your AI clients to a Gatewaze MCP server

Usage:
  npx @gatewaze/connect [options]

Options:
  --server <url>    MCP server URL (default: ${DEFAULT_SERVER_URL})
  --name <label>    Connector name (default: derived from the server hostname)
  --all             Configure every detected client, no prompts
  --client <id>     Configure a specific client (repeatable). One of:
                    ${CLIENT_IDS.join(', ')}
  --force           Overwrite an existing entry with the same name
  --dry-run         Show what would change without writing anything
  -h, --help        Show this help

Examples:
  npx @gatewaze/connect
  npx @gatewaze/connect --server https://mcp.aaif.live --all
  npx @gatewaze/connect --client claude-desktop --client goose --dry-run
`;

interface Options {
  serverUrl: string;
  name: string;
  all: boolean;
  clients: ClientId[];
  force: boolean;
  dryRun: boolean;
}

function parseCliArgs(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      server: { type: 'string' },
      name: { type: 'string' },
      all: { type: 'boolean', default: false },
      client: { type: 'string', multiple: true },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const serverUrl = validateServerUrl(values.server ?? DEFAULT_SERVER_URL);
  // Placeholder — main() resolves the final name (brand-configured via the
  // server's /brand.json, falling back to hostname derivation) because
  // that lookup is async.
  const name = values.name?.trim() || '';

  const clients: ClientId[] = [];
  for (const raw of values.client ?? []) {
    const id = raw.trim().toLowerCase();
    if (!(CLIENT_IDS as string[]).includes(id)) {
      throw new Error(`Unknown --client "${raw}". Valid values: ${CLIENT_IDS.join(', ')}`);
    }
    clients.push(id as ClientId);
  }

  return {
    serverUrl,
    name,
    all: values.all ?? false,
    clients,
    force: values.force ?? false,
    dryRun: values['dry-run'] ?? false,
  };
}

function reportApply(result: ApplyResult): void {
  const prefix = result.status === 'error' ? '  !!' : '  ->';
  console.log(`${prefix} ${result.message}`);
  if (result.backupPath) {
    console.log(`  -> Backed up previous config to ${result.backupPath}`);
  }
}

async function resolveConflict(
  label: string,
  result: ApplyResult,
  retry: (overwrite: boolean) => ApplyResult
): Promise<ApplyResult> {
  if (result.status !== 'conflict') return result;
  console.log(`  !! ${result.message}`);
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const yes = await confirm(`  Overwrite the existing "${label}" entry?`, false);
    if (yes) return retry(true);
    return { status: 'unchanged', message: 'Left the existing entry untouched.' };
  }
  return {
    status: 'unchanged',
    message: 'Left the existing entry untouched (re-run with --force to overwrite).',
  };
}

async function main(): Promise<void> {
  // Fired before arg parsing so the ~2s-bounded registry check overlaps
  // other startup work; npx caches aggressively, so without a hint users
  // can sit on a stale installer indefinitely.
  const newerVersion = checkForNewerVersion();

  let opts: Options;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${(err as Error).message}\n`);
    console.error(HELP);
    process.exit(2);
  }

  if (!opts.name) {
    opts.name = (await fetchConnectorName(opts.serverUrl)) ?? deriveName(opts.serverUrl);
  }

  console.log('gatewaze-connect');
  const latest = await newerVersion;
  if (latest) {
    console.log(
      `  Note: a newer installer (v${latest}) exists — re-run with: npx @gatewaze/connect@latest`
    );
  }
  console.log(`  Server: ${opts.serverUrl}`);
  console.log(`  Connector name: ${opts.name}`);
  if (opts.dryRun) console.log('  Mode: dry-run (nothing will be written)');

  const detected = detectClients();

  let targets: DetectedClient[];
  if (opts.clients.length > 0) {
    targets = detected.filter((c) => opts.clients.includes(c.id));
  } else if (opts.all) {
    targets = detected.filter((c) => c.detected);
  } else if (process.stdin.isTTY && process.stdout.isTTY) {
    targets = await selectClients(detected);
  } else {
    console.error(
      '\nNo TTY available for interactive selection. Re-run with --all or one or more --client flags.'
    );
    process.exit(2);
  }

  if (targets.length === 0) {
    console.log('\nNothing selected — no changes made.');
    return;
  }

  console.log('');
  const nextSteps: string[] = [];
  let hadError = false;

  for (const target of targets) {
    console.log(`${target.label}:`);
    if (!target.detected) {
      console.log(`  -> Not detected (${target.detail}) — configuring anyway as requested.`);
    }

    switch (target.id) {
      case 'claude-desktop': {
        const configPath = claudeDesktopConfigPath();
        let result = applyClaudeDesktopConfig(configPath, opts.name, opts.serverUrl, {
          overwrite: opts.force,
          dryRun: opts.dryRun,
        });
        result = await resolveConflict(target.label, result, (overwrite) =>
          applyClaudeDesktopConfig(configPath, opts.name, opts.serverUrl, {
            overwrite,
            dryRun: opts.dryRun,
          })
        );
        reportApply(result);
        if (result.status === 'error') hadError = true;
        if (result.status === 'added' || result.status === 'updated') {
          nextSteps.push(
            'Claude Desktop: restart the app, then use the connector once — the first use opens your sign-in page in the browser (via mcp-remote).'
          );
        }
        break;
      }

      case 'claude-code': {
        if (opts.dryRun) {
          console.log(
            `  -> Would run: ${formatCommand(claudeCodeAddCommand(opts.name, opts.serverUrl))}`
          );
        } else {
          const result = runClaudeCodeAdd(opts.name, opts.serverUrl);
          if (result.ok) {
            console.log(`  -> ${result.message}`);
            nextSteps.push(
              'Claude Code: run /mcp in any session to check the connection — first use opens your sign-in page.'
            );
          } else {
            hadError = true;
            console.log(`  !! ${result.message}`);
            console.log(`  -> Run this yourself to register the server:\n       ${result.command}`);
          }
        }
        break;
      }

      case 'goose': {
        const configPath = gooseConfigPath();
        let result = applyGooseConfig(configPath, opts.name, opts.serverUrl, {
          overwrite: opts.force,
          dryRun: opts.dryRun,
        });
        result = await resolveConflict(target.label, result, (overwrite) =>
          applyGooseConfig(configPath, opts.name, opts.serverUrl, { overwrite, dryRun: opts.dryRun })
        );
        reportApply(result);
        if (result.status === 'error') hadError = true;
        console.log(
          `  -> Goose Desktop one-click alternative: ${gooseDeepLink(opts.name, opts.serverUrl)}`
        );
        if (result.status === 'added' || result.status === 'updated') {
          nextSteps.push(
            'Goose: restart Goose (Desktop) or start a new goose session (CLI) — first use of the extension opens your sign-in page.'
          );
        }
        break;
      }

      case 'chatgpt': {
        for (const line of chatgptInstructions(opts.name, opts.serverUrl)) {
          console.log(`  ${line}`);
        }
        break;
      }
    }
    console.log('');
  }

  if (nextSteps.length > 0) {
    console.log('Next steps:');
    for (const step of nextSteps) console.log(`  - ${step}`);
  } else if (opts.dryRun) {
    console.log('Dry-run complete — nothing was written.');
  }

  if (hadError) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Unexpected error: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
