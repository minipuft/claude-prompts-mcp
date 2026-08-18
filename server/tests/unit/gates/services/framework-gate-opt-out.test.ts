// @lifecycle canonical - Unit tests for F2: the default framework gate must honour every veto.
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { GateEnhancementService } from '../../../../src/engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '../../../../src/engine/gates/services/gate-metrics-recorder.js';

import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';
import type { GatesConfig } from '../../../../src/engine/gates/types.js';

/**
 * F2. `GateSetResolver` withholds the active framework's gates on three conditions — the
 * framework is not injected, the operator switch is off, or the prompt author wrote
 * `framework_gates: false`. `ensureDefaultFrameworkGate` then appended `framework-compliance`
 * consulting only the operator switch, silently reinstating what had just been withheld.
 *
 * These assertions sit at the SERVICE, not the resolver, because that is the only level where
 * the defect is observable: the resolver's veto was always correct, and every resolver test
 * passed while `>>` enforced the gate anyway.
 *
 * `run-wide-gate` rides along in every case so the assertion discriminates "framework gate
 * withheld" from "nothing resolved at all" — an empty list would pass either way.
 */

const FRAMEWORK_GATE = 'framework-compliance';
const PLANNED_GATE = 'run-wide-gate';

const createLogger = () =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) as never;

/** Echoes the ids back so enhancement never fails the call for unrelated reasons. */
const createGateService = () =>
  ({
    supportsValidation: jest.fn().mockReturnValue(false),
    updateConfig: jest.fn(),
    enhancePrompt: jest.fn(async (prompt: { userMessageTemplate: string }) => ({
      enhancedPrompt: prompt,
      gateInstructionsInjected: true,
      injectedGateIds: [],
      instructionLength: 0,
    })),
  }) as never;

const GATES_CONFIG: GatesConfig = {
  enabled: true,
  definitionsDirectory: 'gates',
  enableFrameworkGates: true,
} as GatesConfig;

interface Scenario {
  /** The prompt author's `gateConfiguration.framework_gates`. */
  readonly frameworkGates?: boolean;
  /** The prompt author's `injection['system-prompt'].enabled`. */
  readonly systemPromptInjection?: boolean;
  /** Execution modifiers, e.g. `{ clean: true }`. */
  readonly modifiers?: Record<string, boolean>;
  /** Operator switch; defaults to enabled. */
  readonly enableFrameworkGates?: boolean;
  /** Active framework id; `undefined` means no framework is active. */
  readonly activeFrameworkId?: string | undefined;
}

/**
 * Resolve one single-prompt execution and return the gate ids the service settled on.
 *
 * Reads `executionPlan.gates` rather than `state.gates.accumulatedGateIds`: the service
 * early-returns before writing the latter when the set is empty, and an empty set is one of
 * the outcomes under test.
 */
const resolveGateIds = async (scenario: Scenario = {}): Promise<readonly string[]> => {
  const prompt = {
    id: 'demo',
    name: 'demo',
    description: '',
    category: 'analysis',
    userMessageTemplate: 'Do the thing.',
    systemMessage: '',
    arguments: [],
    ...(scenario.frameworkGates === undefined
      ? {}
      : { gateConfiguration: { framework_gates: scenario.frameworkGates } }),
    ...(scenario.systemPromptInjection === undefined
      ? {}
      : { injection: { 'system-prompt': { enabled: scenario.systemPromptInjection } } }),
  } as unknown as ConvertedPrompt;

  const service = new GateEnhancementService(
    createGateService(),
    undefined,
    () => (scenario.activeFrameworkId === undefined ? 'cageerf' : scenario.activeFrameworkId),
    () => undefined as never,
    undefined,
    new GateMetricsRecorder(undefined),
    createLogger()
  );

  const context = new ExecutionContext({ command: '>>demo' } as never);
  context.executionPlan = {
    strategy: 'single',
    gates: [PLANNED_GATE],
    requiresFramework: false,
    requiresSession: false,
    llmValidationEnabled: false,
    ...(scenario.modifiers === undefined ? {} : { modifiers: scenario.modifiers }),
  } as never;

  await service.enhanceSinglePrompt(
    { type: 'single', prompt, inlineGateIds: [] },
    context,
    { temporaryGateIds: [], canonicalGateIds: [] },
    scenario.enableFrameworkGates === false
      ? ({ ...GATES_CONFIG, enableFrameworkGates: false } as GatesConfig)
      : GATES_CONFIG,
    new Set([FRAMEWORK_GATE])
  );

  // `executionPlan` is assigned through `as never` above, so it must be re-typed to be read.
  const plan = context.executionPlan as unknown as { gates?: string[] } | undefined;
  return plan?.gates ?? [];
};

describe('default framework gate honours the resolver vetoes (F2)', () => {
  test('control: an active, injected framework still gets the default gate', async () => {
    const gateIds = await resolveGateIds();

    // Without this the whole suite would pass on a service that appends nothing.
    expect(gateIds).toContain(FRAMEWORK_GATE);
    expect(gateIds).toContain(PLANNED_GATE);
  });

  test('`framework_gates: false` withholds it — the shipped defect', async () => {
    const gateIds = await resolveGateIds({ frameworkGates: false });

    expect(gateIds).not.toContain(FRAMEWORK_GATE);
    expect(gateIds).toContain(PLANNED_GATE);
  });

  test('`system-prompt.enabled: false` withholds it — CHANGELOG 3.0.0 claims this', async () => {
    const gateIds = await resolveGateIds({ systemPromptInjection: false });

    expect(gateIds).not.toContain(FRAMEWORK_GATE);
    expect(gateIds).toContain(PLANNED_GATE);
  });

  /**
   * Pre-existing behaviour, kept as a boundary marker and NOT as coverage of the veto guard:
   * `%lean` and `%clean` make `FrameworkDecisionAuthority` return no framework at all
   * (`framework-decision-authority.ts:115-130`), so `activeFrameworkId` is undefined and the
   * FIRST guard already blocks the append. Measured: this case survives the mutation that
   * removes the veto guard, which is exactly why it is labelled this way.
   */
  test('a suppressing modifier withholds it — via activeFrameworkId, not the vetoes', async () => {
    const gateIds = await resolveGateIds({ modifiers: { lean: true } });

    expect(gateIds).not.toContain(FRAMEWORK_GATE);
    expect(gateIds).toContain(PLANNED_GATE);
  });

  test('the operator switch still withholds it (unchanged behaviour)', async () => {
    const gateIds = await resolveGateIds({ enableFrameworkGates: false });

    expect(gateIds).not.toContain(FRAMEWORK_GATE);
  });

  test('`framework_gates: true` is not treated as an opt-out', async () => {
    const gateIds = await resolveGateIds({ frameworkGates: true });

    expect(gateIds).toContain(FRAMEWORK_GATE);
  });
});
