// @lifecycle canonical - Gate enforcement authority exports.

export { GateEnforcementAuthority } from './gate-enforcement-authority.js';
export { resolveShellVerificationCoverage } from './shell-verification-coverage.js';
export type {
  ActionResult,
  CreateReviewOptions,
  EnforcementMode,
  GateAction,
  GateEnforcementDecision,
  GateEnforcementInput,
  ParsedVerdict,
  PendingGateReview,
  RetryConfig,
  ReviewOutcome,
  ShellVerificationCoverage,
  ShellVerificationCoverageInput,
  ShellVerificationOutcome,
  VerdictSource,
} from './gate-enforcement-types.js';
