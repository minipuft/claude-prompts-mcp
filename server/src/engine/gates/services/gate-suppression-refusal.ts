// @lifecycle canonical - Which switch withholds every gate from a call, the gates the call itself requested, and the refusal that names the conflict.
/**
 * A call can turn every gate off — `%clean` and `%framework`, the `gates.enabled` config value, the
 * runtime switch (`system_control gates disable`) — and can also ask for gates: a `gates` entry, a
 * `::` operator in its command, a gate on a submitted workflow node. Stage 11 used to answer the
 * pair by skipping, so the call ran without the gates it asked for and said nothing (measured
 * 2026-10-12, composition root, every switch). R11.8: a requested gate is enforced as written or
 * refused with a reason, so stage 05 refuses this pair before any script tool runs, and stage 11
 * skips a call that requested no gate. `%lean` withholds the framework, not gates, so it is not
 * here.
 *
 * Only what the CALL sent counts: a prompt author's gates are the author's, and a switch that
 * withholds them is doing its job. A `:: verify:"…"` gate is not counted either: shell
 * verification runs at stage 17 whatever stage 11 does (measured under `%clean`). PURE throughout.
 */
import { requestGateAddress } from './request-gate-refusal.js';

import type { ExecutionModifiers } from '../../execution/types.js';

/** Why no gate is enforced on a call. */
export type GateSuppression =
  | { readonly kind: 'modifier'; readonly modifier: '%clean' | '%framework' }
  | { readonly kind: 'config' }
  | { readonly kind: 'runtime' };

/** The modifier that withholds every gate, or undefined. `%lean` and `%judge` keep them. PURE. */
export function suppressingModifier(
  modifiers: ExecutionModifiers | undefined
): '%clean' | '%framework' | undefined {
  if (modifiers?.clean === true) return '%clean';
  if (modifiers?.framework === true) return '%framework';
  return undefined;
}

/** The gate declarations a chain step carries (`ChainStepPrompt`). */
interface StepGateDeclarations {
  readonly inlineGateIds?: readonly string[] | undefined;
  readonly inlineGateCriteria?: readonly string[] | undefined;
}

/**
 * How many gates the step itself declares: inline gate ids plus inline criteria. This is what a
 * step asks for, whichever call carried it, so a default that would withhold gates is judged
 * against the step as well as the call. PURE.
 */
export function declaredStepGateCount(step: StepGateDeclarations): number {
  return (step.inlineGateIds?.length ?? 0) + (step.inlineGateCriteria?.length ?? 0);
}

/**
 * The three switches, in the order every caller reads them. Each later one is read only when the
 * one before it is on: the runtime switch is a scoped store read, and a caller's modifiers may be
 * an accessor that throws when its plan is missing.
 */
interface GateSwitches {
  readonly configEnabled: boolean;
  readonly runtimeEnabled: () => boolean;
  readonly modifiers: () => ExecutionModifiers | undefined;
}

/** The switch that withholds every gate from a call, or undefined when gates run. PURE. */
export function resolveGateSuppression(switches: GateSwitches): GateSuppression | undefined {
  if (!switches.configEnabled) return { kind: 'config' };
  if (!switches.runtimeEnabled()) return { kind: 'runtime' };
  const modifier = suppressingModifier(switches.modifiers());
  return modifier === undefined ? undefined : { kind: 'modifier', modifier };
}

/** The parts of a `::` operator this module reads (`GateOperator`). */
interface CommandGateOperator {
  readonly type: string;
  readonly gateId?: string;
  readonly criteria?: string;
  readonly shellVerify?: unknown;
}

/** The parts of a submitted workflow node this module reads (`WorkflowNode`). */
interface WorkflowGateNode {
  readonly id: string;
  readonly inlineGateIds?: readonly string[];
  readonly inlineGateCriteria?: readonly string[];
}

export interface RequestedGateSources {
  /** The call's own request gates (`gates`, then `workflow.gates`), recorded ones excluded. */
  readonly requestGates: readonly unknown[];
  /** The operators the call's own command carried; absent when the call sent no command. */
  readonly commandOperators?: readonly CommandGateOperator[] | undefined;
  /** The nodes of a workflow the call submitted. */
  readonly workflowNodes?: readonly WorkflowGateNode[] | undefined;
}

/**
 * Every gate the call itself requested, each addressed as the client wrote it: `request gate 1
 * (name "Tone")`, `:: "cites sources"`, `:: tone:"plain"`, `node "draft" gate "code-quality"`. PURE.
 */
export function requestedGateAddresses(sources: RequestedGateSources): string[] {
  const fromRequest = sources.requestGates.map((gate, index) => requestGateAddress(index, gate));
  const fromCommand = (sources.commandOperators ?? []).flatMap((operator) => {
    if (operator.type !== 'gate' || operator.shellVerify !== undefined) return [];
    const quoted = JSON.stringify(operator.criteria ?? '');
    return [operator.gateId !== undefined ? `:: ${operator.gateId}:${quoted}` : `:: ${quoted}`];
  });
  const fromWorkflow = (sources.workflowNodes ?? []).flatMap((node) => [
    ...(node.inlineGateIds ?? []).map(
      (gateId) => `node ${JSON.stringify(node.id)} gate ${JSON.stringify(gateId)}`
    ),
    ...(node.inlineGateCriteria ?? []).map(
      (criterion) => `node ${JSON.stringify(node.id)} :: ${JSON.stringify(criterion)}`
    ),
  ]);
  return [...fromRequest, ...fromCommand, ...fromWorkflow];
}

/** What withholds the gates, and how a client keeps them. PURE. */
function suppressionTerms(suppression: GateSuppression): { cause: string; remedy: string } {
  switch (suppression.kind) {
    case 'modifier':
      return suppression.modifier === '%clean'
        ? {
            cause: '%clean runs without gates',
            remedy: 'Drop %clean to run with the gates (%lean keeps them without the framework)',
          }
        : {
            cause: '%framework runs the framework without gates',
            remedy: 'Drop %framework to run with the framework and the gates',
          };
    case 'config':
      return {
        cause: 'gates are disabled by configuration (`gates.enabled: false`)',
        remedy:
          'Enable them (`system_control` action:"gates", operation:"enable", persist:true, or ' +
          '`gates.enabled: true` in config.json)',
      };
    case 'runtime':
      return {
        cause: 'the gate system is disabled for this workspace (`system_control` gates disable)',
        remedy: 'Enable it (`system_control` action:"gates", operation:"enable")',
      };
  }
}

/** The refusal line's detail: the switch, every requested gate, and the two ways out. PURE. */
export function gateSuppressionRefusalDetail(
  suppression: GateSuppression,
  requested: readonly string[]
): string {
  const { cause, remedy } = suppressionTerms(suppression);
  const noun = requested.length === 1 ? 'gate' : 'gates';
  return (
    `${cause}, but this call requested ${requested.length} ${noun}: ${requested.join(', ')}. ` +
    `Nothing would enforce ${requested.length === 1 ? 'it' : 'them'}, and running anyway would ` +
    `tell you a gate held that never ran. ${remedy}, or send the call without the ${noun}.`
  );
}
