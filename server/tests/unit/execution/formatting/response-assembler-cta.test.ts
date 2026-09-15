import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';

import type {
  ConvertedPrompt,
  ExecutionModifiers,
} from '../../../../src/engine/execution/types.js';
import type { GateReviewPrompt } from '../../../../src/shared/types/chain-execution.js';

/**
 * Tests for the operator-aware CTA system (buildNextActionCTA).
 *
 * Composition model:
 *   Primary action (exclusive): gate verdict > session resume
 *   Hints (additive): verify command, loop mode
 *   Re-run (always): invocation string
 *
 * These tests verify CTA rendering from context state — they do NOT test
 * pipeline stages that populate that state (those are integration tests).
 */

const assembler = new ResponseAssembler();

const basePrompt: ConvertedPrompt = {
  id: 'test-prompt',
  name: 'Test Prompt',
  description: 'Test',
  category: 'development',
  userMessageTemplate: 'Test {{text}}',
  arguments: [{ name: 'text', type: 'string', description: 'Input', required: true }],
};

function createSinglePromptContext(overrides: {
  accumulatedGateIds?: string[];
  chainId?: string;
  promptId?: string;
  namedInlineGates?: Array<{
    gateId: string;
    criteria: string[];
    shellVerify?: { command: string; timeout?: number; workingDir?: string };
  }>;
  operators?: Array<{ type: string; [key: string]: unknown }>;
  strategy?: 'single' | 'chain';
  modifiers?: ExecutionModifiers;
  inlineGateCriteria?: string[];
  styleSelection?: string;
  promptArgs?: Record<string, unknown>;
  promptArguments?: ConvertedPrompt['arguments'];
  pendingReview?: {
    combinedPrompt: string;
    gateIds: string[];
    prompts: GateReviewPrompt[];
    createdAt: number;
    attemptCount: number;
    maxAttempts: number;
    gateTiers?: Record<string, 'check' | 'reminder'>;
    checkResults?: Array<{ gateId: string; passed: boolean; summary: string }>;
  };
  frameworkDecision?: { source: string; frameworkId: string };
  executionPlanOverrides?: Record<string, unknown>;
}): ExecutionContext {
  const context = new ExecutionContext({ command: `>>${overrides.promptId ?? 'test-prompt'}` });

  context.executionResults = {
    content: 'Test output content',
    metadata: {},
    generatedAt: Date.now(),
  };

  context.executionPlan = {
    strategy: overrides.strategy ?? 'single',
    gates: overrides.accumulatedGateIds ?? [],
    requiresFramework: false,
    requiresSession: Boolean(overrides.chainId),
  };

  const promptArguments = overrides.promptArguments ?? basePrompt.arguments;
  context.parsedCommand = {
    promptId: overrides.promptId ?? 'test-prompt',
    rawArgs: '',
    format: 'symbolic' as const,
    confidence: 0.9,
    convertedPrompt: {
      ...basePrompt,
      id: overrides.promptId ?? 'test-prompt',
      arguments: promptArguments,
    },
    promptArgs: overrides.promptArgs ?? { text: 'hello' },
    metadata: {
      originalCommand: `>>${overrides.promptId ?? 'test-prompt'}`,
      parseStrategy: 'symbolic',
      detectedFormat: 'symbolic',
      warnings: [],
    },
  };

  if (overrides.modifiers != null) {
    context.parsedCommand.modifiers = overrides.modifiers;
  }

  if (overrides.inlineGateCriteria != null) {
    context.parsedCommand.inlineGateCriteria = overrides.inlineGateCriteria;
  }

  if (overrides.styleSelection != null) {
    context.parsedCommand.styleSelection = overrides.styleSelection;
  }

  if (overrides.namedInlineGates != null) {
    context.parsedCommand.namedInlineGates = overrides.namedInlineGates;
  }

  if (overrides.operators != null) {
    context.parsedCommand.operators = {
      hasOperators: true,
      operatorTypes: overrides.operators.map((op) => op.type),
      parseComplexity: 'moderate',
      operators: overrides.operators as any,
    };
  }

  if (overrides.executionPlanOverrides != null) {
    context.parsedCommand.executionPlan = overrides.executionPlanOverrides as any;
  }

  if (overrides.accumulatedGateIds != null && overrides.accumulatedGateIds.length > 0) {
    context.state.gates.accumulatedGateIds = overrides.accumulatedGateIds;
  }

  if (overrides.chainId != null) {
    context.sessionContext = {
      sessionId: `session-${Date.now()}`,
      chainId: overrides.chainId,
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 1,
      ...(overrides.pendingReview != null ? { pendingReview: overrides.pendingReview } : {}),
    };
  }

  // Seed framework decision authority if requested
  if (overrides.frameworkDecision != null) {
    context.frameworkAuthority.decide({
      operatorOverride: overrides.frameworkDecision.frameworkId,
    });
  }

  return context;
}

describe('ResponseAssembler – operator-aware CTA system', () => {
  describe('gate verdict CTA (primary action)', () => {
    test('renders Review Required with gate IDs and chain_id when gates are accumulated', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: ['intent-quality', 'code-quality'],
        chainId: 'chain-test#1',
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('**Review Required**');
      expect(result).toContain('chain_id="chain-test#1"');
      // The CTA advertises the structured form, which the tool schema validates
      // and which therefore cannot be submitted malformed. It replaced the
      // free-text `GATE_REVIEW:` template the server used to ask the model to
      // reproduce and then read back with five fallback regexes.
      expect(result).toContain('gate_verdict={');
      expect(result).toContain('"overall": "PASS"');
      expect(result).toContain('"per_gate"');
      expect(result).not.toContain('gate_verdict="GATE_REVIEW:');
      expect(result).toContain('intent-quality');
      expect(result).toContain('code-quality');
    });

    test('does not render gate CTA when accumulatedGateIds is empty', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: [],
        chainId: 'chain-test#2',
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).not.toContain('**Review Required**');
      expect(result).not.toContain('gate_verdict');
    });

    test('does not render gate CTA when chainId is missing', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: ['intent-quality'],
        // No chainId — session was not created
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).not.toContain('**Review Required**');
      expect(result).not.toContain('gate_verdict');
    });

    test('gate CTA suppresses session CTA (mutual exclusion)', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: ['intent-quality'],
        chainId: 'chain-test#3',
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('**Review Required**');
      expect(result).not.toContain('Continue:');
      expect(result).not.toContain('user_response');
    });
  });

  describe('session resume CTA (fallback primary action)', () => {
    test('renders Continue with chain_id and user_response when session exists but no gates', () => {
      const context = createSinglePromptContext({
        chainId: 'chain-session#1',
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('Continue:');
      expect(result).toContain('chain_id="chain-session#1"');
      expect(result).toContain('user_response=');
    });

    test('does not render session CTA when no session exists', () => {
      const context = createSinglePromptContext({});

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).not.toContain('Continue:');
      expect(result).not.toContain('user_response');
    });
  });

  describe('verify hint (additive)', () => {
    test('renders verification command hint from namedInlineGates with shellVerify', () => {
      const context = createSinglePromptContext({
        chainId: 'chain-verify#1',
        namedInlineGates: [
          {
            gateId: 'verify-test',
            criteria: ['Shell verification: npm test'],
            shellVerify: { command: 'npm test' },
          },
        ],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('Verification:');
      expect(result).toContain('`npm test`');
      expect(result).toContain('runs automatically');
    });

    test('does not render verify hint when no shellVerify gates exist', () => {
      const context = createSinglePromptContext({
        chainId: 'chain-noverify#1',
        namedInlineGates: [
          {
            gateId: 'plain-gate',
            criteria: ['check quality'],
          },
        ],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).not.toContain('Verification:');
    });

    test('verify hint coexists with gate CTA (both rendered)', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: ['verify-test'],
        chainId: 'chain-both#1',
        namedInlineGates: [
          {
            gateId: 'verify-test',
            criteria: ['Shell verification: npm test'],
            shellVerify: { command: 'npm test' },
          },
        ],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('**Review Required**');
      expect(result).toContain('Verification:');
    });
  });

  describe('loop hint (additive)', () => {
    test('renders loop mode hint from gate operator with shellVerify.loop', () => {
      const context = createSinglePromptContext({
        chainId: 'chain-loop#1',
        operators: [
          {
            type: 'gate',
            gateId: 'loop-gate',
            criteria: 'test',
            parsedCriteria: ['test'],
            shellVerify: { command: 'npm test', loop: true, maxIterations: 5 },
          },
        ],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('Loop mode:');
      expect(result).toContain('max 5 iterations');
    });

    test('uses default max iterations when not specified', () => {
      const context = createSinglePromptContext({
        chainId: 'chain-loop-default#1',
        operators: [
          {
            type: 'gate',
            gateId: 'loop-gate-default',
            criteria: 'test',
            parsedCriteria: ['test'],
            shellVerify: { command: 'npm test', loop: true },
          },
        ],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('Loop mode:');
      expect(result).toContain('max 10 iterations'); // SHELL_VERIFY_DEFAULT_MAX_ITERATIONS
    });

    test('does not render loop hint when loop is false', () => {
      const context = createSinglePromptContext({
        operators: [
          {
            type: 'gate',
            gateId: 'no-loop-gate',
            criteria: 'test',
            parsedCriteria: ['test'],
            shellVerify: { command: 'npm test', loop: false },
          },
        ],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).not.toContain('Loop mode:');
    });
  });

  describe('re-run line (always present)', () => {
    test('renders re-run invocation with prompt ID and args', () => {
      const context = createSinglePromptContext({
        promptId: 'demo-prompt',
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('Re-run:');
      expect(result).toContain('>>demo-prompt');
    });

    test('re-run line is present alongside gate CTA', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: ['intent-quality'],
        chainId: 'chain-rerun#1',
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('**Review Required**');
      expect(result).toContain('Re-run:');
    });
  });

  describe('composition model', () => {
    test('full composition: gate + verify + loop + re-run (no session)', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: ['verify-gate'],
        chainId: 'chain-full#1',
        namedInlineGates: [
          {
            gateId: 'verify-gate',
            criteria: ['Shell verification: npm test'],
            shellVerify: { command: 'npm test' },
          },
        ],
        operators: [
          {
            type: 'gate',
            gateId: 'loop-verify',
            criteria: 'test',
            parsedCriteria: ['test'],
            shellVerify: { command: 'npm test', loop: true, maxIterations: 3 },
          },
        ],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      // Primary: gate CTA
      expect(result).toContain('**Review Required**');
      // Hints: both verify and loop
      expect(result).toContain('Verification:');
      expect(result).toContain('Loop mode:');
      expect(result).toContain('max 3 iterations');
      // Always: re-run
      expect(result).toContain('Re-run:');
      // NOT: session (suppressed by gate primary)
      expect(result).not.toContain('Continue:');
    });

    test('no operators: re-run only', () => {
      const context = createSinglePromptContext({});

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('Re-run:');
      expect(result).not.toContain('**Review Required**');
      expect(result).not.toContain('Continue:');
      expect(result).not.toContain('Verification:');
      expect(result).not.toContain('Loop mode:');
    });
  });

  describe('invocation string — operator prefixes', () => {
    test('modifier %lean appears in re-run', () => {
      const context = createSinglePromptContext({
        modifiers: { lean: true },
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('Re-run:');
      expect(result).toContain('%lean');
    });

    test('modifier %clean appears in re-run', () => {
      const context = createSinglePromptContext({
        modifiers: { clean: true },
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('%clean');
    });

    test('modifier %judge appears in re-run', () => {
      const context = createSinglePromptContext({
        modifiers: { judge: true },
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('%judge');
    });

    // The CTA emits the CANONICAL framework symbol, which is now `^`; `@` is the deprecated
    // alias and is accepted on input only. These assertions still read `@` after the rename.
    test('framework ^cageerf from operator decision appears in re-run', () => {
      const context = createSinglePromptContext({
        frameworkDecision: { source: 'operator', frameworkId: 'cageerf' },
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('^cageerf');
    });

    test('framework fallback from parser executionPlan appears in re-run', () => {
      const context = createSinglePromptContext({
        executionPlanOverrides: { frameworkOverride: 'FOCUS' },
      });
      // No operator decision seeded — falls back to executionPlan.frameworkOverride

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('^focus');
    });
  });

  describe('invocation string — gate suffixes', () => {
    test('inline gate criteria appears in re-run', () => {
      const context = createSinglePromptContext({
        inlineGateCriteria: ['check accuracy'],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain(":: 'check accuracy'");
    });

    test('named inline gate appears in re-run', () => {
      const context = createSinglePromptContext({
        namedInlineGates: [{ gateId: 'quality', criteria: ['ensure quality'] }],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain(':: quality:"ensure quality"');
    });

    test('style selection appears in re-run', () => {
      const context = createSinglePromptContext({
        styleSelection: 'analytical',
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('#analytical');
    });
  });

  describe('invocation string — arguments', () => {
    test('user-provided args displayed in re-run', () => {
      const context = createSinglePromptContext({
        promptArgs: { text: 'hello' },
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('text:"hello"');
    });

    test('required arg with no user value shows placeholder', () => {
      const context = createSinglePromptContext({
        promptArgs: {}, // No user value for text
        promptArguments: [{ name: 'text', type: 'string', description: 'Input', required: true }],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('text:"<text>"');
    });

    test('default value used when no user value provided', () => {
      const context = createSinglePromptContext({
        promptArgs: {},
        promptArguments: [
          {
            name: 'format',
            type: 'string',
            description: 'Output format',
            required: false,
            defaultValue: 'markdown',
          },
        ],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('format:"markdown"');
    });
  });

  describe('multiple verify commands', () => {
    test('renders all verify commands from multiple shellVerify gates', () => {
      const context = createSinglePromptContext({
        chainId: 'chain-multi-verify#1',
        namedInlineGates: [
          {
            gateId: 'verify-test',
            criteria: ['Shell verification: npm test'],
            shellVerify: { command: 'npm test' },
          },
          {
            gateId: 'verify-lint',
            criteria: ['Shell verification: npm run lint'],
            shellVerify: { command: 'npm run lint' },
          },
        ],
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('`npm test`');
      expect(result).toContain('`npm run lint`');
    });
  });

  describe('edge cases', () => {
    test('empty string chainId treated as absent — no gate or session CTA', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: ['intent-quality'],
      });
      // Force empty string chainId via session
      context.sessionContext = {
        sessionId: 'sess-empty',
        chainId: '',
        isChainExecution: true,
        currentStep: 1,
        totalSteps: 1,
      };

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      // appendGateAction guards on chainId.length === 0, so no gate CTA
      expect(result).not.toContain('**Review Required**');
      // appendSessionAction guards on chainId.length === 0, so no session CTA
      expect(result).not.toContain('Continue:');
    });

    test('gate CTA renders verdict template with gate names from prompts', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: ['intent-quality', 'code-quality'],
        chainId: 'chain-names#1',
        pendingReview: {
          combinedPrompt: 'review',
          gateIds: ['intent-quality', 'code-quality'],
          prompts: [
            {
              gateId: 'intent-quality',
              gateName: 'Intent Quality Gate',
              criteriaSummary: 'Check intent',
            },
            {
              gateId: 'code-quality',
              gateName: 'Code Quality Gate',
              criteriaSummary: 'Check code',
            },
          ],
          createdAt: Date.now(),
          attemptCount: 0,
          maxAttempts: 3,
        },
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('Intent Quality Gate');
      expect(result).toContain('Code Quality Gate');
      // Criteria summaries now rendered alongside gate names
      expect(result).toContain('Check intent');
      expect(result).toContain('Check code');
    });
  });

  /**
   * Ruling B4: `per_gate` is for gates the engine can grade, and everything else takes one
   * attestation field. A rationale slot per reminder is what nine measured dispatches filled
   * with "not applicable" five times a run while catching nothing.
   *
   * The tier comes off the pending review that `GateReviewStage` recorded: this assembler takes
   * no gate provider and is synchronous, so a gate with no recorded tier stays `check` — the
   * pre-B4 shape, which the tests above still assert.
   */
  describe('verdict template tiers (check vs reminder)', () => {
    const mixedReview = {
      combinedPrompt: 'review',
      gateIds: ['test-suite', 'code-quality'],
      prompts: [] as GateReviewPrompt[],
      createdAt: 1,
      attemptCount: 0,
      maxAttempts: 3,
      gateTiers: { 'test-suite': 'check' as const, 'code-quality': 'reminder' as const },
    };

    test('a check + a reminder yield one per_gate entry and a reminders field', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: ['test-suite', 'code-quality'],
        chainId: 'chain-tiers#1',
        pendingReview: mixedReview,
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      // Index 1 is the gate's place in the ORIGINAL list, which is what the per-gate parser
      // matches back against — dropping the reminder must not renumber the survivor.
      expect(result).toContain('"index": 1');
      expect(result).not.toContain('"index": 2');
      expect(result).toContain(
        '"reminders": {"satisfied": ["code-quality"], "not_applicable": []}'
      );
      expect(result).toContain('Checks are recorded by the engine; attest reminders in one field');
    });

    test('a recorded result pre-fills passed and the rationale slot', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: ['test-suite', 'code-quality'],
        chainId: 'chain-tiers#2',
        pendingReview: {
          ...mixedReview,
          checkResults: [{ gateId: 'test-suite', passed: false, summary: 'npm test exit 1' }],
        },
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('"passed": false');
      expect(result).toContain('<recorded: npm test exit 1>');
      expect(result).not.toContain('test-suite: <why>');
    });

    test('an all-reminder gate list omits per_gate entirely', () => {
      const context = createSinglePromptContext({
        accumulatedGateIds: ['code-quality', 'prose-hygiene'],
        chainId: 'chain-tiers#3',
        pendingReview: {
          ...mixedReview,
          gateIds: ['code-quality', 'prose-hygiene'],
          gateTiers: { 'code-quality': 'reminder' as const, 'prose-hygiene': 'reminder' as const },
        },
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).not.toContain('"per_gate"');
      expect(result).toContain(
        '"reminders": {"satisfied": ["code-quality", "prose-hygiene"], "not_applicable": []}'
      );
    });

    test('a run of leading reminders does not push a later check off the template', () => {
      const reminderIds = Array.from({ length: 10 }, (_, i) => `reminder-${i + 1}`);
      const checkId = 'check-11';
      const gateIds = [...reminderIds, checkId];
      const gateTiers = {
        ...Object.fromEntries(reminderIds.map((id) => [id, 'reminder' as const])),
        [checkId]: 'check' as const,
      };

      const context = createSinglePromptContext({
        accumulatedGateIds: gateIds,
        chainId: 'chain-tiers#4',
        pendingReview: {
          ...mixedReview,
          gateIds,
          gateTiers,
        },
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      // The eleventh gate is a check, so it must still get a per_gate slot at its ORIGINAL
      // position — even though ten reminders precede it and the pre-fix code sliced to the
      // first ten of `gateIds` before ever walking to it.
      expect(result).toContain('"index": 11');
      const perGateEntries = (result.match(/\{"index":/g) ?? []).length;
      expect(perGateEntries).toBe(1);
      // All ten reminders are still attested, in the one `reminders` field.
      for (const id of reminderIds) {
        expect(result).toContain(id);
      }
    });

    test('twelve check-tier gates still cap per_gate at ten entries', () => {
      const gateIds = Array.from({ length: 12 }, (_, i) => `check-${i + 1}`);
      const gateTiers = Object.fromEntries(gateIds.map((id) => [id, 'check' as const]));

      const context = createSinglePromptContext({
        accumulatedGateIds: gateIds,
        chainId: 'chain-tiers#5',
        pendingReview: {
          ...mixedReview,
          gateIds,
          gateTiers,
        },
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      const perGateEntries = (result.match(/\{"index":/g) ?? []).length;
      expect(perGateEntries).toBe(10);
      for (let i = 1; i <= 10; i++) {
        expect(result).toContain(`"index": ${i}`);
      }
      expect(result).not.toContain('"index": 11');
      expect(result).not.toContain('"index": 12');
    });
  });
});
