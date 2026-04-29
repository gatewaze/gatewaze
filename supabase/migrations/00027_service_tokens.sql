-- =============================================================================
-- 00027_service_tokens.sql
--
-- Service-to-service authentication tables per spec §6.3 / §5.3.
-- Replaces the static X-Service-Token model with short-lived JWT-style
-- tokens minted by /api/internal/issue-token. The API verifies tokens
-- locally (HS256 signature + exp), and consults
-- service_token_revocations only for the rare revoke-before-exp case.
--
-- Both tables are service-role-only (no RLS policies for authenticated
-- — the deny-all silent pattern from 00025).
-- =============================================================================

-- Issued tokens (audit trail).
CREATE TABLE IF NOT EXISTS public.service_token_issuance (
  jti                  uuid PRIMARY KEY,
  service              text NOT NULL CHECK (service IN ('worker', 'scheduler', 'module-runner')),
  issued_at            timestamptz NOT NULL DEFAULT now(),
  exp                  timestamptz NOT NULL,
  bootstrap_secret_id  text NOT NULL,
  request_ip           inet
);

CREATE INDEX IF NOT EXISTS idx_service_token_issuance_service_issued
  ON public.service_token_issuance(service, issued_at DESC);

ALTER TABLE public.service_token_issuance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_token_issuance_service_role_only"
  ON public.service_token_issuance FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_token_issuance_deny_authenticated"
  ON public.service_token_issuance FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.service_token_issuance IS
  'Audit trail of service-token mintings. service-role only.';

-- Active revocations. Pruned hourly by the scheduler once exp passes.
CREATE TABLE IF NOT EXISTS public.service_token_revocations (
  jti          uuid PRIMARY KEY,
  exp          timestamptz NOT NULL,
  revoked_at   timestamptz NOT NULL DEFAULT now(),
  revoked_by   text NOT NULL,
  reason       text
);

CREATE INDEX IF NOT EXISTS idx_service_token_revocations_exp
  ON public.service_token_revocations(exp);

ALTER TABLE public.service_token_revocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_token_revocations_service_role_only"
  ON public.service_token_revocations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_token_revocations_deny_authenticated"
  ON public.service_token_revocations FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.service_token_revocations IS
  'Active service-token revocations. Pruned hourly when exp passes.';
