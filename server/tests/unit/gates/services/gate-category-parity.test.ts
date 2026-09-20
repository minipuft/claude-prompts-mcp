// @lifecycle canonical - Unit tests for B.91: selection and render ask with the same category.
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { GateEnhancementService } from '../../../../src/engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '../../../../src/engine/gates/services/gate-metrics-recorder.js';

import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';
import type { GateSystemSettings } from '../../../../src/shared/types/index.js';

/**
 * B.91. One request asked the category question twice and accepted two answers: gate SELECTION
 * read `prompt.category`, gate RENDER read `executionPlan.category`. Any coercion between them —
 * `CategoryExtractor`'s eight-name allow-list rewriting six real categories to `general` was the
 * live one — selected a gate at rank 20, named it in the `**Gates**:` attestation footer, and
 * then dropped its guidance at render. Nothing failed: the model was simply asked to attest text
 * it had never been shown.
 *
 * These assertions sit at the SERVICE because that is the only level where the two calls are
 * visible together. `CategoryExtractor`'s own tests cover the coercion that was removed; this one
 * covers the property that makes any future coercion harmless — whatever the category is, both
 * calls ask with it. The chain-step path already read `prompt.category` on both sides, so the
 * third test is that path as the sibling control.
 */

const CATEGORY_GATE = 'category-scoped-gate';
const FRAMEWORK_GATE = 'framework-compliance';

const createLogger = () =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) as never;

const GATES_CONFIG = {
  enabled: true,
  definitionsDirectory: 'gates',
  enableFrameworkGates: true,
} as GateSystemSettings;

interface Observation {
  /** Every `promptCategory` the registry selection was queried with. */
  readonly selectedWith: (string | undefined)[];
  /** The `category` on the GateContext the renderer is handed. */
  readonly renderedWith: (string | undefined)[];
  readonly gateIds: readonly string[];
}

/**
 * Resolve one single-prompt execution, recording both category reads.
 *
 * `isInitialized: false` on the stub manager short-circuits the resolver's existence gate, so a
 * selected id survives without the stub having to model the whole registry.
 */
const enhance = async (args: {
  promptCategory?: string;
  planCategory?: string;
}): Promise<Observation> => {
  const selectedWith: (string | undefined)[] = [];
  const renderedWith: (string | undefined)[] = [];

  const gateService = {
    supportsValidation: jest.fn().mockReturnValue(false),
    updateConfig: jest.fn(),
    enhancePrompt: jest.fn(
      async (
        prompt: { userMessageTemplate: string },
        _gateIds: string[],
        gateCtx: { category?: string }
      ) => {
        renderedWith.push(gateCtx.category);
        return {
          enhancedPrompt: prompt,
          gateInstructionsInjected: true,
          injectedGateIds: [],
          instructionLength: 0,
        };
      }
    ),
  } as never;

  const gateManager = {
    isInitialized: false,
    selectGates: (context: { promptCategory?: string }) => {
      selectedWith.push(context.promptCategory);
      return { guides: [], selectedIds: [CATEGORY_GATE], skippedIds: [] };
    },
  } as never;

  const prompt = {
    id: 'demo',
    name: 'demo',
    description: '',
    userMessageTemplate: 'Do the thing.',
    systemMessage: '',
    arguments: [],
    ...(args.promptCategory === undefined ? {} : { category: args.promptCategory }),
  } as unknown as ConvertedPrompt;

  const service = new GateEnhancementService(
    gateService,
    undefined,
    () => 'cageerf',
    () => gateManager,
    undefined,
    new GateMetricsRecorder(undefined),
    createLogger()
  );

  const context = new ExecutionContext({ command: '>>demo' } as never);
  context.executionPlan = {
    strategy: 'single',
    gates: [],
    requiresFramework: false,
    requiresSession: false,
    llmValidationEnabled: false,
    ...(args.planCategory === undefined ? {} : { category: args.planCategory }),
  } as never;

  await service.enhanceSinglePrompt(
    { type: 'single', prompt, inlineGateIds: [] },
    context,
    { temporaryGateIds: [], canonicalGateIds: [] },
    GATES_CONFIG,
    new Set([FRAMEWORK_GATE])
  );

  const plan = context.executionPlan as unknown as { gates?: string[] } | undefined;
  return { selectedWith, renderedWith, gateIds: plan?.gates ?? [] };
};

describe('one category per request, asked twice (B.91)', () => {
  /**
   * The control. Without it every assertion below would also pass on a service that selects
   * nothing and renders nothing, and "no gate reached the renderer" is the failure under test.
   */
  test('control: a category-scoped gate is selected and reaches the renderer', async () => {
    const observed = await enhance({ promptCategory: 'workflow', planCategory: 'workflow' });

    expect(observed.gateIds).toContain(CATEGORY_GATE);
    expect(observed.selectedWith).toContain('workflow');
    expect(observed.renderedWith).toEqual(['workflow']);
  });

  test('a plan whose category was rewritten does not decide the render — the shipped defect', async () => {
    // Exactly the live shape before B.91: the prompt declares `workflow`, `CategoryExtractor`
    // rewrote it to `general` on the plan, and the renderer read the rewritten value.
    const observed = await enhance({ promptCategory: 'workflow', planCategory: 'general' });

    expect(observed.gateIds).toContain(CATEGORY_GATE);
    expect(observed.selectedWith).toContain('workflow');
    expect(observed.renderedWith).toEqual(['workflow']);
    expect(observed.renderedWith).not.toContain('general');
  });

  test('the two reads agree whatever the plan says', async () => {
    const observed = await enhance({ promptCategory: 'examples', planCategory: 'documentation' });

    expect(new Set([...observed.selectedWith, ...observed.renderedWith])).toEqual(
      new Set(['examples'])
    );
  });

  test("a prompt carrying no category of its own falls back to the plan's, on both sides", async () => {
    const observed = await enhance({ planCategory: 'analysis' });

    expect(observed.selectedWith).toContain('analysis');
    expect(observed.renderedWith).toEqual(['analysis']);
  });

  test('a run with no category anywhere declares none, rather than inventing one', async () => {
    const observed = await enhance({});

    // The resolver's own `'' -> 'general'` fallback is its business; what must not happen is the
    // renderer being handed a category the selection never asked with.
    expect(observed.renderedWith).toEqual([undefined]);
  });
});
