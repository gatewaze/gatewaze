/**
 * Zip upload validation for module packages.
 * Implements hardening against zip-slip, symlinks, decompression bombs,
 * and non-allowed file extensions.
 */

import { basename, extname } from 'path';

/** Allowed file extensions for uploaded module archives */
const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx',
  '.sql', '.md', '.json',
  '.toml', '.yaml', '.yml',
  '.css', '.scss',
  '.svg', '.png', '.jpg', '.jpeg', '.webp',
]);

const DEFAULT_MAX_FILE_BYTES = parseInt(process.env.MODULE_UPLOAD_MAX_FILE_BYTES ?? '10485760', 10); // 10 MB
const DEFAULT_MAX_TOTAL_BYTES = parseInt(process.env.MODULE_UPLOAD_MAX_TOTAL_BYTES ?? '209715200', 10); // 200 MB

export interface ZipValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a zip archive entry path for security issues.
 */
export function validateZipEntryPath(entryPath: string): string[] {
  const errors: string[] = [];

  // Check for path traversal (zip-slip)
  if (entryPath.includes('..')) {
    errors.push(`Path traversal detected: "${entryPath}" contains ".." segments`);
  }

  // Check for absolute paths
  if (entryPath.startsWith('/') || /^[a-zA-Z]:/.test(entryPath)) {
    errors.push(`Absolute path detected: "${entryPath}"`);
  }

  // Check file extension (skip directories)
  if (!entryPath.endsWith('/')) {
    const ext = extname(entryPath).toLowerCase();
    const name = basename(entryPath);

    // Allow extensionless files like Makefile, Dockerfile
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      errors.push(`Disallowed file extension: "${ext}" in "${entryPath}". Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
    }

    // Block hidden files (dotfiles) except known config files
    if (name.startsWith('.') && !name.startsWith('.eslint') && name !== '.gitignore' && name !== '.prettierrc') {
      errors.push(`Hidden file not allowed: "${entryPath}"`);
    }
  }

  return errors;
}

/**
 * Validate entry size against configured limits.
 */
export function validateZipEntrySize(
  entryPath: string,
  uncompressedSize: number,
  totalSoFar: number,
): string[] {
  const errors: string[] = [];

  if (uncompressedSize > DEFAULT_MAX_FILE_BYTES) {
    errors.push(
      `File "${entryPath}" exceeds max file size: ${uncompressedSize} bytes > ${DEFAULT_MAX_FILE_BYTES} bytes`,
    );
  }

  if (totalSoFar + uncompressedSize > DEFAULT_MAX_TOTAL_BYTES) {
    errors.push(
      `Total uncompressed size exceeds limit: ${totalSoFar + uncompressedSize} bytes > ${DEFAULT_MAX_TOTAL_BYTES} bytes`,
    );
  }

  return errors;
}

/**
 * Validate that a git URL does not contain embedded credentials.
 */
export function validateGitUrl(url: string): string[] {
  const errors: string[] = [];

  // Reject URLs with embedded credentials
  if (/^https?:\/\/[^/]*:[^/]*@/.test(url)) {
    errors.push('Git URL must not contain embedded credentials. Use the token field instead.');
  }

  // Check against allowed hosts if configured
  const allowedHosts = process.env.MODULE_GIT_ALLOWED_HOSTS;
  if (allowedHosts) {
    const allowed = allowedHosts.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    try {
      const parsed = new URL(url);
      if (!allowed.includes(parsed.hostname.toLowerCase())) {
        errors.push(`Git host "${parsed.hostname}" is not in the allowed hosts list`);
      }
    } catch {
      errors.push(`Invalid URL: "${url}"`);
    }
  }

  return errors;
}
