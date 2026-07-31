import fs from 'node:fs';
import type { DetectedClient } from './types.js';
import { claudeDesktopAppInstalled, claudeDesktopConfigPath } from './clients/claude-desktop.js';
import { claudeBinaryPath, claudeSettingsPresent, claudeUserConfigPath } from './clients/claude-code.js';
import { gooseConfigPath } from './clients/goose.js';
import { findOnPath } from './util.js';

export function detectClients(): DetectedClient[] {
  const clients: DetectedClient[] = [];

  const desktopConfig = claudeDesktopConfigPath();
  const desktopConfigFound = fs.existsSync(desktopConfig);
  // Desktop never creates its config file until something writes it — the
  // app installation is the real signal on fresh installs.
  const desktopAppFound = claudeDesktopAppInstalled();
  clients.push({
    id: 'claude-desktop',
    label: 'Claude Desktop',
    detected: desktopConfigFound || desktopAppFound,
    detail: desktopConfigFound
      ? `config at ${desktopConfig}`
      : desktopAppFound
        ? 'app installed, no config yet — one will be created'
        : `not installed (no app, no config at ${desktopConfig})`,
  });

  const claudeBin = claudeBinaryPath();
  // The VS Code extension bundles its own binary (nothing on PATH) but
  // shares ~/.claude.json — settings presence counts as detected.
  const claudeSettings = !claudeBin && claudeSettingsPresent();
  clients.push({
    id: 'claude-code',
    label: 'Claude Code',
    detected: claudeBin !== null || claudeSettings,
    detail: claudeBin
      ? `claude binary at ${claudeBin}`
      : claudeSettings
        ? `settings at ${claudeUserConfigPath()} (VS Code extension?) — will write config directly`
        : 'no claude binary on PATH and no ~/.claude.json',
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
