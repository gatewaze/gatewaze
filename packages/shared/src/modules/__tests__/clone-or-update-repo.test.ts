import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { cloneOrUpdateRepo } from '../loader.js';

// Real git against a local "remote", no network. The case that matters is a
// force-pushed branch: the image's build-time checkout shares no history with
// the new tip, and the cache must still end up on it.

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

let root: string;
let work: string;
let remoteUrl: string;
let projectRoot: string;

function commit(file: string, body: string, message: string) {
  writeFileSync(join(work, file), body);
  git(work, 'add', file);
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gw-clone-'));
  const bare = join(root, 'remote.git');
  work = join(root, 'work');
  projectRoot = join(root, 'project');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(root, 'init', '-q', '-b', 'main', work);
  git(work, 'remote', 'add', 'origin', bare);
  commit('module.txt', 'v1', 'first');
  git(work, 'push', '-q', 'origin', 'main');
  remoteUrl = `file://${bare}`;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const cached = (dir: string) => readFileSync(join(dir, 'module.txt'), 'utf8');

describe('cloneOrUpdateRepo', () => {
  it('clones on first use', () => {
    const dir = cloneOrUpdateRepo(remoteUrl, 'main', projectRoot);
    expect(dir).toBeTruthy();
    expect(cached(dir!)).toBe('v1');
  });

  it('moves the cache to a new commit on the branch', () => {
    const dir = cloneOrUpdateRepo(remoteUrl, 'main', projectRoot)!;
    commit('module.txt', 'v2', 'second');
    git(work, 'push', '-q', 'origin', 'main');
    expect(cloneOrUpdateRepo(remoteUrl, 'main', projectRoot)).toBe(dir);
    expect(cached(dir)).toBe('v2');
  });

  it('follows a force-pushed branch whose history no longer contains the cached commit', () => {
    const dir = cloneOrUpdateRepo(remoteUrl, 'main', projectRoot)!;
    // Rewrite history: an orphan branch with different content replaces main.
    git(work, 'checkout', '-q', '--orphan', 'rewritten');
    commit('module.txt', 'rewritten', 'rewritten root');
    git(work, 'push', '-q', '--force', 'origin', 'rewritten:main');

    cloneOrUpdateRepo(remoteUrl, 'main', projectRoot);
    expect(cached(dir)).toBe('rewritten');
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(git(work, 'rev-parse', 'HEAD'));
  });

  it('follows the default branch when no branch is configured', () => {
    const dir = cloneOrUpdateRepo(remoteUrl, undefined, projectRoot)!;
    commit('module.txt', 'v2', 'second');
    git(work, 'push', '-q', 'origin', 'main');
    cloneOrUpdateRepo(remoteUrl, undefined, projectRoot);
    expect(cached(dir)).toBe('v2');
  });

  it('keeps serving the cache and warns when the remote cannot be reached', () => {
    const dir = cloneOrUpdateRepo(remoteUrl, 'main', projectRoot)!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rmSync(join(root, 'remote.git'), { recursive: true, force: true });

    expect(cloneOrUpdateRepo(remoteUrl, 'main', projectRoot)).toBe(dir);
    expect(cached(dir)).toBe('v1');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('serving the cached checkout'));
  });

  it('never logs a token from the remote URL', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = 'https://github.invalid/acme/private.git';
    expect(cloneOrUpdateRepo(url, 'main', projectRoot, 'ghp_secrettoken123')).toBeNull();
    const logged = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('Failed to clone');
    expect(logged).not.toContain('ghp_secrettoken123');
  });
});
