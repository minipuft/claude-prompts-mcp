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

    test('framework @cageerf from operator decision appears in re-run', () => {
      const context = createSinglePromptContext({
        frameworkDecision: { source: 'operator', frameworkId: 'cageerf' },
      });

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('@cageerf');
    });

    test('framework fallback from parser executionPlan appears in re-run', () => {
      const context = createSinglePromptContext({
        executionPlanOverrides: { frameworkOverride: 'FOCUS' },
      });
      // No operator decision seeded — falls back to executionPlan.frameworkOverride

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('@focus');
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
});
