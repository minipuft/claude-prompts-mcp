// @lifecycle canonical - Pure compilation of a validated Workflow IR into runtime chain steps (P6 Tier 5).
/**
 * Workflow IR compiler.
 *
 * The IR's last pure function: given a validated IR and the total order the linearizer produced,
 * emit the SAME `ChainStepPrompt[]` a parsed `>>chain` produces. Nothing here is IR-specific at
 * the far end — the output is the runtime's own step vocabulary, which is the whole of acceptance
 * clause (a) ("IR compiles TO the runtime, it doesn't bypass it").
 *
 * WHY THIS RETURNS STEPS AND NOT NODES. The plan's §Interfaces sketched
 * `compileWorkflowIR(ir, order) => { steps, nodes }`. Measured at HEAD: `ChainNode[]` has exactly
 * one production producer for a parsed chain — `SessionManagementStage.buildChainNodes`
 * (`13-session-stage.ts:341-370`) — and it derives the list from `parsedCommand.steps` by reading
 * `step.nodeId`. Emitting a second `ChainNode[]` here would be a second producer of one
 * projection rule, drifting the moment either side changes: the P6-F8 shape ("the chain step
 * shape is maintained in four hand-written copies") that this module exists NOT to add a fifth
 * copy to. Node identity still travels — on `steps[].nodeId`, which is the input
 * `buildChainNodes` reads. See the Tier 5 deviation record in the implementation notes.
 *
 * WHY ARGS ARE NOT DEFAULTED FROM THE PROMPT. The symbolic builder merges
 * `collectArgumentDefaults(prompt)` under a step's parsed args because a symbolic command's args
 * are a fragment of a command STRING and are routinely partial. An IR node's `args` is a declared
 * object, and the validator has already enforced every `required` argument of the referenced
 * prompt (P7-F6, IR-scope). Re-deriving defaults here would mean reimplementing a private helper
 * of `SymbolicCommandBuilder` — a second copy of a rule, for a surface that does not need it.
 *
 * Pure: no I/O, no logging. The prompt lookup is injected, exactly as the validator's is.
 */

import type { ChainStepPrompt } from '#engine/execution/operators/types.js';
import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { DeclaredRunBudget } from '#shared/types/chain-session.js';
import type { WorkflowIR, WorkflowNode } from './types.js';

/** Everything the compiler needs from outside itself. Injected, never imported. */
export interface WorkflowCompilerDeps {
  /**
   * Resolve a prompt id to its converted form. Returning `undefined` is a programming error at
   * this point, not a client error: `validateWorkflowIR` has already produced `unknown-prompt`
   * for every id that does not resolve, so a miss here means the caller compiled an IR it never
   * validated. {@link compileWorkflowIR} throws rather than emitting a step with no prompt.
   */
  readonly lookupPrompt: (promptId: string) => ConvertedPrompt | undefined;
}

/** What a compiled IR hands the runtime. */
export interface WorkflowCompilation {
  /** The run's steps, in linearized order, in the runtime's own step vocabulary. */
  readonly steps: ChainStepPrompt[];
  /**
   * Run-level args for the `ParsedCommand`. The FIRST node's args, mirroring
   * `SymbolicCommandBuilder.buildSymbolicChain`, which assigns `commandArgs` from the first step
   * it builds. Not a union of every node's args: `promptArgs` is what the run was invoked WITH,
   * and a union would attribute a later node's argument to the invocation.
   */
  readonly promptArgs: Record<string, unknown>;
  /** Present only when the IR declared a budget with at least one durable field. */
  readonly budget?: DeclaredRunBudget;
}

/** Thrown when compile is handed an IR that validation would have rejected. */
export class WorkflowCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowCompileError';
  }
}

/**
 * Compile a validated IR under its linearized order.
 *
 * @param ir - the submitted workflow. MUST have passed {@link validateWorkflowIR}.
 * @param order - node ids in run order, as returned by the validator.
 * @throws {WorkflowCompileError} when `order` names a node the IR does not declare, or a node's
 *   prompt does not resolve — both of which mean an unvalidated IR reached this function.
 */
export function compileWorkflowIR(
  ir: WorkflowIR,
  order: readonly string[],
  deps: WorkflowCompilerDeps
): WorkflowCompilation {
  const byId = new Map<string, WorkflowNode>(ir.nodes.map((node) => [node.id, node]));

  const steps: ChainStepPrompt[] = order.map((nodeId, index) => {
    const node = byId.get(nodeId);
    if (node === undefined) {
      throw new WorkflowCompileError(
        `Linearized order names node "${nodeId}", which the workflow does not declare`
      );
    }
    const converted = deps.lookupPrompt(node.promptId);
    if (converted === undefined) {
      throw new WorkflowCompileError(
        `Node "${node.id}" references prompt "${node.promptId}", which is not registered`
      );
    }
    return compileNode(node, converted, index);
  });

  const budget = compileBudget(ir);
  return {
    steps,
    promptArgs: { ...(steps[0]?.args ?? {}) },
    ...(budget !== undefined ? { budget } : {}),
  };
}

/**
 * One node → one `ChainStepPrompt`.
 *
 * Field-for-field the projection `04-parsing-stage.buildDirectCommand` performs on a YAML chain
 * step, including its two conventions that are easy to lose:
 *
 * - Optional fields are SPREAD conditionally, never written as `undefined`. `ChainStepPrompt` is
 *   JSON-cloned into the session blueprint (`13-session-stage.ts:411-413`), and an explicit
 *   `undefined` and an absent key are indistinguishable after that round trip — but they are NOT
 *   indistinguishable to the byte-equality assertions the acceptance suite makes between an IR
 *   run and its YAML twin.
 * - `framework` takes the node's declaration only, with no fallback to the referenced prompt's
 *   own preference. A prompt-level preference is already read by
 *   `generateExecutionContext(step.convertedPrompt, …)`; reading it here too would promote it into
 *   an explicit per-step OVERRIDE outranking the run-wide choice the caller actually made.
 *
 * `delegated` is deliberately NOT set here. `OperatorValidationStage.markDelegatedStepPrompts`
 * (stage 06) derives it from `subagentModel` for every invocation path since P6 Tier 1, and
 * setting it here as well would give one flag two producers on one of the two paths.
 */
function compileNode(
  node: WorkflowNode,
  converted: ConvertedPrompt,
  index: number
): ChainStepPrompt {
  return {
    stepNumber: index + 1,
    nodeId: node.id,
    promptId: converted.id,
    convertedPrompt: converted,
    args: { ...(node.args ?? {}) },
    ...(node.inputMapping !== undefined ? { inputMapping: { ...node.inputMapping } } : {}),
    ...(node.outputMapping !== undefined ? { outputMapping: { ...node.outputMapping } } : {}),
    ...(node.retries !== undefined ? { retries: node.retries } : {}),
    ...(node.subagentModel !== undefined ? { subagentModel: node.subagentModel } : {}),
    ...(node.agentType !== undefined ? { agentType: node.agentType } : {}),
    ...(node.framework !== undefined ? { framework: node.framework } : {}),
    ...(node.inlineGateIds !== undefined ? { inlineGateIds: [...node.inlineGateIds] } : {}),
    ...(node.visibility !== undefined ? { visibility: cloneVisibility(node.visibility) } : {}),
  };
}

/** Deep-copy the visibility declaration so a compiled step never aliases the submitted IR. */
function cloneVisibility(
  visibility: NonNullable<WorkflowNode['visibility']>
): NonNullable<ChainStepPrompt['visibility']> {
  return {
    ...(visibility.withhold !== undefined ? { withhold: [...visibility.withhold] } : {}),
    ...(visibility.expose !== undefined ? { expose: [...visibility.expose] } : {}),
  };
}

/**
 * Project the submitted budget onto the two fields that outlive validation.
 *
 * `maxNodes` and `maxFanOut` are answered from the submission itself and have no reader
 * afterwards, so they are dropped here rather than persisted as write-only fields — see
 * {@link DeclaredRunBudget}. Returns `undefined` when nothing durable was declared, so a run with
 * an all-structural budget carries no budget object at all rather than an empty one.
 */
function compileBudget(ir: WorkflowIR): DeclaredRunBudget | undefined {
  const declared = ir.budget;
  if (declared === undefined) {
    return undefined;
  }
  const budget: DeclaredRunBudget = {
    ...(declared.maxInsertions !== undefined ? { maxInsertions: declared.maxInsertions } : {}),
    ...(declared.declaredCostCeiling !== undefined
      ? { declaredCostCeiling: declared.declaredCostCeiling }
      : {}),
  };
  return Object.keys(budget).length > 0 ? budget : undefined;
}
