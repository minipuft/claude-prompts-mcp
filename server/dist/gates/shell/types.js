// @lifecycle canonical - Shell verification gate type definitions for Ralph Wiggum loops.
/**
 * Shell Verification Gate Types
 *
 * Type definitions for shell-based verification gates that enable
 * "Ralph Wiggum" style autonomous loops where Claude's work is validated
 * by real shell command execution (ground truth) rather than LLM self-evaluation.
 *
 * @see plans/ralph-style-loop.md for the implementation plan
 */
/**
 * Maximum characters to include from command output.
 * Large outputs are truncated to prevent context overflow.
 */
export const SHELL_OUTPUT_MAX_CHARS = 5000;
/**
 * Default max iterations for autonomous loops.
 */
export const SHELL_VERIFY_DEFAULT_MAX_ITERATIONS = 10;
//# sourceMappingURL=types.js.map