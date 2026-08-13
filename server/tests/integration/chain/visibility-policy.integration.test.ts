import { describe, expect, jest, test } from '@jest/globals';

import { ChainOperatorExecutor } from '../../../src/engine/execution/operators/chain-operator-executor.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';

import type { ChainStepPrompt } from '../../../src/engine/execution/operators/types.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { VisibilityItem } from '../../../src/shared/types/chain-execution.js';

/**
 * P5 Tier 3 — the consumer tier: a `visibility:` declaration parsed in Tier 1 and ruled on by
 * the Tier 2 policy actually changes what a step's render contains.
 *
 * Composed from production units — the real `ChainOperatorExecutor`, the real
 * `decideVisibility`, the real `DelegationRenderer` — with only the logger stubbed. The seam is
 * `renderStep`, the same one `18-execution-stage.ts` and `20-gate-review-stage.ts` call, so
 * every assertion here is about text a client would actually receive.
 *
 * Absence is asserted against the withheld VALUE, never merely against the presence of a
 * replacement banner: a render that both announced the withholding and leaked the content would
 * pass the weaker check.
 */

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

const STEP1_OUTPUT = 'STEP_ONE_SECRET_OUTPUT';
const STEP2_OUTPUT = 'STEP_TWO_SECRET_OUTPUT';

const convertedPrompts: ConvertedPrompt[] = [
  {
    id: 'research',
    name: 'Research',
    description: 'Research a topic',
    category: 'analysis',
    userMessageTemplate: 'Research: {{topic}}',
    arguments: [{ name: 'topic', type: 'string', description: 'Topic', required: false }],
  },
  {
    id: 'draft',
    name: 'Draft',
    description: 'Draft from prior work',
    category: 'analysis',
    userMessageTemplate: 'Prior: {{previous_step_output}}',
    arguments: [],
  },
  {
    id: 'review',
    name: 'Review',
    description: 'Review the whole run',
    category: 'analysis',
    // Reaches for BOTH visibility items that can appear in a template, so one render
    // discriminates between them.
    userMessageTemplate: 'Prior: {{previous_step_output}} / History: {{step1_result}}',
    arguments: [],
  },
];

const buildExecutor = (): ChainOperatorExecutor =>
  new ChainOperatorExecutor(createLogger(), convertedPrompts);

/** Three planned steps; `declarations[i]` is step i+1's `visibility`, `undefined` for none. */
const buildSteps = (
  declarations: readonly (ChainStepPrompt['visibility'] | undefined)[] = [],
  overrides: readonly (Partial<ChainStepPrompt> | undefined)[] = []
): ChainStepPrompt[] =>
  ['research', 'draft', 'review'].map((promptId, index) => ({
    stepNumber: index + 1,
    promptId,
    args: {},
    ...(declarations[index] != null ? { visibility: declarations[index] } : {}),
    ...(overrides[index] ?? {}),
  }));

/**
 * The chain context a live run would carry after two completed steps: the positional history
 * surface published by `TextReferenceStore.buildChainVariables` plus the ledger published by
 * `ChainSessionStore.getChainContext`.
 */
const chainContext = (): Record<string, unknown> => ({
  chain_id: 'chain-visibility',
  // Present on real runs: `prompt_engine` writes the resumed `user_response` here
  // (`mcp/tools/index.ts`), and the gate-review render reads the context straight through
  // rather than assigning this key itself.
  previous_step_output: STEP2_OUTPUT,
  step_results: { '1': STEP1_OUTPUT, '2': STEP2_OUTPUT },
  step1_result: STEP1_OUTPUT,
  step2_result: STEP2_OUTPUT,
  previous_step_results: { 1: STEP1_OUTPUT, 2: STEP2_OUTPUT },
  unknowns_ledger: [
    {
      id: 'cache-ttl',
      statement: 'LEDGER_SECRET_STATEMENT',
      state: 'active',
      blocking: true,
      discoveredAtStep: 1,
    },
  ],
});

const withhold = (...items: VisibilityItem[]): ChainStepPrompt['visibility'] => ({
  withhold: [...items],
});
const expose = (...items: VisibilityItem[]): ChainStepPrompt['visibility'] => ({
  expose: [...items],
});

const renderStep = async (
  steps: ChainStepPrompt[],
  currentStepIndex: number
): ReturnType<ChainOperatorExecutor['renderStep']> =>
  buildExecutor().renderStep({
    executionType: 'normal',
    stepPrompts: steps,
    currentStepIndex,
    chainContext: chainContext(),
  });

/**
 * Gate-review render of step 3 (the step whose template reaches for both a previous output and
 * a history entry). `resolveReviewStep` reads the reviewed step from `metadata.stepNumber` —
 * NOT from any top-level field — so the target is pinned there rather than left to the
 * last-step fallback.
 */
const renderReview = async (
  steps: ChainStepPrompt[]
): ReturnType<ChainOperatorExecutor['renderStep']> =>
  buildExecutor().renderStep({
    executionType: 'gate_review',
    stepPrompts: steps,
    chainContext: chainContext(),
    pendingGateReview: {
      combinedPrompt: 'review the step',
      gateIds: ['code-quality'],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 0,
      maxAttempts: 3,
      metadata: { stepNumber: 3 },
    },
    additionalGateIds: [],
  });

describe('P5 visibility — previous_step_output', () => {
  test('a prior withhold keeps the stored output out of the next step’s render', async () => {
    const withheldRender = await renderStep(
      buildSteps([undefined, withhold('previous_step_output')]),
      2
    );

    expect(withheldRender.content).not.toContain(STEP2_OUTPUT);
    expect(withheldRender.content).toContain('[CONTEXT WITHHELD]');
    // Names the withholder by the same display name the existing `[CONTEXT INSTRUCTION]`
    // fallback uses — `getPromptDisplayName`, which falls back to the prompt id when the step
    // carries no resolved `convertedPrompt`.
    expect(withheldRender.content).toContain("Step 2 (draft)'s output was withheld");
  });

  test('control: the same render WITHOUT the declaration carries the output', async () => {
    const control = await renderStep(buildSteps(), 2);

    expect(control.content).toContain(STEP2_OUTPUT);
    expect(control.content).not.toContain('[CONTEXT WITHHELD]');
  });

  test('the withhold does not reach the step that declared it (only later steps)', async () => {
    // Step 2 declares `withhold: previous_step_output`; step 2's own render must still see
    // step 1's output. A policy applied to its own declarer would fail here.
    const render = await renderStep(buildSteps([undefined, withhold('previous_step_output')]), 1);

    expect(render.content).toContain(STEP1_OUTPUT);
    expect(render.content).not.toContain('[CONTEXT WITHHELD]');
  });

  test('a later expose overrides the prior withhold for that step only', async () => {
    const steps = buildSteps([
      withhold('previous_step_output'),
      undefined,
      expose('previous_step_output'),
    ]);

    const withheldForStep2 = await renderStep(steps, 1);
    const exposedForStep3 = await renderStep(steps, 2);

    expect(withheldForStep2.content).not.toContain(STEP1_OUTPUT);
    expect(exposedForStep3.content).toContain(STEP2_OUTPUT);
    expect(exposedForStep3.content).not.toContain('[CONTEXT WITHHELD]');
  });
});

describe('P5 visibility — chain_history', () => {
  test('withholding chain_history strips the accumulated results from the template context', async () => {
    const render = await renderStep(buildSteps([withhold('chain_history')]), 2);

    // `{{step1_result}}` renders empty; the immediately-preceding output is a DIFFERENT item
    // and still flows.
    expect(render.content).not.toContain(STEP1_OUTPUT);
    expect(render.content).toContain(STEP2_OUTPUT);
  });

  test('control: without the declaration the history renders', async () => {
    const control = await renderStep(buildSteps(), 2);

    expect(control.content).toContain(STEP1_OUTPUT);
    expect(control.content).toContain(STEP2_OUTPUT);
  });

  test('inputMapping cannot re-publish a withheld history entry under another name', async () => {
    // `{ topic: 'step1_result' }` would alias the stripped key back into scope if the strip ran
    // after the mapping instead of before it.
    const steps = buildSteps(
      [withhold('chain_history')],
      [undefined, undefined, { inputMapping: { topic: 'step1_result' } }]
    );
    const render = await renderStep(steps, 2);

    expect(render.content).not.toContain(STEP1_OUTPUT);
  });
});

describe('P5 visibility — unknowns_ledger', () => {
  test('withholding the ledger removes the section entirely, not just its values', async () => {
    const render = await renderStep(buildSteps([withhold('unknowns_ledger')]), 1);

    expect(render.content).not.toContain('Unknowns Ledger');
    expect(render.content).not.toContain('LEDGER_SECRET_STATEMENT');
    expect(render.content).not.toContain('cache-ttl');
  });

  test('control: without the declaration the ledger section renders', async () => {
    const control = await renderStep(buildSteps(), 1);

    expect(control.content).toContain('### Unknowns Ledger');
    expect(control.content).toContain('LEDGER_SECRET_STATEMENT');
  });

  test('the gate-review render honours every withheld item, not just the ledger', async () => {
    // Review path (`renderGateReviewStep`) re-renders the reviewed step's own template as
    // "Original Task Instructions", from its own template context and its own
    // `buildUnknownsSection` call site. All three items are withheld here so a decision applied
    // to the section but not the template context (or the reverse) fails.
    const review = await renderReview(
      buildSteps([withhold('unknowns_ledger', 'previous_step_output', 'chain_history')])
    );

    expect(review.content).not.toContain('Unknowns Ledger');
    expect(review.content).not.toContain('LEDGER_SECRET_STATEMENT');
    expect(review.content).not.toContain(STEP2_OUTPUT);
    expect(review.content).not.toContain(STEP1_OUTPUT);
    expect(review.content).toContain('[CONTEXT WITHHELD]');
  });

  test('control: the gate-review render carries all three with no declaration', async () => {
    const review = await renderReview(buildSteps());

    expect(review.content).toContain('Unknowns Ledger');
    expect(review.content).toContain('LEDGER_SECRET_STATEMENT');
    expect(review.content).toContain(STEP1_OUTPUT);
    expect(review.content).toContain(STEP2_OUTPUT);
    expect(review.content).not.toContain('[CONTEXT WITHHELD]');
  });
});

describe('P5 visibility — delegation manifest', () => {
  const delegatedSteps = (
    declarations: readonly (ChainStepPrompt['visibility'] | undefined)[]
  ): ChainStepPrompt[] =>
    buildSteps(declarations, [undefined, { delegated: true, agentType: 'chain-executor' }]);

  test('the handoff CTA names withheld items and carries none of their values', async () => {
    const render = await renderStep(
      delegatedSteps([withhold('chain_history', 'unknowns_ledger')]),
      0
    );

    expect(render.callToAction).toContain('CONTEXT WITHHELD (names only, values not provided)');
    expect(render.callToAction).toContain('chain_history');
    expect(render.callToAction).toContain('unknowns_ledger');
    expect(render.callToAction).not.toContain(STEP1_OUTPUT);
    expect(render.callToAction).not.toContain('LEDGER_SECRET_STATEMENT');
  });

  test('control: an undeclared chain’s handoff CTA gains no envelope at all', async () => {
    const render = await renderStep(delegatedSteps([]), 0);

    expect(render.callToAction).toContain('HANDOFF: Execute Step 2');
    expect(render.callToAction).not.toContain('EXECUTION CONTEXT');
    expect(render.callToAction).not.toContain('CONTEXT WITHHELD');
  });

  test('the manifest describes the DELEGATED step, not the step doing the handing off', async () => {
    // Step 2 (the delegated one) exposes what step 1 withheld. The CTA rendered during step 1
    // must report nothing withheld — a manifest computed for the rendering step would report
    // `chain_history` here.
    const render = await renderStep(
      delegatedSteps([withhold('chain_history'), expose('chain_history')]),
      0
    );

    expect(render.callToAction).not.toContain('CONTEXT WITHHELD');
  });
});

describe('P5 visibility — the no-declarations guarantee', () => {
  test('a chain declaring nothing renders byte-identically', async () => {
    const render = await renderStep(buildSteps(), 2);

    // Exact equality, not `toContain`: the load-bearing regression criterion for this phase is
    // that P5 is INVISIBLE to a chain with no `visibility:` anywhere. Any stray manifest line,
    // banner, blank line, or reordered section changes this string and fails here — which
    // `toContain` probes, by construction, cannot detect.
    expect(render.content).toBe(
      [
        '### Unknowns Ledger',
        '',
        'Unknowns declared so far in this run. Resolve blocking unknowns before proceeding where possible:',
        '',
        '- **cache-ttl** **[BLOCKING]**: LEDGER_SECRET_STATEMENT',
        '',
        `Prior: ${STEP2_OUTPUT} / History: ${STEP1_OUTPUT}`,
        '',
        '---',
        '',
        '### Required Response Format',
        '',
        '**Summary**: What was implemented (2-3 sentences)',
        '',
        '**Gate Coverage**:',
        '- [1] PASS|FAIL: rationale',
        '- [2] PASS|FAIL: rationale',
        '',
        '**GATE_REVIEW: PASS|FAIL - overall assessment**',
      ].join('\n')
    );
    expect(render.callToAction).toBe(
      'Deliver the final response to the user (no user_response needed once the chain completes).'
    );
  });
});

/**
 * P6 Tier 3 — named outputs under the reserved `outputs.<name>` namespace (OQ-P6-5, owner ruled
 * the ALTERNATIVE), and the P5-F2 leak that namespace exists to close.
 *
 * The context here is built by the REAL `TextReferenceStore`, not hand-written: the producer
 * (L3) and the withholder (L2) cannot import each other, so the only thing that proves they
 * agree on the namespace key is running both. A hand-written `{ outputs: … }` fixture would
 * pass against a producer that publishes under any other name.
 */
describe('P6 named outputs — reserved namespace + the chain_history leak', () => {
  const NAMED_OUTPUT = 'NAMED_OUTPUT_SECRET_BODY';

  const namedOutputPrompts: ConvertedPrompt[] = [
    {
      id: 'analyze',
      name: 'Analyze',
      description: 'Analyze',
      category: 'analysis',
      userMessageTemplate: 'Analyze it',
      arguments: [],
    },
    {
      id: 'synthesize',
      name: 'Synthesize',
      description: 'Synthesize from a named output',
      category: 'analysis',
      // Reaches for the namespaced name AND the bare one, so a single render tells "published
      // under outputs" apart from "still spread flat" — a template asserting only the former
      // would pass on a dual-read implementation.
      userMessageTemplate: 'Named: [{{outputs.findings}}] Bare: [{{findings}}]',
      arguments: [],
    },
  ];

  /** Context a live run carries after step 1 stored a result with an `outputMapping`. */
  const namedOutputContext = (): Record<string, unknown> => {
    const store = new TextReferenceStore(createLogger());
    store.storeChainStepResult('chain-named', 'analyze', NAMED_OUTPUT, {
      outputMapping: { findings: 'output' },
    });
    return { ...store.buildChainVariables('chain-named'), chain_id: 'chain-named' };
  };

  const namedOutputSteps = (
    declarations: readonly (ChainStepPrompt['visibility'] | undefined)[] = []
  ): ChainStepPrompt[] =>
    ['analyze', 'synthesize'].map((promptId, index) => ({
      stepNumber: index + 1,
      promptId,
      args: {},
      ...(declarations[index] != null ? { visibility: declarations[index] } : {}),
    }));

  const renderNamed = async (
    steps: ChainStepPrompt[],
    currentStepIndex: number
  ): ReturnType<ChainOperatorExecutor['renderStep']> =>
    new ChainOperatorExecutor(createLogger(), namedOutputPrompts).renderStep({
      executionType: 'normal',
      stepPrompts: steps,
      currentStepIndex,
      chainContext: namedOutputContext(),
    });

  test('step 2 reads a step-1 named output as {{outputs.findings}}, and the bare alias is gone', async () => {
    const render = await renderNamed(namedOutputSteps(), 1);

    expect(render.content).toContain(`Named: [${NAMED_OUTPUT}]`);
    // The migration criterion, not a formatting detail: a template still written against
    // `{{findings}}` renders empty. No dual read (cleanup-standards: no parallel system).
    expect(render.content).toContain('Bare: []');
  });

  test('withholding chain_history removes the named output — the P5-F2 leak', async () => {
    const render = await renderNamed(namedOutputSteps([withhold('chain_history')]), 1);

    // Against the withheld VALUE, not against a banner: a render that announced the withholding
    // and still leaked the bytes would pass a banner-only assertion.
    expect(render.content).not.toContain(NAMED_OUTPUT);
    expect(render.content).toContain('Named: []');
  });

  test('control: the same render WITHOUT the declaration carries the named output', async () => {
    const control = await renderNamed(namedOutputSteps(), 1);

    expect(control.content).toContain(NAMED_OUTPUT);
  });

  test('withholding previous_step_output alone leaves the named output in place', async () => {
    // Deliberate asymmetry, asserted so it cannot be "fixed" by accident: a named output is the
    // same content `step{N}_result` publishes positionally, and `previous_step_output` leaves
    // those in place by design. Withholding the alias but not the thing it aliases would make
    // the rule depend on which name the author chose.
    const render = await renderNamed(namedOutputSteps([withhold('previous_step_output')]), 1);

    expect(render.content).toContain(`Named: [${NAMED_OUTPUT}]`);
  });

  test('a later expose of chain_history restores the named output for that step', async () => {
    const render = await renderNamed(
      namedOutputSteps([withhold('chain_history'), expose('chain_history')]),
      1
    );

    expect(render.content).toContain(`Named: [${NAMED_OUTPUT}]`);
  });
});
