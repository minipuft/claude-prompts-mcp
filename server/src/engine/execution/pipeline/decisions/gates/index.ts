// @lifecycle canonical - Gate enforcement authority exports.

export { GateEnforcementAuthority } from './gate-enforcement-authority.js';
export { resolveEnforcementMode } from './enforcement-mode.js';
export { resolveShellVerificationCoverage } from './shell-verification-coverage.js';
export type {
  ActionResult,
  CreateReviewOptions,
  EnforcementMode,
  GateAction,
  ParsedVerdict,
  PendingGateReview,
  RetryConfig,
  ReviewOutcome,
  ShellVerificationCoverage,
  ShellVerificationCoverageInput,
  ShellVerificationOutcome,
  VerdictSource,
} from './gate-enforcement-types.js';
