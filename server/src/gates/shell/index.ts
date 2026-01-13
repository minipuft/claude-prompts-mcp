// @lifecycle canonical - Shell verification gate module exports.
/**
 * Shell Verification Gates Module
 *
 * Exports types and services for shell-based verification gates
 * that enable ground-truth validation via command execution.
 */

export type {
  ShellVerifyGate,
  ShellVerifyResult,
  PendingShellVerification,
  ShellVerifyExecutorConfig,
  VerifyActiveState,
} from './types.js';

export { SHELL_OUTPUT_MAX_CHARS, SHELL_VERIFY_DEFAULT_MAX_ITERATIONS } from './types.js';

export {
  ShellVerifyExecutor,
  createShellVerifyExecutor,
  getDefaultShellVerifyExecutor,
  resetDefaultShellVerifyExecutor,
} from './shell-verify-executor.js';

// Message formatting services (extracted from ShellVerificationStage)
export type {
  ShellVerifyFeedback,
  ShellVerifyFeedbackType,
} from './shell-verify-message-formatter.js';
export {
  truncateForDisplay,
  extractErrorOutput,
  formatBounceBackMessage,
  formatEscalationMessage,
  createBounceBackFeedback,
  createEscalationFeedback,
} from './shell-verify-message-formatter.js';

// State file management for Stop hook integration
export type { VerifyActiveStateManagerConfig } from './verify-active-state-manager.js';
export {
  VerifyActiveStateManager,
  createVerifyActiveStateManager,
} from './verify-active-state-manager.js';
