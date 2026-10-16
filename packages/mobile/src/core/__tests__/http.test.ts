/**
 * issue #104: a HELF barcode-scan failure surfaced the raw string "HTTP 404"
 * to the member instead of a usable message. The root cause was defense-in-
 * depth gap in the shared mobile API client (not health-diet specifically):
 * parseErrorBody's fallback for a response that doesn't match the
 * `{ error: { message, code } }` / `{ error: string }` contract was a
 * literal `HTTP ${status}` string, which every module's apiFetch call could
 * surface verbatim via humanMessage()'s 'client' branch.
 *
 * parseErrorBody now lives in ../errors (not ../http) specifically so it can
 * be imported here without pulling in http.ts's React Native-dependent
 * transitive imports (./config, ./outbox, ./auth/supabase) — those don't
 * transform under a plain Node + tsx test run, only under Metro/Babel.
 * parseErrorBody itself has no such dependency, so this is a clean,
 * standalone unit test of pure logic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiFailure, failureFromStatus, parseErrorBody } from '../errors';

test('a body matching { error: { message, code } } is returned unchanged', () => {
  const result = parseErrorBody({ error: { message: 'That barcode is not in the food database.', code: 'not_found' } });
  assert.deepEqual(result, { message: 'That barcode is not in the food database.', code: 'not_found' });
});

test('a body matching { error: { message } } with no code omits code rather than inventing one', () => {
  const result = parseErrorBody({ error: { message: 'Too many lookups.' } });
  assert.deepEqual(result, { message: 'Too many lookups.', code: undefined });
});

test('a body matching { error: "a string" } is returned unchanged', () => {
  const result = parseErrorBody({ error: 'Session expired' });
  assert.deepEqual(result, { message: 'Session expired' });
});

test('an unrecognised shape (flat object) falls back to a generic, non-technical message', () => {
  const result = parseErrorBody({ foo: 'bar' });
  assert.ok(!/^HTTP \d+$/.test(result.message), 'must not be the raw "HTTP <status>" string');
  assert.ok(!/\b\d{3}\b/.test(result.message), 'must not contain a bare numeric status code');
  assert.equal(result.code, undefined);
});

test('an empty object falls back to the same generic message', () => {
  const result = parseErrorBody({});
  assert.ok(!/^HTTP \d+$/.test(result.message));
});

test('a non-object body (e.g. an unparsed/non-JSON response) falls back to the generic message', () => {
  for (const body of [undefined, null, 'plain text body', 42, true]) {
    const result = parseErrorBody(body);
    assert.ok(!/^HTTP \d+$/.test(result.message), `body=${JSON.stringify(body)} must not surface a raw status string`);
  }
});

test('end-to-end: an unrecognised body still produces an ApiFailure carrying the real status, even though the message is generic', () => {
  const { message, code } = parseErrorBody({ foo: 'bar' });
  const failure = failureFromStatus(404, message, code);
  assert.ok(failure instanceof ApiFailure);
  assert.equal(failure.status, 404, 'status must survive for programmatic use even when the message is generic');
  assert.ok(!/^HTTP 404$/.test(failure.message));
  assert.ok(!failure.message.includes('404'), 'the user-facing message must not contain the raw status code');
});

test('end-to-end: a well-formed error envelope still carries its own message and code through to the ApiFailure (no regression)', () => {
  const { message, code } = parseErrorBody({ error: { message: 'That barcode is not in the food database.', code: 'not_found' } });
  const failure = failureFromStatus(404, message, code);
  assert.equal(failure.message, 'That barcode is not in the food database.');
  assert.equal(failure.code, 'not_found');
  assert.equal(failure.status, 404);
});
