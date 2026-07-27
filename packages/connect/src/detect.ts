import fs from 'node:fs';
import type { DetectedClient } from './types.js';
import { claudeDesktopConfigPath } from './clients/claude-desktop.js';
import { claudeBinaryPath } from './clients/claude-code.js';
import { gooseConfigPath } from './clients/goose.js';
import { findOnPath } from './util.js';

export function detectClients(): DetectedClient[] {
  const clients: DetectedClient[] = [];

  const desktopConfig = claudeDesktopConfigPath();
  const desktopFound = fs.existsSync(desktopConfig);
  clients.push({
    id: 'claude-desktop',
    label: 'Claude Desktop',
    detected: desktopFound,
    detail: desktopFound ? `config at ${desktopConfig}` : `no config at ${desktopConfig}`,
  });

  const claudeBin = claudeBinaryPath();
  clients.push({
    id: 'claude-code',
    label: 'Claude Code',
    detected: claudeBin !== null,
    detail: claudeBin ? `claude binary at ${claudeBin}` : 'claude binary not found on PATH',
  });

  const gooseConfig = gooseConfigPath();
  const gooseConfigFound = fs.existsSync(gooseConfig);
  const gooseBin = findOnPath('goose');
  const gooseFound = gooseConfigFound || gooseBin !== null;
  const gooseBits = [
    gooseBin ? `goose binary at ${gooseBin}` : null,
    gooseConfigFound ? `config at ${gooseConfig}` : null,
  ].filter(Boolean);
  clients.push({
    id: 'goose',
    label: 'Goose (CLI + Desktop)',
    detected: gooseFound,
    detail: gooseFound ? gooseBits.join(', ') : `no goose binary on PATH and no config at ${gooseConfig}`,
  });

  clients.push({
    id: 'chatgpt',
    label: 'ChatGPT',
    detected: true,
    detail: 'connectors are web-managed; instructions only',
  });

  return clients;
}
