// @lifecycle canonical - Validates and applies a caller-authored chain remainder (OQ-3, row 2.3).
import { decideInterrupt, isUnknownInterruptPending } from '../pipeline/decisions/index.js';

import type { Logger } from '#infra/logging/index.js';
import type { WorkflowCaps } from '#modules/workflow-ir/node-schema.js';
import type {
  RemainderSubmission,
  WorkflowIR,
  WorkflowRejection,
  WorkflowValidation,
} from '#modules/workflow-ir/types.js';
import type { WorkflowValidatorDeps } from '#modules/workflow-ir/validator.js';
import type { ChainNode } from '#shared/types/chain-execution.js';
import type {
  ChainSession,
  ChainSessionService,
  RemainderMode,
  RemainderNodeSpec,
  RemainderRejectionReason,
} from '#shared/types/chain-session.js';
import type { ConvertedPrompt } from '../types.js';

import { currentOrdinal } from '#shared/utils/node-order.js';

/**
 * The `modules/workflow-ir/` surface this processor consumes, supplied by the composition root.
 *
 * Same seam and the same reason as {@link WorkflowIrPort} in `parsers/workflow-command-builder.ts`:
 * `validateWorkflowIR` and `DEFAULT_WORKFLOW_CAPS` are Layer 3 and `engine/` may not value-import
 * them (`engine-no-modules-or-mcp-value`, error severity). Both members travel together because a
 * validation run under caps the caller did not supply is a different check.
 */
export interface RemainderIrPort {
  validate(ir: WorkflowIR, deps: WorkflowValidatorDeps): WorkflowValidation;
  readonly defaultCaps: WorkflowCaps;
}

/**
 * Outcome of handling one call's `remainder` parameter.
 *
 * `none` and `refused` are separate states, not one falsy value: `none` is the overwhelmingly
 * common case (no `remainder` on the call) and must cost nothing, while `refused` owes the caller
 * a named message. Collapsing them is how "the server silently ignored my remainder" happens.
 */
export type RemainderApplication =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'applied';
      readonly mode: RemainderMode;
      readonly unknownId: string;
      readonly nodes: readonly ChainNode[];
    }
  | { readonly kind: 'refused'; readonly message: string };

/**
 * Validates a model-authored remainder and hands the accepted nodes to the chain store.
 *
 * Sibling of {@link UnknownObservationProcessor} by role: both take a caller-declared structure
 * off `mcpRequest`, validate it against rules they do not own, and apply it through the store —
 * so stage 16 stays a translation layer over two services rather than a home for either.
 *
 * WHY VALIDATION IS RE-RUN HERE at all, when `prompt-engine.schema.ts` already parsed the
 * submission against `workflowNodeSchema`/`workflowEdgeSchema`: the Zod schema answers SHAPE
 * (is this a well-formed node?). It cannot answer the three questions that decide whether the
 * nodes may join THIS run — does the prompt exist, are its required arguments supplied, and do
 * the declared edges linearize. `validateWorkflowIR` owns all three, and reusing it is what keeps
 * a remainder held to the same bar as the `workflow` submission whose vocabulary it borrows.
 */
export class RemainderProcessor {
  constructor(
    private readonly chainSessionStore: ChainSessionService,
    private readonly workflowIr: RemainderIrPort,
    private readonly getConvertedPrompts: () => ConvertedPrompt[],
    private readonly logger: Logger
  ) {}

  /**
   * Apply `submission` to the run, or explain why not.
   *
   * Refusals are DATA carrying a client-facing message, never throws — a malformed or
   * inadmissible remainder is a client error with an addressed explanation, the same posture
   * `WorkflowCommandBuilder.build` takes for a malformed submission.
   */
  async apply(
    sessionId: string,
    session: ChainSession,
    submission: RemainderSubmission | undefined
  ): Promise<RemainderApplication> {
    if (submission === undefined) {
      return { kind: 'none' };
    }

    const unknownId = this.resolveAnsweredUnknownId(session);
    if (unknownId === undefined) {
      return {
        kind: 'refused',
        message:
          'remainder refused: no blocking unknown is open on this run. A remainder rewrites the ' +
          'rest of a plan a blocking unknown invalidated — declare one with ' +
          'observations:[{type:"unknown_discovered", blocking:true, …}] first.',
      };
    }

    const undeliverable = findUndeliverableFields(submission);
    if (undeliverable.length > 0) {
      return { kind: 'refused', message: describeUndeliverableFields(undeliverable) };
    }

    const validation = this.validate(submission, session);
    if (!validation.ok) {
      return { kind: 'refused', message: describeRejections(validation.rejections) };
    }

    const outcome = await this.chainSessionStore.replaceRemainder(
      sessionId,
      projectNodes(submission, validation.order),
      unknownId,
      submission.mode
    );

    if (outcome.kind === 'rejected') {
      return { kind: 'refused', message: describeStoreRefusal(outcome.reason, submission.mode) };
    }

    this.logger.debug(
      `[Remainder] Applied ${submission.mode} of ${outcome.nodes.length} node(s) to session ${sessionId} for unknown ${unknownId}`
    );
    return { kind: 'applied', mode: outcome.mode, unknownId, nodes: outcome.nodes };
  }

  /**
   * Which unknown this remainder answers, or `undefined` when the run is not entitled to one.
   *
   * `decideInterrupt` is reused rather than re-scanning the ledger, so "which blocking unknown is
   * the run stopped on" has ONE definition — the most recently discovered open one. A second scan
   * here would let the payload name one unknown while the recorded provenance
   * (`origin_unknown_id`) named another, and the per-unknown-id remainder cap would then be
   * counting a different thing than the interrupt the caller answered.
   *
   * The synthetic review is the second entitlement the plan grants (OQ-3: "while a blocking
   * unknown is open … or `__unknown_interrupt__` is pending"). It matters in exactly one state: a
   * caller that resolved its unknown and rewrote the plan in the same call, where the ledger is
   * already clean but the run is still holding. The id then comes off the review, which stage 16
   * stamped with it when it raised the hold.
   */
  private resolveAnsweredUnknownId(session: ChainSession): string | undefined {
    const interrupt = decideInterrupt({
      ledger: session.unknownsLedger ?? [],
      nodes: session.state.nodes,
      currentNodeId: session.state.currentNodeId,
    });
    if (interrupt !== undefined) {
      return interrupt.unknownId;
    }

    if (!isUnknownInterruptPending(session.pendingGateReview)) {
      return undefined;
    }
    const held = session.pendingGateReview?.metadata?.['unknownId'];
    return typeof held === 'string' ? held : undefined;
  }

  /**
   * Validate the submitted nodes as an IR, under a cap narrowed by what the run already spent.
   *
   * "`maxNodes` counts executed + remainder" (OQ-3). The server cap bounds a whole RUN, not one
   * submission, so a run that has already executed four nodes may only propose `maxNodes - 4`
   * more — otherwise a caller could grow a run without limit by rewriting the tail repeatedly,
   * which is the ceiling the remainder cap only partially covers (three remainders of 32 nodes
   * each is 96 nodes through a cap that says 32).
   *
   * The narrowed cap is passed to the validator rather than checked here, so the rejection the
   * client reads is `cap-exceeded` with the effective number in it — the same message the
   * `workflow` path produces, from the same code.
   */
  private validate(submission: RemainderSubmission, session: ChainSession): WorkflowValidation {
    const executed = currentOrdinal(session.state.nodes, session.state.currentNodeId);
    const remaining = Math.max(this.workflowIr.defaultCaps.maxNodes - executed, 1);
    const prompts = this.getConvertedPrompts();

    return this.workflowIr.validate(
      {
        // `version: 1` is supplied rather than carried on the submission: a remainder is not a
        // whole workflow and the contract does not ask a caller for a version on it. Pinning the
        // literal here is what makes a future `version: 2` a typed break at this line instead of
        // a remainder silently validated as the wrong shape.
        version: 1,
        nodes: submission.nodes,
        ...(submission.edges !== undefined ? { edges: submission.edges } : {}),
      },
      {
        lookupPrompt: (promptId) => {
          const converted = prompts.find((prompt) => prompt.id === promptId);
          if (converted === undefined) {
            return undefined;
          }
          return {
            requiredArguments: converted.arguments
              .filter((argument) => argument.required === true)
              .map((argument) => argument.name),
          };
        },
        caps: { ...this.workflowIr.defaultCaps, maxNodes: remaining },
      }
    );
  }
}

/**
 * Project validated IR nodes onto the store's spec shape, in LINEARIZED order.
 *
 * The order matters more than it looks: `replaceRemainder` writes nodes in array order and the
 * run then executes them in that order, so projecting in declaration order would silently ignore
 * every edge the caller declared. `validation.order` is why the validator returns one.
 *
 * `stepName` falls back to `promptId`, mirroring `compileNode`'s documented default, so the two
 * paths into a run's node list name an unnamed step the same way.
 */
function projectNodes(
  submission: RemainderSubmission,
  order: readonly string[]
): RemainderNodeSpec[] {
  const byId = new Map(submission.nodes.map((node) => [node.id, node]));
  return order.flatMap((id) => {
    const node = byId.get(id);
    if (node === undefined) {
      return [];
    }
    return [
      {
        id: node.id,
        promptId: node.promptId,
        stepName: node.stepName ?? node.promptId,
        // Conditional spreads, not `?? undefined`: `exactOptionalPropertyTypes` rejects an
        // explicit undefined, and an absent key is what "declared nothing" has to look like all
        // the way down to the column.
        ...(node.args !== undefined ? { args: { ...node.args } } : {}),
        ...(node.delegated !== undefined ? { delegated: node.delegated } : {}),
      },
    ];
  });
}

/**
 * The IR node fields a remainder node CARRIES into the run (row A.5).
 *
 * Exported for `remainder-node-fields.test.ts`, which asserts this list plus
 * {@link REMAINDER_REFUSED_NODE_FIELDS} covers `workflowNodeSchema`'s key set exactly. That gate
 * is the point of both constants: a field added to the IR node is otherwise accepted here by the
 * shared schema and dropped by {@link projectNodes} with nothing red — the silent-drop shape
 * P-A-F5 named, which cost `::`, `==>` and every submitted argument four months of looking
 * accepted.
 */
export const REMAINDER_CARRIED_NODE_FIELDS = [
  'id',
  'promptId',
  'stepName',
  'args',
  'delegated',
] as const;

/**
 * The IR node fields a remainder REFUSES, each with what the caller should do instead.
 *
 * Refused rather than dropped, because a remainder node has no entry in `parsedCommand.steps`:
 * its step is synthesized from the node (`operators/node-step-projection.ts`), so a field the
 * node cannot carry is a field the run provably never sees. "Accepted and inert" is the one
 * outcome OQ-A1 forbids, and it is what these fields did before A.5.
 */
export const REMAINDER_REFUSED_NODE_FIELDS: Readonly<Record<string, string>> = {
  inputMapping: 'reference upstream results in the step arguments instead',
  outputMapping: 'reference upstream results in the step arguments instead',
  visibility: 'no synthesized step reads a visibility policy',
  subagentModel: 'declare delegated:true; a model tier is a parse-time prompt-level hint',
  agentType: 'declare delegated:true; the host agent is a parse-time prompt-level hint',
  framework: 'the run-wide framework applies to a contributed node',
  retries: 'no synthesized step reads a retry count',
  inlineGateIds: 'bind the gate with the `gates` parameter and its target_step_id',
  inlineGateCriteria:
    'raw `::` tokens are resolved at parse time, which a contributed node has already passed; ' +
    'bind the gate with the `gates` parameter and its target_step_id',
};

/** Field names present on a submitted node that the remainder path refuses to accept. */
function findUndeliverableFields(submission: RemainderSubmission): string[] {
  const found = new Set<string>();
  for (const node of submission.nodes) {
    for (const field of Object.keys(REMAINDER_REFUSED_NODE_FIELDS)) {
      if ((node as unknown as Record<string, unknown>)[field] !== undefined) {
        found.add(field);
      }
    }
  }
  return [...found];
}

/** The sentence a caller reads when a submitted node declares something the run cannot see. */
function describeUndeliverableFields(fields: readonly string[]): string {
  const lines = fields.map((field) => `- ${field}: ${REMAINDER_REFUSED_NODE_FIELDS[field] ?? ''}`);
  return (
    'remainder refused: a contributed node carries only ' +
    `{${REMAINDER_CARRIED_NODE_FIELDS.join(', ')}}, because it has no parse-time step for the ` +
    'rest to live on — the run would never see these fields.\n' +
    lines.join('\n')
  );
}

/** One message naming every rejection, so a caller fixes the whole submission in one round trip. */
function describeRejections(rejections: readonly WorkflowRejection[]): string {
  const lines = rejections.map(
    (rejection) => `- ${rejection.reason}: ${rejection.detail ?? '(no detail)'}`
  );
  return `remainder refused: the submitted nodes are not a valid plan.\n${lines.join('\n')}`;
}

/** Turn the store's named refusal into the sentence the submitter reads. */
function describeStoreRefusal(reason: RemainderRejectionReason, mode: RemainderMode): string {
  const detail: Record<RemainderRejectionReason, string> = {
    'session-unknown': 'the run is no longer active in this process.',
    'run-terminal': 'the run has finished, so there is no remainder to rewrite.',
    'empty-remainder': `a ${mode} must carry at least one node; truncating a run is not a remainder.`,
    'cap-reached':
      'this unknown has already spent its one remainder, or the run has spent its per-run ceiling.',
    'node-already-started':
      'a step the replacement would remove has already been issued to you and cannot be un-shown.',
  };
  return `remainder refused (${reason}): ${detail[reason]}`;
}
