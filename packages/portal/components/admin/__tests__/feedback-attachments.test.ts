import { describe, it, expect } from 'vitest';
import {
  attachmentsPayload, droppedAttachmentsWarning, extFromMime, feedbackImagePath,
  validateImageFile, FEEDBACK_MAX_BYTES,
} from '../feedback-attachments';

// Pure helpers behind the portal "Report feedback" widget's paste-a-screenshot flow (issue #28).
// The React wiring (paste/drop/upload) is verified manually; these pin the contract the widget
// relies on: the storage path, the file gate, and the `attachments` payload + drop-warning the SE
// module's api service (issue #16) reports back.

describe('extFromMime', () => {
  it('derives the extension from a MIME type', () => {
    expect(extFromMime('image/png')).toBe('png');
    expect(extFromMime('image/jpeg')).toBe('jpeg');
  });
  it('falls back to png for missing/garbage input', () => {
    expect(extFromMime('')).toBe('png');
    expect(extFromMime('image/')).toBe('png');
  });
  it('strips path-unsafe characters', () => {
    expect(extFromMime('image/svg+xml')).toBe('svgxml');
  });
});

describe('feedbackImagePath', () => {
  it('uses the dedicated se-feedback/ prefix keyed by project', () => {
    expect(feedbackImagePath('proj-1', 'abc', 'png')).toBe('se-feedback/proj-1/abc.png');
  });
  it('sanitises an unsafe project id and defaults a blank one', () => {
    expect(feedbackImagePath('a/../b', 'k', 'png')).toBe('se-feedback/ab/k.png');
    expect(feedbackImagePath('', 'k', 'jpg')).toBe('se-feedback/unknown/k.jpg');
  });
  it('never emits a path-traversal or double-slash segment', () => {
    const p = feedbackImagePath('../../etc', 'k', 'p/n\\g');
    expect(p.startsWith('se-feedback/')).toBe(true);
    expect(p).not.toContain('..');
    expect(p).not.toContain('//');
  });
});

describe('validateImageFile', () => {
  it('accepts an in-bounds image', () => {
    expect(validateImageFile({ type: 'image/png', size: 1000 })).toEqual({ ok: true });
  });
  it('silently ignores non-images (no error message)', () => {
    expect(validateImageFile({ type: 'application/pdf', size: 10 })).toEqual({ ok: false });
    expect(validateImageFile(null)).toEqual({ ok: false });
  });
  it('rejects an oversized image with a user-facing error', () => {
    const r = validateImageFile({ type: 'image/png', size: FEEDBACK_MAX_BYTES + 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large/i);
  });
});

describe('attachmentsPayload', () => {
  it('maps only fully-uploaded items to { url }', () => {
    const atts = [
      { key: '1', name: 'a.png', url: 'https://x/a.png', uploading: false },
      { key: '2', name: 'b.png', url: '', uploading: true }, // still uploading → dropped
    ];
    expect(attachmentsPayload(atts)).toEqual([{ url: 'https://x/a.png' }]);
  });
  it('is empty for no attachments', () => {
    expect(attachmentsPayload([])).toEqual([]);
  });
});

describe('droppedAttachmentsWarning', () => {
  it('returns null when nothing was dropped', () => {
    expect(droppedAttachmentsWarning(0)).toBeNull();
    expect(droppedAttachmentsWarning(undefined)).toBeNull();
  });
  it('warns with the count when the server drops attachments', () => {
    const w = droppedAttachmentsWarning(2);
    expect(w).toContain('2 image(s)');
    expect(w).toMatch(/localhost/);
  });
});
