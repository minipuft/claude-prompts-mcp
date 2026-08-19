// @lifecycle canonical - Runs one script_tool gate criterion. Single encoding for both callers.
/**
 * Script-tool criterion runner.
 *
 * ONE encoding of "what does a `script_tool` criterion mean", with two projections:
 * `GateValidator` maps the outcome to a `ValidationCheck`, and the gate-review runner
 * maps it to a review-feedback row. Writing the rule twice is how the two paths would
 * drift into enforcing different contracts for the same criteria type — the shape this
 * subsystem has already produced once, between the declarative `tools:` route and the
 * inline `{{script:id}}` route.
 *
 * `script_tool_id` names a REGISTERED TOOL, never a command. The id is resolved against
 * the script-tool registry; it never reaches a shell.
 */

import type { LoadedScriptTool, ScriptExecutorPort } from '#shared/types/index.js';
import type { ScriptLoader } from '../../execution/reference/script-reference-resolver.js';
import type { GatePassCriteria } from '../types/gate-primitives.js';

/**
 * The registry and executor a `script_tool` criterion needs.
 *
 * Both are the same instances the inline `{{script:id}}` path uses, injected as ports
 * because `engine/` may not value-import `modules/`.
 */
export interface ScriptToolRuntime {
  loader: ScriptLoader;
  executor: ScriptExecutorPort;
}

/**
 * Read lazily rather than captured: the workspace loader is rebuilt whenever prompts
 * reload, so holding the instance from construction time serves stale tool definitions.
 */
export type ScriptToolRuntimeProvider = () => ScriptToolRuntime | undefined;

/** What running one `script_tool` criterion produced. */
export interface ScriptToolCriterionOutcome {
  /** The declared tool id, or undefined when the criterion did not name one. */
  toolId: string | undefined;
  passed: boolean;
  /** Why it passed or failed, in one line. */
  reason: string;
  /**
   * True when the check could not run at all — no id, no registry, unknown tool, or a
   * tool requiring confirmation. Distinct from `passed: false`, which means the tool ran
   * and returned a verdict. Both fail; only one of them verified anything.
   */
  unrunnable: boolean;
  durationMs: number;
  exitCode?: number;
  /** The script's own structured payload, when it produced one. */
  scriptOutput?: Record<string, unknown> | null;
  stderr?: string;
}

function unrunnable(toolId: string | undefined, reason: string): ScriptToolCriterionOutcome {
  return { toolId, passed: false, reason, unrunnable: true, durationMs: 0 };
}

/**
 * Resolve a `script_tool` criterion to a tool and run it.
 *
 * Fails closed in every branch that cannot produce a verdict. A verification that did not
 * happen is not a verification, and reporting one as passed is the strongest available
 * evidence for the one outcome that carries none.
 */
export async function runScriptToolCriterion(
  criteria: GatePassCriteria,
  runtime: ScriptToolRuntime | undefined
): Promise<ScriptToolCriterionOutcome> {
  const toolId = criteria.script_tool_id;

  if (toolId == null || toolId.trim() === '') {
    return unrunnable(undefined, 'no script_tool_id specified in the script_tool criteria');
  }

  if (runtime === undefined) {
    return unrunnable(toolId, 'no script tool registry is wired into this caller');
  }

  const tool = runtime.loader.loadScript(toolId);
  if (tool === undefined) {
    return unrunnable(
      toolId,
      'no registered script tool has that id — script_tool_id names a tool, not a shell command'
    );
  }

  // A gate runs on the server's initiative, so there is no invocation through which a
  // caller could name the tool and approve it. Same rule the inline `{{script:id}}` path
  // enforces, and the same default: an unset `confirm` means true.
  if (tool.execution?.confirm !== false) {
    return unrunnable(
      toolId,
      'the tool requires confirmation, which a gate has no channel to obtain'
    );
  }

  const startTime = Date.now();
  try {
    const result = await runtime.executor.execute(
      {
        toolId,
        promptId: tool.promptId,
        inputs: criteria.script_tool_input ?? {},
        ...(criteria.script_tool_timeout != null ? { timeout: criteria.script_tool_timeout } : {}),
      },
      applyWorkingDir(tool, criteria.script_tool_working_dir)
    );

    const scriptOutput =
      typeof result.output === 'object' && result.output !== null
        ? (result.output as Record<string, unknown>)
        : null;
    const passed = result.success && scriptOutput?.['passed'] === true;

    return {
      toolId,
      passed,
      reason:
        (scriptOutput?.['reason'] as string | undefined) ??
        result.error ??
        (passed ? 'Script tool passed' : 'Script tool did not report passed: true'),
      unrunnable: false,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      scriptOutput,
      ...(result.stderr !== '' ? { stderr: result.stderr } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      toolId,
      passed: false,
      reason: `Script tool error: ${message}`,
      unrunnable: false,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * `script_tool_working_dir` stays relative to the tool's own directory, matching
 * `tool.workingDir`, so a gate cannot relocate a tool outside the directory that
 * registered it.
 */
function applyWorkingDir(tool: LoadedScriptTool, workingDir: string | undefined): LoadedScriptTool {
  return workingDir != null ? { ...tool, workingDir } : tool;
}
