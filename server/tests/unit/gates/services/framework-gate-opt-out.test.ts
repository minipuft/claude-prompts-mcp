// @lifecycle canonical - Unit tests for F2: the default framework gate must honour every veto.
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { GateEnhancementService } from '../../../../src/engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '../../../../src/engine/gates/services/gate-metrics-recorder.js';

import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';
import type { GateSystemSettings } from '../../../../src/shared/types/index.js';

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

const GATES_CONFIG: GateSystemSettings = {
  enabled: true,
  definitionsDirectory: 'gates',
  enableFrameworkGates: true,
} as GateSystemSettings;

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
  /** The prompt author's `gateConfiguration.exclude`. */
  readonly exclude?: readonly string[];
  /**
   * Whether the run could identify the framework's gate ids at all. `false` passes an empty set,
   * which is what a missing or failing `GateLoader` produces.
   */
  readonly frameworkGatesIdentified?: boolean;
}

/**
 * Resolve one single-prompt execution and return the gate ids the service settled on.
 *
 * Reads `executionPlan.gates` rather than `state.gates.accumulatedGateIds`: the service
 * early-returns before writing the latter when the set is empty, and an empty set is one of
 * the outcomes under test.
 */
const resolveGateIds = async (scenario: Scenario = {}): Promise<readonly string[]> => {
  // Composed rather than spread per field: `framework_gates` and `exclude` are two keys of ONE
  // block, and the `exclude`-alone case must be a twin of the control differing in that key only.
  const gateConfiguration: Record<string, unknown> = {};
  if (scenario.frameworkGates !== undefined) {
    gateConfiguration['framework_gates'] = scenario.frameworkGates;
  }
  if (scenario.exclude !== undefined) {
    gateConfiguration['exclude'] = [...scenario.exclude];
  }

  const prompt = {
    id: 'demo',
    name: 'demo',
    description: '',
    category: 'analysis',
    userMessageTemplate: 'Do the thing.',
    systemMessage: '',
    arguments: [],
    ...(Object.keys(gateConfiguration).length === 0 ? {} : { gateConfiguration }),
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
      ? ({ ...GATES_CONFIG, enableFrameworkGates: false } as GateSystemSettings)
      : GATES_CONFIG,
    scenario.frameworkGatesIdentified === false ? new Set<string>() : new Set([FRAMEWORK_GATE])
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

  /**
   * The case a ranked veto cannot express. With no framework gate ids identified there is
   * nothing for a veto to name, so the veto set is empty — but the fallback exists precisely to
   * supply a framework gate when none was identified, so it must still be refused.
   *
   * Control below: the same unidentified state with no opt-out still appends.
   */
  test('`framework_gates: false` withholds it even when no framework gate ids resolve', async () => {
    const gateIds = await resolveGateIds({
      frameworkGates: false,
      frameworkGatesIdentified: false,
    });

    expect(gateIds).not.toContain(FRAMEWORK_GATE);
    expect(gateIds).toContain(PLANNED_GATE);
  });

  test('unidentified framework gate ids alone do not withhold it', async () => {
    const gateIds = await resolveGateIds({ frameworkGatesIdentified: false });

    expect(gateIds).toContain(FRAMEWORK_GATE);
  });

  test('`framework_gates: true` is not treated as an opt-out', async () => {
    const gateIds = await resolveGateIds({ frameworkGates: true });

    expect(gateIds).toContain(FRAMEWORK_GATE);
  });
});

/**
 * Issue #228. The residual of F2: the append consulted the three FRAMEWORK conditions and nothing
 * else, so the author's `exclude` list — a veto `GateSetResolver` builds and applies correctly one
 * line earlier — was invisible to it and the gate came straight back.
 *
 * The pre-existing coverage combined `exclude` with `framework_gates: false`, which puts a
 * framework veto in play and makes the append skip for a different reason; the case had no test
 * that could fail. Every scenario below therefore sets `exclude` and NOTHING else — a twin of the
 * control in exactly one key.
 */
describe('the default framework gate honours `exclude` (issue #228)', () => {
  test('`exclude: [framework-compliance]` alone withholds it — the shipped defect', async () => {
    const gateIds = await resolveGateIds({ exclude: [FRAMEWORK_GATE] });

    expect(gateIds).not.toContain(FRAMEWORK_GATE);
    // Discriminates "this gate was withheld" from "nothing resolved at all".
    expect(gateIds).toContain(PLANNED_GATE);
  });

  test('excluding an unrelated gate does not withhold it', async () => {
    const gateIds = await resolveGateIds({ exclude: ['some-other-gate'] });

    expect(gateIds).toContain(FRAMEWORK_GATE);
  });

  /**
   * The CLASS, not the site. `ensureDefaultFrameworkGate` is today the only code that adds a gate
   * id after the resolver has applied its vetoes, but a future one would arrive the same way: an
   * id in the served set that no veto was ever asked about.
   *
   * So this enumerates the set from the run itself rather than from a literal list — every id the
   * control resolves must disappear when the author excludes it alone. A new appender puts its id
   * in the control set, and the loop then demands that id honour `exclude` too.
   */
  test('every gate the control resolves can be excluded by id, one at a time', async () => {
    const control = await resolveGateIds();
    expect(control.length).toBeGreaterThan(1);

    for (const gateId of control) {
      const withoutIt = await resolveGateIds({ exclude: [gateId] });
      expect({ excluded: gateId, resolved: withoutIt }).toEqual({
        excluded: gateId,
        resolved: control.filter((id) => id !== gateId),
      });
    }
  });
});

/**
 * P4.110. The same declaration on a CHAIN step could not remove the same gate, because a chain
 * step's set was never built from that step's resolution alone: `enhanceChainSteps` seeds the
 * caller's gates into a cumulative accumulator before the walk, and every earlier step leaves its
 * accepted gates there. `stepApplicableGateIds` read that accumulator raw, so a gate that arrived
 * from anywhere but this step's own resolution reached the step without passing its vetoes.
 *
 * The seeded canonical gate is the witness: it arrives at rank 40 (`framework-guide`), below the
 * rank `exclude` binds to, so the resolver would have removed it — and did, on the single-prompt
 * path, from the byte-identical `gateConfiguration`.
 */
const SEEDED_CANONICAL_GATE = 'seeded-canonical-gate';
const SEEDED_CALLER_GATE = 'seeded-caller-gate';

interface ChainScenario {
  /** `gateConfiguration.exclude` on step 1 only — step 2 is its twin without the key. */
  readonly excludeOnStepOne?: readonly string[];
  /** Canonical ids the run seeds at rank 40, as a resolved `gates` parameter does. */
  readonly seededCanonical?: readonly string[];
  /** Temporary gate ids the run seeds at rank 80, as the caller's own `gates` spec does. */
  readonly seededTemporary?: readonly string[];
}

/** promptId → the gate ids the service handed that step's enhancement. */
const resolveChainStepGateIds = async (
  scenario: ChainScenario = {}
): Promise<Record<string, readonly string[]>> => {
  const applied: Record<string, readonly string[]> = {};
  const gateService = {
    supportsValidation: jest.fn().mockReturnValue(false),
    updateConfig: jest.fn(),
    enhancePrompt: jest.fn(
      async (prompt: { id: string; userMessageTemplate: string }, gateIds: readonly string[]) => {
        applied[prompt.id] = [...gateIds];
        return {
          enhancedPrompt: prompt,
          gateInstructionsInjected: true,
          injectedGateIds: [],
          instructionLength: 0,
        };
      }
    ),
  } as never;

  const makePrompt = (id: string, exclude?: readonly string[]): ConvertedPrompt =>
    ({
      id,
      name: id,
      description: '',
      category: 'analysis',
      userMessageTemplate: `Do ${id}.`,
      systemMessage: '',
      arguments: [],
      ...(exclude === undefined ? {} : { gateConfiguration: { exclude: [...exclude] } }),
    }) as unknown as ConvertedPrompt;

  const steps = [
    {
      stepNumber: 1,
      nodeId: 'n1',
      promptId: 'step-one',
      args: {},
      convertedPrompt: makePrompt('step-one', scenario.excludeOnStepOne),
      executionPlan: { gates: [PLANNED_GATE] },
    },
    {
      stepNumber: 2,
      nodeId: 'n2',
      promptId: 'step-two',
      args: {},
      convertedPrompt: makePrompt('step-two'),
      executionPlan: { gates: [PLANNED_GATE] },
    },
  ];

  const service = new GateEnhancementService(
    gateService,
    undefined,
    () => 'cageerf',
    () => undefined as never,
    undefined,
    new GateMetricsRecorder(undefined),
    createLogger()
  );

  const context = new ExecutionContext({ command: '>>step-one --> >>step-two' } as never);
  context.executionPlan = {
    strategy: 'chain',
    gates: [PLANNED_GATE],
    requiresFramework: false,
    requiresSession: true,
    llmValidationEnabled: false,
  } as never;

  await service.enhanceChainSteps(
    { type: 'chain', steps } as never,
    context,
    {
      temporaryGateIds: [...(scenario.seededTemporary ?? [])],
      canonicalGateIds: [...(scenario.seededCanonical ?? [SEEDED_CANONICAL_GATE])],
    },
    GATES_CONFIG,
    new Set([FRAMEWORK_GATE])
  );

  return applied;
};

describe('a chain step honours its own `exclude` against the run-seeded set (P4.110)', () => {
  test('control: a chain step that excludes nothing gets the seeded canonical gate', async () => {
    const applied = await resolveChainStepGateIds();

    expect(applied['step-one']).toContain(SEEDED_CANONICAL_GATE);
    expect(applied['step-two']).toContain(SEEDED_CANONICAL_GATE);
  });

  test('a step excluding the seeded gate does not get it — the shipped defect', async () => {
    const applied = await resolveChainStepGateIds({
      excludeOnStepOne: [SEEDED_CANONICAL_GATE],
    });

    expect(applied['step-one']).not.toContain(SEEDED_CANONICAL_GATE);
    // Discriminates "this gate was withheld" from "this step resolved nothing".
    expect(applied['step-one']).toContain(PLANNED_GATE);
  });

  test('the SIBLING step, which excludes nothing, keeps it', async () => {
    const applied = await resolveChainStepGateIds({
      excludeOnStepOne: [SEEDED_CANONICAL_GATE],
    });

    expect(applied['step-two']).toContain(SEEDED_CANONICAL_GATE);
  });

  /**
   * The ranked contract, unchanged: `exclude` is an author preference that binds up to rank 60,
   * so it may not remove a gate the CALLER supplied at rank 80. Without this, the fix could have
   * been written with `acceptsUnrankedGate` — which ignores every binding rank — and every other
   * case here would still pass while a prompt author silently overruled the person invoking it.
   */
  test('a step`s exclude does NOT remove a gate the caller supplied at rank 80', async () => {
    const applied = await resolveChainStepGateIds({
      seededTemporary: [SEEDED_CALLER_GATE],
      excludeOnStepOne: [SEEDED_CALLER_GATE],
    });

    expect(applied['step-one']).toContain(SEEDED_CALLER_GATE);
  });

  /**
   * The CLASS, not the site. Any gate reaching a step's set without passing that step's
   * resolution is the same defect, whoever put it there — the run's seed, an earlier step, or a
   * future writer to the accumulator. Enumerated from the control run rather than from a literal
   * list, so a new contributor puts its id in the control set and the loop then demands that id
   * honour `exclude` too.
   *
   * Rank-80 ids are exempt by contract (the case above), and the control seeds none.
   */
  test('every gate the control step resolves can be excluded by id, one at a time', async () => {
    const control = (await resolveChainStepGateIds())['step-one'] ?? [];
    expect(control.length).toBeGreaterThan(1);

    for (const gateId of control) {
      const applied = await resolveChainStepGateIds({ excludeOnStepOne: [gateId] });
      expect({ excluded: gateId, resolved: applied['step-one'] }).toEqual({
        excluded: gateId,
        resolved: control.filter((id) => id !== gateId),
      });
    }
  });
});
