# CSP Enforcement Promotion

**Spec ref:** [§5.11](../../../gatewaze-environments/specs/spec-production-readiness-hardening.md)
**Status:** report-only

## Current state

The API ships with `helmet` mounted but `contentSecurityPolicy: false`
— spec §7.2 task 2.9 chose this to avoid breaking the admin/portal
during phase 2. CSP report-only is configured at the edge (Traefik /
CDN) per brand.

## Promotion criteria

Per spec §7.4 task 4.15, CSP is promoted from report-only to
**enforced** only after **14 consecutive days** of zero violations
in staging. The change is intentionally operator-driven, not a
code-time flip — every brand's edge configuration is different and
the promotion timing depends on real-world traffic.

## Procedure

1. Watch the CSP-report endpoint (Sentry / GlitchTip ingestion) in
   staging for 14 days.
2. If violation count is 0:
   - Edge: change `Content-Security-Policy-Report-Only:` →
     `Content-Security-Policy:` for the staging brand.
   - Soak 7 more days.
   - Repeat for production brand.
3. If violations appear:
   - Inspect each violation; either narrow the directive (legitimate
     resource that should be allowed) or fix the offending code
     (genuine inline script that should use a nonce).
   - Reset the 14-day clock.

## Why not flip in code

The Helm chart could ship a CSP middleware in the API today. The
reason it doesn't:

- Edge enforcement (Traefik / CDN) is closer to the request and
  doesn't require a redeploy to tune.
- Every brand has a different mix of analytics/marketing scripts; a
  one-size-fits-all CSP from the API would either be too permissive
  (no real protection) or too restrictive (breaks brand pages).

## Tracked

This runbook is the canonical procedure. When the first brand
completes the 14+7 day soak, link the CSP header config (helm value
or edge config) here so subsequent brands have a working template.
