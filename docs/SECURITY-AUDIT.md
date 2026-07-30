# Gatewaze security audit — OpenSSF Baseline + SLSA

Date: 2026-07-29. Scope of this pass: `gatewaze/gatewaze` (this monorepo), with
the portable controls replicated to `gatewaze-modules`, `lf-gatewaze-modules`,
and `lf-agents`. Frameworks: OpenSSF Security Baseline (project hygiene) and
SLSA (build/supply-chain provenance).

This report states where we were, what changed in this pass, and what still
needs a human (credential rotation and GitHub org settings).

---

## 1. Top priorities (do these first)

0. **ROTATE the `GW_API_BEARER` token now — it was live in public source.** A
   single shared bearer secret (`YYv8…`, a real working default) was hardcoded
   as an env fallback — `Deno.env.get('GW_API_BEARER') || '<token>'` — and used
   to authenticate *incoming* requests to several edge functions. It was
   committed and publicly visible in the open-source `gatewaze-modules` repo,
   and present in this monorepo and `lf-gatewaze-modules` history. The default
   gitleaks ruleset did not catch it; a custom `env-fallback-secret` rule now
   does. **The hardcoded fallback has been removed from all current-tree files
   and the auth checks now fail closed when the env var is unset** (see §6), but
   the leaked value must still be rotated and `GW_API_BEARER` must be set in
   every deployment before those functions are redeployed.
   - Fixed in tree: `supabase/functions/people-enrichment/index.ts`;
     `gatewaze-modules` people-enrichment, bigquery-proxy, customerio track-event.
   - History only: `lf-gatewaze-modules` `modules/onboarding/api/sessions.ts`.

1. **Rotate two credentials that reached git history.** The current tree is
   clean, but two real secrets were committed and later removed — they still
   live in history and must be treated as compromised. See §2.
   - `VAPID_PRIVATE_KEY` for Supabase projects `qjzldk…obfc` and `wdewqt…nlhp`
     (the old MLOps project) — committed in `8e0ea6b` (2026-03-20) inside
     `supabase/functions/email-send-push/README.md`.
   - `SECRET_KEY_BASE` values in `docker/.env.aaif` / `.env.mlops` /
     `.env.techtickets` (and their `.example` copies) — committed in `1c0f23a`
     (2026-03-18).
2. **Confirm the GitHub org settings that can't be set from disk.** Branch
   protection on `main`, required reviews, required status checks, MFA
   enforcement, and "Private vulnerability reporting". See §5.
3. **Merge this branch** so the committed controls (secret scanning, SHA-pinned
   actions, least-privilege workflows, SLSA provenance, CodeQL, the pre-push
   gate, and the agent rulebook) start protecting every clone and every push.

---

## 2. Secret scan (gitleaks)

Tooling added: `.gitleaks.toml`, `scripts/security/gitleaks-scan.sh` (shared by
the hook and CI), `.github/workflows/gitleaks.yml`, and a blocking
`.husky/pre-push` hook.

**Current committed tree (HEAD): clean — zero real secrets.** A full scan of the
`HEAD` tree reports 0 findings after allowlisting known false positives.

**Git history (1314 commits): 45 raw hits, triaged as follows.**

| Category | Count | Verdict |
|---|---|---|
| `jwt` — Supabase `supabase-demo` keys | 30 | Benign. Public demo keys from Supabase's self-host docs (`iss: supabase-demo`); they only sign against a local demo instance. |
| `linkedin-client-id` / `linkedin-client-secret` | 6 | False positives. Matched our own symbol names (`linkedinUrl`, `validateLinkedInUrlExists`) and import lines, not credentials. |
| `curl-auth-header` | 1 | False positive. A `localhost:54321` example in a README. |
| `generic-api-key` — `VAPID_PRIVATE_KEY` in README | 2 | **Real.** Rotate (see §1). |
| `generic-api-key` — `SECRET_KEY_BASE` in `docker/.env.*` | 6 | **Real.** Rotate (see §1). |

Notes:
- All false positives are allowlisted in `.gitleaks.toml` (demo-key regex +
  identifier stopwords), so CI and the hook stay green without hiding real
  secrets.
- **Rotation neutralises the exposure regardless of history**, and the `HEAD`
  tree is already clean, so a history rewrite is **optional**. If you do want to
  purge history, use `git filter-repo` / BFG and force-push — but verify remote
  state first (fetch + `gh api`), coordinate the rewrite across all forks/clones,
  and do it before the Linux Foundation handover, not after. Given the cost of a
  rewrite and that rotation already closes the risk, rewriting is a judgement
  call, not a requirement.

---

## 3. OpenSSF Baseline / hygiene — gaps and fixes

Legend: ✅ present before this pass · 🆕 added in this pass · 🔲 needs a human
(org setting or rotation).

| Control | `gatewaze/gatewaze` | Notes |
|---|---|---|
| `LICENSE` / `NOTICE` | ✅ | Apache-2.0. |
| `CONTRIBUTING.md` / CLA | ✅ | CLA bot + DCO flow documented. |
| `SECURITY.md` (disclosure path) | 🆕 | GitHub private advisory + email placeholder. Fill the email before publishing. |
| `CODEOWNERS` | 🆕 | Security-critical paths routed to `@gatewaze/maintainers` + `@gatewaze/security`. Create those teams (or swap to real handles). |
| Dependabot | 🆕 | npm + github-actions + docker ecosystems. |
| CodeQL / SAST | 🆕 | `codeql.yml`, `security-extended` queries, weekly + PR. Complements the existing `pnpm audit`, `eslint`, and shell-call audit. |
| OpenSSF Scorecard | 🆕 | `scorecard.yml`, weekly, publishes to the Security tab. |
| Secret scanning | 🆕 | gitleaks in CI + blocking pre-push hook. |
| Actions pinned to SHA | 🆕 | Every action across all workflows pinned to a commit SHA (was floating `@vN`). |
| Least-privilege `permissions:` | 🆕 | Top-level `contents: read` everywhere; jobs grant up only as needed (`pr.yml` had no block at all). |
| Signed / provenance releases | 🆕 | See §4. |
| Secrets not committed | ✅ / 🔲 | `.env.example` only in the current tree; real secrets are git-ignored. History rotation pending (§1). |
| Branch protection / required reviews / MFA | 🔲 | Org settings — verify in GitHub. See §5. |

Existing strengths worth keeping: `pr.yml` already runs typecheck, lint, vitest,
`pnpm audit --audit-level=high`, a custom shell-call audit, and pgTAP RLS tests;
a husky `pre-commit` runs `lint-staged`.

---

## 4. SLSA — per-workflow build provenance

| Workflow | Artifact | Before | After this pass | Path to L3 |
|---|---|---|---|---|
| `release.yml` (images) | 7 container images → GHCR | L0/L1 (no provenance) | **L2** — `actions/attest-build-provenance` per image, keyless (Sigstore/Fulcio), pushed to GHCR; actions SHA-pinned; least-privilege perms | Move image builds to `slsa-framework/slsa-github-generator` reusable workflow |
| `release.yml` (`@gatewaze/connect`) | npm package | L0 | **L2-ish** — `npm publish --provenance` with `id-token: write` | Native npm provenance is the ceiling here |
| `helm-publish.yml` | Helm chart | L0 | **L2 (OCI copy)** — chart also pushed to `oci://ghcr.io/gatewaze/charts`, cosign keyless-signed + attested. The gh-pages Helm repo (primary consumer path) is unchanged | Add the generator or GPG `helm package --sign` provenance for the gh-pages tarball too |
| `portal-deploy.yml` | Cloudflare Worker deploy | N/A | N/A — deploy, not a consumable artifact. Already `contents: read`. Actions SHA-pinned | Lower priority (deploy, not publish) |
| `pr.yml` | none (CI) | N/A | Least-privilege `contents: read` added; actions SHA-pinned | — |

**Verify image provenance** after the next release:
```bash
gh attestation verify oci://ghcr.io/gatewaze/api:<tag> --owner gatewaze
```

---

## 5. Needs a human — GitHub org / project settings

These can't be read or set from the repo on disk. Verify each in GitHub:

- **Branch protection on `main`:** require PRs, require the CI status checks
  (typecheck, lint, test, audit, shell-audit, pgtap, CodeQL, gitleaks), require
  Code Owner review (activates the new `CODEOWNERS`), disallow force-push.
- **Required reviews:** at least one approving review before merge.
- **Private vulnerability reporting:** enable it (Settings → Code security) so
  the `SECURITY.md` advisory link works.
- **Secret scanning + push protection:** enable GitHub's native secret scanning
  as a second layer beside gitleaks.
- **MFA enforcement** for the org.
- **Teams:** create `@gatewaze/maintainers` and `@gatewaze/security` (or edit
  `CODEOWNERS` to use real handles).
- **`SECURITY.md`:** replace the email placeholder with the confirmed contact.
- **Credential rotation:** §1.

---

## 6. What this pass changed (files)

- `SECURITY.md`, `.github/CODEOWNERS`, `.github/dependabot.yml`
- `.github/workflows/codeql.yml`, `scorecard.yml`, `gitleaks.yml`
- `.github/workflows/{release,helm-publish,pr,portal-deploy}.yml` — SHA pins,
  least-privilege permissions, SLSA attestation, cosign signing, npm provenance
- `.gitleaks.toml`, `scripts/security/gitleaks-scan.sh`, `.husky/pre-push`
- `CLAUDE.md` (per-task security contract), `.claude/rules/*.md` (path-scoped
  rulebook), `.claude/settings.json` (committed plugin wiring)

Reproduce the secret triage locally:
```bash
brew install gitleaks
sh scripts/security/gitleaks-scan.sh --all      # full history
```
