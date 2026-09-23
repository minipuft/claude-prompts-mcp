/**
 * Primitive rework row 3.5 — the gate-review render reads the review by node
 * (`describeReviewForRender`), and for a CURRENT-STEP review that must change nothing a client
 * reads. Each snapshot below was written by the executor as it stood before the row
 * (`fd8b825a`, which read `pendingGateReview`), then re-run unchanged against this one: the
 * graded step, the gate order handed to the guidance renderer, the explicit (inline) gate ids,
 * the retry hints, the last review line and the retry-limit block are all pinned byte for byte.
 */
import { describe, test, expect, jest } from '@jest/globals';

import { ChainOperatorExecutor } from '../../../../src/engine/execution/operators/chain-operator-executor.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any as Logger;

const prompts = [
  {
    id: 'analyze',
    name: 'Code Analyzer',
    description: '',
    category: 'code',
    userMessageTemplate: 'Analyze this code: {{code}}',
    systemMessage: '',
    arguments: [{ name: 'code', type: 'string', description: '', required: true }],
  },
  {
    id: 'summarize',
    name: 'Summarizer',
    description: '',
    category: 'text',
    userMessageTemplate: 'Summarize the analysis.{% if input %} Context: {{input}}{% endif %}',
    systemMessage: '',
    arguments: [{ name: 'input', type: 'string', description: '', required: false }],
  },
] as unknown as ConvertedPrompt[];

/** Echoes what it was handed, so the gate ORDER and the explicit set are part of the snapshot. */
const gateGuidanceRenderer = {
  renderGuidance: async (gateIds: string[], options: { explicitGateIds?: string[] }) =>
    `GUIDANCE gates=${gateIds.join(',')} explicit=${(options.explicitGateIds ?? []).join(',')}`,
};

const steps = [
  { stepNumber: 1, nodeId: 'n1', promptId: 'analyze', args: { code: 'alpha' } },
  {
    stepNumber: 2,
    nodeId: 'n2',
    promptId: 'summarize',
    args: { input: 'beta' },
    inlineGateIds: ['step-inline'],
  },
];

/** A current-step review as `createReviewForStep` writes it: keyed by the node the run stands on. */
const currentStepReview = (over: Record<string, unknown> = {}) => ({
  nodeId: 'n2',
  kind: 'gate',
  phase: 'awaiting-verdict',
  combinedPrompt: 'Review the output',
  gateIds: ['code-quality', 'security'],
  prompts: [
    {
      gateId: 'code-quality',
      criteriaSummary: 'c',
      metadata: { inlineGateIds: ['prompt-inline'] },
    },
  ],
  createdAt: 1,
  attemptCount: 0,
  maxAttempts: 3,
  metadata: { sessionId: 's', stepNumber: 2 },
  ...over,
});

const render = async (over: Record<string, unknown> = {}): Promise<string> => {
  const executor = new ChainOperatorExecutor(logger, prompts, gateGuidanceRenderer);
  const result = await executor.renderStep({
    executionType: 'gate_review',
    stepPrompts: steps,
    chainContext: { current_step: 2 },
    additionalGateIds: ['extra'],
    review: currentStepReview(over) as any,
  });
  return result.content;
};

describe('gate-review render of a current-step review is byte-identical (row 3.5)', () => {
  test('first attempt', async () => {
    expect(await render()).toMatchInlineSnapshot(`
      "## Original Task Instructions

      Summarize the analysis. Context: beta

      ---


      GUIDANCE gates=code-quality,security,extra,step-inline,prompt-inline explicit=step-inline,code-quality,prompt-inline

      **Inline Gate Priority:** These inline gates triggered the review. Fix them before checking framework standards.

      ---

      ### Required Response Format

      **Summary**: What was implemented (2-3 sentences)

      **Gate Coverage**:
      - [1] PASS|FAIL: rationale
      - [2] PASS|FAIL: rationale

      **GATE_REVIEW: PASS|FAIL - overall assessment**"
    `);
  });

  test('a retry with hints and a short last review', async () => {
    expect(
      await render({
        attemptCount: 1,
        retryHints: ['first hint', 'second hint', 'third hint', 'fourth hint'],
        history: [{ timestamp: 1, status: 'fail', reasoning: 'Missing the risk section.' }],
      })
    ).toMatchInlineSnapshot(`
      "## Review Context

      Review the original task and your output above against the gate criteria.

      ---


      GUIDANCE gates=code-quality,security,extra,step-inline,prompt-inline explicit=step-inline,code-quality,prompt-inline

      **Inline Gate Priority:** These inline gates triggered the review. Fix them before checking framework standards.

      **Inline Fix Guidance:**
      - first hint
      - second hint
      - third hint

      **Last Review:** Missing the risk section.

      ---

      ### Required Response Format

      **Summary**: What was implemented (2-3 sentences)

      **Gate Coverage**:
      - [1] PASS|FAIL: rationale
      - [2] PASS|FAIL: rationale

      **GATE_REVIEW: PASS|FAIL - overall assessment**"
    `);
  });

  test('an exhausted review offers the three gate actions', async () => {
    expect(
      await render({
        attemptCount: 3,
        phase: 'exhausted',
        retryHints: ['only hint'],
        history: [{ timestamp: 1, status: 'fail', reasoning: 'x'.repeat(250) }],
      })
    ).toMatchInlineSnapshot(`
      "## Review Context

      Review the original task and your output above against the gate criteria.

      ---


      GUIDANCE gates=code-quality,security,extra,step-inline,prompt-inline explicit=step-inline,code-quality,prompt-inline

      **Inline Gate Priority:** These inline gates triggered the review. Fix them before checking framework standards.

      **Inline Fix Guidance:**
      - only hint


      ## ⚠️ Retry Limit Reached

      The following gates failed after 3 attempts: **code-quality, security**

      ### Choose an action:

      | Action | Description |
      |--------|-------------|
      | \`gate_action: "retry"\` | Reset retry count and try again with improvements |
      | \`gate_action: "skip"\` | Skip this gate check and continue the chain |
      | \`gate_action: "abort"\` | Stop chain execution entirely |

      **To continue**, include one of the above in your next call.

      ---

      ### Required Response Format

      **Summary**: What was implemented (2-3 sentences)

      **Gate Coverage**:
      - [1] PASS|FAIL: rationale
      - [2] PASS|FAIL: rationale

      **GATE_REVIEW: PASS|FAIL - overall assessment**"
    `);
  });
});
