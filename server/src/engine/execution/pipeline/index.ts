// @lifecycle canonical - Barrel exports for execution pipeline and stages.

// Core pipeline infrastructure
export { PromptExecutionPipeline } from './prompt-execution-pipeline.js';
export { BasePipelineStage, type PipelineStage } from './stage.js';

// Stage 00: Initialization
export { RequestNormalizationStage } from './stages/00-request-normalization-stage.js';
export { ExecutionLifecycleStage } from './stages/00-execution-lifecycle-stage.js';
export { IdentityResolutionStage } from './stages/00-identity-resolution-stage.js';

// Stage 01-04: Parsing and Planning
export { CommandParsingStage } from './stages/01-parsing-stage.js';
export { InlineGateExtractionStage } from './stages/02-inline-gate-stage.js';
export { OperatorValidationStage } from './stages/03-operator-validation-stage.js';
export { ExecutionPlanningStage } from './stages/04-planning-stage.js';
export { ScriptExecutionStage } from './stages/04b-script-execution-stage.js';
export { ScriptAutoExecuteStage } from './stages/04c-script-auto-execute-stage.js';

// Stage 05-07: Enhancement and Session
export { GateEnhancementStage } from './stages/05-gate-enhancement-stage.js';
export { FrameworkResolutionStage } from './stages/06-framework-stage.js';
export { JudgeSelectionStage } from './stages/06a-judge-selection-stage.js';
export { PromptGuidanceStage } from './stages/06b-prompt-guidance-stage.js';
export { SessionManagementStage } from './stages/07-session-stage.js';
export { InjectionControlStage } from './stages/07b-injection-control-stage.js';

// Stage 08-12: Execution and Formatting
export { StepResponseCaptureStage } from './stages/08-response-capture-stage.js';
export { createShellVerificationStage } from './stages/08b-shell-verification-stage.js';
export { StepExecutionStage } from './stages/09-execution-stage.js';
export {
  createPhaseGuardVerificationStage,
  PHASE_GUARD_GATE_ID,
} from './stages/09b-phase-guard-verification-stage.js';
export { GateReviewStage } from './stages/10-gate-review-stage.js';
export { ResponseFormattingStage } from './stages/10-formatting-stage.js';
export { PostFormattingCleanupStage } from './stages/12-post-formatting-cleanup-stage.js';
