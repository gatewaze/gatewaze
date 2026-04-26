#!/usr/bin/env node
/**
 * CI check: validates every module's listing schemas per
 * spec-platform-listing-pattern.md §10 + §20.4.
 *
 * Walks `gatewaze-modules/` + sibling `*-gatewaze-modules/` repos,
 * imports each `listing-schema.ts` via tsx, and asserts:
 *
 *  1. Every column declared in `sortable` / `searchable` / `filters[*]`
 *     also appears in `indexedColumns`.
 *  2. No column on the PII denylist appears in publicApi / mcp / portal
 *     projections (unless there's a matching piiExposureAcknowledgement
 *     with a future `reviewByDate`).
 *  3. authFilters required for non-empty publicApi / portal projections.
 *
 * Exits 1 on any violation. Run from CI before merging schema changes.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());

async function main() {
  const moduleDirs = discoverModuleDirs();
  let violations = 0;

  for (const dir of moduleDirs) {
    const schemaPath = join(dir, 'listing-schema.ts');
    if (!existsSync(schemaPath)) continue;

    const moduleId = dir.split('/').pop();
    let mod;
    try {
      mod = await import(pathToFileURL(schemaPath).href);
    } catch (err) {
      console.error(`✗ ${moduleId}: failed to import listing-schema.ts: ${err.message}`);
      violations++;
      continue;
    }

    const schema = mod.eventsListingSchema || mod.default || Object.values(mod)[0];
    if (!schema || !schema.id) {
      console.error(`✗ ${moduleId}: listing-schema.ts has no exported schema`);
      violations++;
      continue;
    }

    violations += validateSchema(moduleId, schema);
  }

  if (violations > 0) {
    console.error(`\n${violations} listing-schema violation(s). Fix before merging.`);
    process.exit(1);
  } else {
    console.log(`\n✓ All listing schemas valid (${moduleDirs.length} module(s) scanned).`);
  }
}

function discoverModuleDirs() {
  const out = [];
  // Look in this repo's sibling .gatewaze-modules/* tree if present
  // (used by Vite's plugin), and also the directly-mounted sibling
  // repos in CI: ../*-gatewaze-modules/modules/<mod>/.
  const parentDir = resolve(ROOT, '..');
  if (existsSync(parentDir)) {
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (
        entry.name !== 'gatewaze-modules' &&
        !entry.name.endsWith('-gatewaze-modules')
      ) continue;
      const modulesDir = join(parentDir, entry.name, 'modules');
      if (!existsSync(modulesDir)) continue;
      for (const sub of readdirSync(modulesDir, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        if (sub.name.startsWith('_')) continue;
        out.push(join(modulesDir, sub.name));
      }
    }
  }
  return out;
}

function validateSchema(moduleId, schema) {
  let v = 0;
  const fail = (msg) => { console.error(`✗ ${moduleId}/${schema.id}: ${msg}`); v++; };

  // 1. indexedColumns coverage
  const indexed = new Set(schema.indexedColumns ?? []);
  for (const [k, dbCol] of Object.entries(schema.sortable ?? {})) {
    if (!indexed.has(dbCol)) {
      fail(`sortable.${k} → '${dbCol}' is not in indexedColumns`);
    }
  }
  for (const col of schema.searchable ?? []) {
    if (!indexed.has(col)) fail(`searchable.${col} is not in indexedColumns`);
  }
  for (const [k, decl] of Object.entries(schema.filters ?? {})) {
    if (!indexed.has(decl.column)) fail(`filters.${k} → '${decl.column}' is not in indexedColumns`);
  }
  for (const col of schema.distinctableColumns ?? []) {
    if (!indexed.has(col)) fail(`distinctableColumns.${col} is not in indexedColumns`);
  }

  // 2. PII denylist
  // Inline a copy here to avoid importing TS into a plain mjs CI script.
  const PII = new Set([
    'email','email_address','personal_email','work_email','phone','phone_number',
    'mobile','ssn','social_security_number','tax_id','date_of_birth','dob',
    'home_address','street_address','address_line_1','address_line_2','postal_code',
    'zip_code','credit_card','credit_card_number','cc_number','cvv','iban',
    'bank_account','passport_number','driver_license','national_id','ip_address',
    'password','password_hash','api_key_secret','api_token','access_token',
    'refresh_token','session_token','auth_token','private_key','two_factor_secret',
    'mfa_secret',
  ]);

  const ackMap = new Map();
  for (const ack of schema.piiExposureAcknowledgements ?? []) {
    if (Date.parse(ack.reviewByDate) < Date.now()) {
      fail(`piiExposureAcknowledgement for '${ack.column}' (consumer=${ack.consumer}) reviewByDate is in the past — re-review`);
    }
    ackMap.set(`${ack.column}|${ack.consumer}`, ack);
  }

  for (const consumer of ['publicApi', 'mcp', 'portal']) {
    const items = schema.projections?.[consumer] ?? [];
    for (const item of items) {
      const col = typeof item === 'string'
        ? item
        : item.col ?? item.fkLookup?.fkColumn ?? null;
      if (!col) continue;
      const lower = col.toLowerCase();
      if (PII.has(lower) && !ackMap.has(`${col}|${consumer}`)) {
        fail(`projections.${consumer} exposes PII column '${col}' without a piiExposureAcknowledgement`);
      }
    }
  }

  // 3. authFilters required when projection non-empty for publicApi/portal
  for (const consumer of ['publicApi', 'portal']) {
    const items = schema.projections?.[consumer] ?? [];
    if (items.length > 0 && !schema.authFilters?.[consumer]) {
      fail(`projections.${consumer} non-empty but authFilters.${consumer} is missing — fail-closed required`);
    }
  }

  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
