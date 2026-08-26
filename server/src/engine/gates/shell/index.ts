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

// `shell-command-allowlist.js` is deliberately NOT re-exported here. Its only
// production consumer is the executor beside it, which imports it directly, and
// widening the barrel would add exports nothing reads.

// Message formatting services (extracted from ShellVerificationStage)
export type {
  GateShellVerifyResult,
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
  formatGateShellVerifySection,
} from './shell-verify-message-formatter.js';

// State file management for Stop hook integration
export type { VerifyActiveStateStoreConfig } from './verify-active-state-store.js';
export {
  VerifyActiveStateStore,
  createVerifyActiveStateStore,
} from './verify-active-state-store.js';
