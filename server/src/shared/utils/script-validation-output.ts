// @lifecycle canonical - Reads the validation protocol a script tool speaks on stdout.
/**
 * Script validation-output protocol.
 *
 * A tool declaring `execution.autoApproveOnValid` approves itself by what it prints:
 * `{ valid: boolean, warnings?: string[], errors?: string[] }` on stdout. This module owns
 * reading that shape and nothing else.
 *
 * It is NOT on `ToolTriggerFilter`. Tier 8 F4 grouped the partitioning and the approve/block
 * policy together as one extension of the filter, but they answer different questions: the
 * filter decides *which path a tool takes*, while this decides *what a script said*. A
 * stdout protocol on a trigger/confirmation service would give that service a second domain.
 *
 * It sits at the shared layer rather than beside the executor in `modules/automation/`,
 * where the domain would otherwise put it, because its consumer is a pipeline stage and
 * `validate:arch`'s `engine-no-modules-or-mcp-value` forbids the engine importing values
 * from `modules/`. The filter escapes that only by arriving through an injected port, which
 * is over-wiring for one pure function. `ScriptExecutionResult` is itself a shared type, so
 * a pure reader of it belongs at the same layer as the type it reads.
 *
 * A pure function rather than a class: it holds no state, performs no I/O, and reads one
 * value. `architecture.md` imports pure functions directly instead of injecting them.
 */

import type { ScriptExecutionResult } from '../types/index.js';

/** What a script tool reported about its own inputs. */
export interface ScriptValidationOutcome {
  readonly valid: boolean;
  readonly warnings: string[];
  readonly errors: string[];
}

/**
 * Read a script's validation verdict from its output.
 *
 * The JSON output is consulted **before** the exit code, and deliberately so: a validation
 * script conventionally exits non-zero when validation fails while still printing the
 * detailed reasons. Reading the exit code first would replace those reasons with a generic
 * failure message, which is the diagnostic the operator actually needs.
 *
 * Absent parseable output there is nothing to trust, so both remaining paths refuse: a
 * failed execution reports its own error, and a successful run that printed nothing usable
 * is not treated as approval.
 */
export function interpretScriptValidationOutput(
  result: ScriptExecutionResult
): ScriptValidationOutcome {
  const output = result.output as Record<string, unknown> | null;

  if (output !== null && typeof output === 'object') {
    const valid = output['valid'] === true;
    const warnings = Array.isArray(output['warnings']) ? (output['warnings'] as string[]) : [];
    const errors = Array.isArray(output['errors'])
      ? (output['errors'] as string[])
      : valid
        ? []
        : ['Validation failed'];

    return { valid, warnings, errors };
  }

  if (!result.success) {
    return {
      valid: false,
      warnings: [],
      errors: [result.error ?? `Script execution failed with exit code ${result.exitCode}`],
    };
  }

  return { valid: false, warnings: [], errors: ['Script did not return valid JSON output'] };
}
