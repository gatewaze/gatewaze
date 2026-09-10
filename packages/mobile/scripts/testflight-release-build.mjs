/**
 * Wait for the newest uploaded build to finish Apple's processing, then
 * attach it to the internal TestFlight group so testers actually see it.
 *
 * Uploading alone is not enough: a build only reaches testers once it is
 * linked to a beta group, and nothing does that automatically.
 *
 * Usage: node scripts/testflight-release-build.mjs <appId> <buildVersion> [groupName]
 * Env:   ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID
 */

import { createSign, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [appId, buildVersion, groupName = 'Internal Testers'] = process.argv.slice(2);
if (!appId || !buildVersion) {
  console.error('usage: testflight-release-build.mjs <appId> <buildVersion> [groupName]');
  process.exit(2);
}

const KEY = readFileSync(process.env.ASC_KEY_PATH, 'utf8');
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

function token() {
  const now = Math.floor(Date.now() / 1000);
  const signing =
    b64({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }) +
    '.' +
    b64({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const sig = cryptoSign('sha256', Buffer.from(signing), {
    key: KEY,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return signing + '.' + sig;
}

async function api(path, init = {}) {
  const res = await fetch('https://api.appstoreconnect.apple.com' + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + token(),
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (body.errors) throw new Error(`${res.status} ${body.errors[0].detail || body.errors[0].title}`);
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Apple takes minutes to ingest; poll rather than assume.
let build;
for (let attempt = 0; attempt < 60; attempt++) {
  const j = await api(`/v1/builds?filter[app]=${appId}&limit=20&sort=-uploadedDate`);
  build = (j.data || []).find((b) => b.attributes.version === String(buildVersion));
  if (build && build.attributes.processingState === 'VALID') break;
  console.log(
    `waiting for build ${buildVersion}… ${build ? build.attributes.processingState : 'not visible yet'}`
  );
  build = undefined;
  await sleep(30_000);
}

if (!build) {
  console.error(`build ${buildVersion} did not become VALID in time — check App Store Connect`);
  process.exit(1);
}

// The Info.plist declares encryption compliance, but an older build or a
// changed plist can still leave it unanswered, which blocks testers.
if (build.attributes.usesNonExemptEncryption === null) {
  await api(`/v1/builds/${build.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: { type: 'builds', id: build.id, attributes: { usesNonExemptEncryption: false } },
    }),
  });
  console.log('export compliance answered');
}

const groups = await api(`/v1/apps/${appId}/betaGroups?limit=50`);
const group = (groups.data || []).find((g) => g.attributes.name === groupName);
if (!group) {
  console.error(`beta group "${groupName}" not found — create it once in App Store Connect`);
  process.exit(1);
}

await api(`/v1/betaGroups/${group.id}/relationships/builds`, {
  method: 'POST',
  body: JSON.stringify({ data: [{ type: 'builds', id: build.id }] }),
});

console.log(`build ${buildVersion} is VALID and released to "${groupName}"`);
