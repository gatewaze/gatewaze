// Re-export shim for the canonical CompetitionWinnerService implementation,
// which lives in the competitions module so the schema, service, and admin
// pages stay colocated. The Vite plugin resolves cross-module utils via the
// `@/utils/*` alias at runtime, but TypeScript has no equivalent for cross-
// repo paths — this shim gives the admin app a typed import path while the
// actual code is owned by the module.
export {
  CompetitionWinnerService,
  type CompetitionWinner,
  type WinnerStatus,
} from '../../../../../premium-gatewaze-modules/modules/competitions/admin/utils/competitionWinnerService';
