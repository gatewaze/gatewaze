# Security Policy

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.

Report a vulnerability privately in one of these ways:

1. **GitHub private vulnerability reporting (preferred).** Open the
   [Security tab](https://github.com/gatewaze/gatewaze/security/advisories/new)
   of this repository and choose "Report a vulnerability". This creates a
   private advisory that only maintainers can see.
2. **Email.** Send details to the security contact for the project.
   <!-- MAINTAINERS: replace with the confirmed disclosure address, e.g.
        security@gatewaze.io, before publishing this file. -->

Please include as much of the following as you can:

- The component and version or commit affected (admin, api, portal, worker,
  a module, the Helm chart, a container image, or the CDN worker).
- A description of the issue and its impact.
- Steps to reproduce, a proof of concept, or the affected code path.
- Any suggested remediation.

## What to expect

- We aim to acknowledge a report within 3 business days.
- We will confirm the issue, work on a fix, and keep you updated on progress.
- We will credit you in the advisory unless you ask us not to.
- Please give us a reasonable time to release a fix before any public
  disclosure. We follow coordinated disclosure.

## Supported versions

We provide security fixes for the latest released version. Because Gatewaze
ships as a rolling set of container images and a Helm chart, "supported" means
the most recent `vX.Y.Z` release tag and the `latest` image tags built from it.

## Scope

In scope:

- The application code in this repository (admin, api, portal, worker,
  scheduler, shared, MCP, connect).
- The container images published to `ghcr.io/gatewaze/*`.
- The Helm chart in `helm/gatewaze`.
- Supabase edge functions and database migrations in `supabase/`.

Out of scope:

- Vulnerabilities in third-party dependencies that have no exploitable path in
  Gatewaze. Report those upstream; tell us if Gatewaze is affected.
- Findings that require a compromised operator account or physical access.
- Reports generated solely by automated scanners with no demonstrated impact.

## Handling of secrets

If your report involves a leaked credential (an API key, token, or password),
tell us immediately and do not use it. We rotate exposed credentials as a first
step. This repository runs secret scanning in CI and a blocking pre-push hook to
reduce the chance of a secret reaching the remote; if you find one that slipped
through, it is in scope.
