// @lifecycle canonical - Refuses a call's own gate requests before the pipeline executes anything.
/**
 * Every refusal of what a call asked for about gates, decided before stage 08 runs a prompt's
 * script tools. The rejection render says "Nothing was executed", so a refusal raised after a
 * script ran would tell the client a side effect it never asked for did not happen.
 *
 * Two questions, in this order:
 *   1. Does a switch withhold every gate (config, runtime switch, `%clean` / `%framework`)? Then a
 *      call that requested a gate is refused naming the switch, and one that requested none
 *      passes, to be skipped at gate enhancement.
 *   2. Otherwise, can each of the call's own request gates register as sent? A blank or unknown
 *      entry, one under a canonical gate's id, and on a resume one targeting a step the run can no
 *      longer reach, are each refused by entry.
 *
 * The modifiers read here are the call's own (`ExecutionContext.getExecutionModifiers`): the
 * planner's default `%clean` for a script-tool prompt is decided later, at stage 07, and is not
 * applied to a call that requested a gate (`callerRequestedGates`), so it never needs a refusal.
 */
import {
  gateSuppressionRefusalDetail,
  requestedGateAddresses,
  resolveGateSuppression,
} from './gate-suppression-refusal.js';

import type { WorkflowRejection } from '#modules/workflow-ir/types.js';
import type { GateSystemSettings } from '#shared/types/index.js';
import type { StateStoreOptions } from '#shared/types/persistence.js';
import type { GateSuppression } from './gate-suppression-refusal.js';
import type { TemporaryGateRegistrar } from './temporary-gate-registrar.js';
import type { ExecutionContext } from '../../execution/context/index.js';

type GateSystemSettingsProvider = () => GateSystemSettings | undefined;
/** The runtime gate switch (`system_control gates`), read for a request's scope. */
type GateSystemSwitch = (scope: StateStoreOptions | undefined) => boolean;

/**
 * Every gate the call itself requested, addressed as the client wrote it: its own request gates,
 * the `::` operators of the command it sent (a restored resume sent none), and its workflow's node
 * gates. Never a prompt author's.
 */
export function callerRequestedGates(
  registrar: TemporaryGateRegistrar,
  context: ExecutionContext
): string[] {
  return requestedGateAddresses({
    requestGates: registrar.ownRequestGates(context),
    commandOperators: context.state.session.isBlueprintRestored
      ? undefined
      : context.parsedCommand?.operators?.operators,
    workflowNodes: context.mcpRequest.workflow?.nodes,
  });
}

/** The run-level rejection for gates a call requested while `suppression` withholds them. */
export function gateSuppressionRejection(
  suppression: GateSuppression,
  requested: readonly string[]
): WorkflowRejection {
  return {
    reason: 'gate-suppressed',
    detail: gateSuppressionRefusalDetail(suppression, requested),
  };
}

export class RequestGateAdmission {
  constructor(
    private readonly registrar: TemporaryGateRegistrar,
    private readonly gatesConfigProvider: GateSystemSettingsProvider,
    private readonly gateSystemEnabled: GateSystemSwitch
  ) {}

  /** The call's gate requests the server will not run as sent; empty admits the call. */
  async refusals(context: ExecutionContext): Promise<WorkflowRejection[]> {
    const suppression = resolveGateSuppression({
      configEnabled: this.gatesConfigProvider()?.enabled !== false,
      runtimeEnabled: () => this.gateSystemEnabled(context.getScopeOptions()),
      modifiers: () => context.getExecutionModifiers(),
    });
    if (suppression !== undefined) {
      const requested = callerRequestedGates(this.registrar, context);
      return requested.length === 0 ? [] : [gateSuppressionRejection(suppression, requested)];
    }
    return [
      ...(await this.registrar.invalidRequestGates(context)).map((refusal) => ({
        reason: 'gate-criteria-invalid' as const,
        ...refusal,
      })),
      ...this.registrar
        .canonicalIdCollisions(context)
        .map((refusal) => ({ reason: 'gate-id-canonical' as const, ...refusal })),
      ...this.registrar
        .unreachableStepTargets(context)
        .map((refusal) => ({ reason: 'gate-target-passed' as const, ...refusal })),
    ];
  }
}
