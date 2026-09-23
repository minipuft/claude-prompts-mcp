// @lifecycle canonical - Gate enforcement authority exports.

export { GateEnforcementAuthority } from './gate-enforcement-authority.js';
export { resolveEnforcementMode } from './enforcement-mode.js';
export { resolveGroundTruthCoverage } from './ground-truth-coverage.js';
export { advanceReview } from './review-lifecycle.js';
export type { ReviewAdvance, ReviewEvent, ReviewRefusal } from './review-lifecycle.js';
export { resolveReviewTarget } from './review-target.js';
export type { ReviewTarget, ReviewTargetInput } from './review-target.js';
export type {
  ActionResult,
  CreateReviewOptions,
  EnforcementMode,
  GateSetEnforcement,
  GateAction,
  ParsedVerdict,
  PendingGateReview,
  RetryConfig,
  ReviewOutcome,
  GroundTruthCoverage,
  GroundTruthCoverageInput,
  GroundTruthOutcome,
  VerdictSource,
} from './gate-enforcement-types.js';
