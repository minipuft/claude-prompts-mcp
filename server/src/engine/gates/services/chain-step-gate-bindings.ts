// @lifecycle canonical - Which gate a chain walk binds to which step, and which gates a step receives.
//
// The chain gate walk's binding decisions, apart from the service that runs the walk: which gate a
// step's own resolution binds to that step, which step the chain prompt's own gates bind to, and
// which gates a target step receives. PURE apart from the one resolution `chainPromptGates` asks of
// the resolver its caller passes in. A gate no step binds is answered by its own declared target,
// which reads the temporary gate registry, so the caller passes that check in too
// (`acceptsTemporaryGateTarget`) and this module holds no state.

import { liveNodeIds } from './run-step-view.js';

import type {
  GateResolutionInput,
  GateResolutionResult,
  GateSetResolver,
  ResolvedGate,
} from './gate-set-resolver.js';
import type { RunStepView } from './run-step-view.js';
import type { ExecutionContext } from '../../execution/context/index.js';
import type { ChainStepPrompt } from '../../execution/operators/types.js';

import { parseStepForNode } from '#shared/utils/node-order.js';

/** The chain prompt's own gates and the run's final step, which they belong to (R1 to R3). */
interface ChainPromptGates {
  readonly finalStep: ChainStepPrompt;
  readonly resolution: GateResolutionResult;
}

/**
 * Where a step gate was written: the step's node id when it has one, and its parse ordinal, which
 * `parseStepForNode` reads only for a chain whose steps carry no node ids.
 */
interface StepAddress {
  readonly nodeId?: string;
  readonly stepNumber: number;
}

/**
 * Gate id to the steps whose own resolution supplied it: a gate written on a step (R194, P6.12),
 * or one the step's own prompt supplies through its `gateConfiguration`, its inline gate
 * definitions or its category (R204, P6.310), belongs to that step. The chain prompt's own gates
 * belong to the run's final step (R1). A gate absent from the map is run-wide or carries its own
 * target.
 */
export type StepGateBindings = ReadonlyMap<string, readonly StepAddress[]>;

/**
 * The gates a chain walk leaves run-wide whichever step also supplies them: what the call held
 * before the walk (request and framework gates), and the framework's own gates, unless a step
 * wrote one inline.
 */
export interface RunWideGates {
  readonly seedGateIds: ReadonlySet<string>;
  readonly frameworkGateIds: ReadonlySet<string>;
}

export const NO_STEP_BINDINGS: StepGateBindings = new Map();

/** Whether a gate no step binds fires on `target`, by its own declared target. */
type TemporaryGateTargetCheck = (
  gateId: string,
  target: { readonly nodeId?: string | null; readonly stepNumber?: number },
  runStepView: RunStepView | undefined
) => boolean;

/**
 * The chain prompt's own gates and the run's final step (R1 to R5), or undefined when the call
 * names no chain prompt (an arrow chain, a stepless run) or no walked step is live.
 *
 * Its own gates are what its `gateConfiguration.include` and its category select, less its
 * `exclude` (R2). The planner put them in the chain plan and the walk never read that plan, so
 * they reached no step. Framework gates are withheld here: they still come from each step's own
 * resolution, as before. Resolved, not recorded: the walk records them on the final step, after
 * that step's own resolution, and the inherited re-derivation adds them at the same point. The
 * resolver is the caller's: `GateEnhancementService` builds it from its gate manager, loader and
 * temporary gate registry.
 */
export async function chainPromptGates(
  resolver: Pick<GateSetResolver, 'resolve'>,
  context: ExecutionContext,
  steps: readonly ChainStepPrompt[],
  runStepView: RunStepView | undefined,
  frameworkGateIds: ReadonlySet<string>
): Promise<ChainPromptGates | undefined> {
  const finalStep = finalWalkedStep(steps, runStepView);
  const input = chainPromptResolutionInput(context, frameworkGateIds);
  if (finalStep === undefined || input === undefined) {
    return undefined;
  }
  return { finalStep, resolution: await resolver.resolve(input) };
}

/**
 * The per-gate targeting decision, shared by the per-step walk and the inherited scope.
 *
 * Node id first (OQ-P4-3). A step-targeted gate is bound to a node id at registration, and
 * matching on that id is what makes the binding survive a mutation: matching on the ordinal
 * instead would silently move the gate one step later the moment a node was inserted ahead of
 * it, firing it against work its author never saw. The ordinal branch remains for gates and
 * chains that carry no node id at all (P3 D10 keeps `nodeId` optional).
 *
 * A gate whose target node is no longer LIVE fires nowhere (R84): RETIRED (`milestone='skipped'`)
 * or gone from the run, which a `replace` remainder does to the nodes it drops. Its step will not
 * execute, and letting it fall through would attach it to whatever step now sits at that
 * position, or to a node inserted to unblock it.
 *
 * `nodeId: null` is NOT `nodeId: undefined`. `null` means "this target has no node identity and
 * none can be inherited", so every node-addressed gate must drop; `undefined` means "this step
 * carries no node id" (legacy chains — P3 D10 keeps `nodeId` optional), where the ordinal branch
 * is the right answer. Collapsing the two would let an inherited scope with no target silently
 * widen to every node-addressed gate.
 *
 * A gate a step declared inline (R194) or its own prompt supplied (R204) is addressed by the
 * step (`stepBindings`): it reaches the steps that supplied it and no other, so the render, the
 * review, the post-advance review and an inherited review all read the one answer given here.
 */
export function filterGatesForTarget(
  gateIds: string[],
  target: { readonly nodeId?: string | null; readonly stepNumber?: number },
  runStepView: RunStepView | undefined,
  stepBindings: StepGateBindings,
  acceptsTemporaryGateTarget: TemporaryGateTargetCheck
): string[] {
  return gateIds.filter((gateId) => {
    const boundTo = stepBindings.get(gateId);
    return boundTo !== undefined
      ? isBoundToTarget(boundTo, target)
      : acceptsTemporaryGateTarget(gateId, target, runStepView);
  });
}

/**
 * `bindings` with every gate one walked step's own resolution accepted bound to that step (R194,
 * R204). PURE.
 *
 * A step's own resolution sees its inline gates (R194, P6.12) and what its own prompt supplies: its
 * `gateConfiguration`, its inline gate definitions and its category's gates (R204, P6.310). Each
 * such gate belongs to the step: it renders and is reviewed there, and reaches no later step
 * through the cumulative accumulator. Two steps supplying one gate each hold it on their own step.
 *
 * Left run-wide: what the call held before the walk (request and framework gates), since the
 * request asked for it on every step, and the framework's gates unless the step wrote one inline.
 */
export function withStepGates(
  bindings: StepGateBindings,
  step: ChainStepPrompt,
  accepted: readonly ResolvedGate[],
  runWide: RunWideGates
): StepGateBindings {
  const address: StepAddress =
    typeof step.nodeId === 'string' && step.nodeId.length > 0
      ? { nodeId: step.nodeId, stepNumber: step.stepNumber }
      : { stepNumber: step.stepNumber };
  const next = new Map(bindings);
  for (const gate of accepted) {
    const frameworkWide =
      runWide.frameworkGateIds.has(gate.id) && gate.source !== 'inline-operator';
    if (!runWide.seedGateIds.has(gate.id) && !frameworkWide) {
      next.set(gate.id, [...(next.get(gate.id) ?? []), address]);
    }
  }
  return next;
}

/**
 * The bindings every walk starts from: the chain prompt's own gates bound to the run's final step
 * (R1), so the one filter passes them there and on no other step. PURE.
 */
export function chainPromptBindings(
  chainGates: ChainPromptGates | undefined,
  runWide: RunWideGates
): StepGateBindings {
  return chainGates === undefined
    ? NO_STEP_BINDINGS
    : withStepGates(
        NO_STEP_BINDINGS,
        chainGates.finalStep,
        chainGates.resolution.accepted,
        runWide
      );
}

/**
 * The run's final step: the last walked step whose node is live (R3). PURE.
 *
 * The walk is in run order and holds no inserted node, so a `remainder` that extends the run moves
 * the final step to its last node, and an inserted node is never final. A node the mutation policy
 * retired will not run, so it is passed over. With no run yet every step is live.
 */
function finalWalkedStep(
  steps: readonly ChainStepPrompt[],
  view: RunStepView | undefined
): ChainStepPrompt | undefined {
  const live = view === undefined ? undefined : liveNodeIds(view);
  return [...steps]
    .reverse()
    .find(
      (step) =>
        live === undefined ||
        typeof step.nodeId !== 'string' ||
        step.nodeId.length === 0 ||
        live.includes(step.nodeId)
    );
}

/**
 * The resolution input for the chain prompt's own gates, or undefined when the call names no
 * chain prompt. PURE.
 *
 * Framework gates are vetoed (`frameworkGatesEnabled: false`, with the known framework ids): they
 * are no chain prompt's own, and an accepted one no step binds would reach every step.
 */
function chainPromptResolutionInput(
  context: ExecutionContext,
  frameworkGateIds: ReadonlySet<string>
): GateResolutionInput | undefined {
  const prompt = context.parsedCommand?.convertedPrompt;
  if (prompt?.chainSteps === undefined || prompt.chainSteps.length === 0) {
    return undefined;
  }
  return {
    prompt,
    category: prompt.category,
    modifiers: context.executionPlan?.modifiers,
    frameworkInjected: false,
    frameworkGatesEnabled: false,
    knownFrameworkGateIds: [...frameworkGateIds],
    autoAssignCategoryGates: prompt.category.length > 0,
  };
}

/** No parse step has ordinal 0, so a target with neither node id nor ordinal matches none. */
const NO_ORDINAL = 0;

/**
 * Whether `target` is one of the steps a gate was declared on. PURE.
 *
 * Resolved by the node the target stands for, through `parseStepForNode`: a step that carries a
 * node id is matched by it and never by position, because an inserted node takes the ordinal of
 * the planned step after it, and the run position of a planned step moves with every insertion
 * ahead of it. The ordinal answers only for steps that carry no node id at all. `nodeId: null`
 * (an inherited scope with no target) matches no step.
 */
function isBoundToTarget(
  addresses: readonly StepAddress[],
  target: { readonly nodeId?: string | null; readonly stepNumber?: number }
): boolean {
  if (target.nodeId === null) {
    return false;
  }
  const nodeId =
    typeof target.nodeId === 'string' && target.nodeId.length > 0 ? target.nodeId : undefined;
  return parseStepForNode(addresses, nodeId, target.stepNumber ?? NO_ORDINAL) !== undefined;
}
