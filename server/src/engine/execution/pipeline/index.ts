// @lifecycle canonical - Barrel exports for execution pipeline and stages.

// Core pipeline infrastructure
export { PromptExecutionPipeline } from './prompt-execution-pipeline.js';
export { BasePipelineStage, type PipelineStage } from './stage.js';

// Stages 01-03: Initialization
export { RequestNormalizationStage } from './stages/01-request-normalization-stage.js';
export { ExecutionLifecycleStage } from './stages/02-execution-lifecycle-stage.js';
export { IdentityResolutionStage } from './stages/03-identity-resolution-stage.js';

// Stages 04-09: Parsing, Planning, Scripts
export { CommandParsingStage } from './stages/04-parsing-stage.js';
export { InlineGateExtractionStage } from './stages/05-inline-gate-stage.js';
export { OperatorValidationStage } from './stages/06-operator-validation-stage.js';
export { ExecutionPlanningStage } from './stages/07-planning-stage.js';
export { ScriptExecutionStage } from './stages/08-script-execution-stage.js';
export { ScriptAutoExecuteStage } from './stages/09-script-auto-execute-stage.js';

// Stages 10-15: Judge, Gates, Framework, Session, Injection
export { GateEnhancementStage } from './stages/11-gate-enhancement-stage.js';
export { FrameworkResolutionStage } from './stages/12-framework-stage.js';
export { JudgeSelectionStage } from './stages/10-judge-selection-stage.js';
export { PromptGuidanceStage } from './stages/15-prompt-guidance-stage.js';
export { SessionManagementStage } from './stages/13-session-stage.js';
export { InjectionControlStage } from './stages/14-injection-control-stage.js';

// Stages 16-22: Capture, Execution, Review, Formatting
export { StepResponseCaptureStage } from './stages/16-response-capture-stage.js';
export { createShellVerificationStage } from './stages/17-shell-verification-stage.js';
export { StepExecutionStage } from './stages/18-execution-stage.js';
export {
  createPhaseGuardVerificationStage,
  PHASE_GUARD_GATE_ID,
} from './stages/19-phase-guard-verification-stage.js';
export { GateReviewStage } from './stages/20-gate-review-stage.js';
export { ResponseFormattingStage } from './stages/21-formatting-stage.js';
export { PostFormattingCleanupStage } from './stages/22-post-formatting-cleanup-stage.js';
