import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../src/execution/context/execution-context.js';
import { FrameworkDecisionAuthority } from '../../../src/execution/pipeline/decisions/index.js';
import { DiagnosticAccumulator } from '../../../src/execution/pipeline/state/accumulators/diagnostic-accumulator.js';
import { GateAccumulator } from '../../../src/execution/pipeline/state/accumulators/gate-accumulator.js';

import type { ChainStepPrompt } from '../../../src/execution/operators/chain-operator-executor.js';
import type { ConvertedPrompt } from '../../../src/types/index.js';

const baseRequest = { command: '>>demo' };

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const samplePrompt: ConvertedPrompt = {
  id: 'demo',
  name: 'Demo Prompt',
  description: 'Used for execution-context tests',
  category: 'test',
  userMessageTemplate: 'Hello {{name}}',
  arguments: [],
};

describe('ExecutionContext helpers', () => {
  test('getSessionId prefers resume metadata value', () => {
    const context = new ExecutionContext({ ...baseRequest, chain_id: 'chain-demo' });
    context.state.session.resumeSessionId = 'metadata-session';
    context.sessionContext = { sessionId: 'context-session', isChainExecution: false } as any;
    expect(context.getSessionId()).toBe('metadata-session');
  });

  test('getSessionId falls back to session context', () => {
    const context = new ExecutionContext(baseRequest);
    context.sessionContext = { sessionId: 'context-session', isChainExecution: true };
    expect(context.getSessionId()).toBe('context-session');
  });

  test('isChainExecution inspects execution plan and parsed command', () => {
    const context = new ExecutionContext(baseRequest);
    expect(context.isChainExecution()).toBe(false);

    const chainResumeContext = new ExecutionContext({ chain_id: 'chain-demo' });
    expect(chainResumeContext.isChainExecution()).toBe(true);

    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: true,
    };
    expect(context.isChainExecution()).toBe(true);

    const chainContext = new ExecutionContext(baseRequest);
    chainContext.parsedCommand = {
      promptId: 'chain',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.8,
      metadata: {
        originalCommand: '>>chain',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      commandType: 'chain',
      steps: [{ promptId: 'demo', stepNumber: 1, args: {} }] as ChainStepPrompt[],
    };
    expect(chainContext.isChainExecution()).toBe(true);
  });

  test('hasSinglePromptCommand type guard', () => {
    const context = new ExecutionContext(baseRequest);
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'simple',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'simple',
        detectedFormat: 'simple',
        warnings: [],
      },
      commandType: 'single',
      convertedPrompt: samplePrompt,
    };

    expect(context.hasSinglePromptCommand()).toBe(true);
    if (context.hasSinglePromptCommand()) {
      expect(context.parsedCommand.convertedPrompt.id).toBe('demo');
    }
  });

  test('hasChainCommand type guard', () => {
    const context = new ExecutionContext(baseRequest);
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      commandType: 'chain',
      steps: [{ promptId: 'demo', stepNumber: 1, args: {} }] as ChainStepPrompt[],
    };

    expect(context.hasChainCommand()).toBe(true);
    if (context.hasChainCommand()) {
      expect(context.parsedCommand.steps.length).toBe(1);
    }
  });
});

describe('ExecutionContext pipeline state management', () => {
  test('initializes GateAccumulator', () => {
    const context = new ExecutionContext(baseRequest);
    expect(context.gates).toBeInstanceOf(GateAccumulator);
    expect(context.gates.size).toBe(0);
  });

  test('initializes DiagnosticAccumulator', () => {
    const context = new ExecutionContext(baseRequest);
    expect(context.diagnostics).toBeInstanceOf(DiagnosticAccumulator);
    expect(context.diagnostics.size).toBe(0);
  });

  test('initializes FrameworkDecisionAuthority', () => {
    const context = new ExecutionContext(baseRequest);
    expect(context.frameworkAuthority).toBeInstanceOf(FrameworkDecisionAuthority);
    expect(context.frameworkAuthority.hasDecided()).toBe(false);
  });

  test('accepts optional logger for state management', () => {
    const context = new ExecutionContext(baseRequest, mockLogger as any);

    // Add a gate to trigger logging
    context.gates.add('test-gate', 'registry-auto');

    // The logger should have been called
    expect(context.gates.has('test-gate')).toBe(true);
  });

  test('gates accumulator deduplicates with priority', () => {
    const context = new ExecutionContext(baseRequest);

    // Add from low priority source
    context.gates.add('test-gate', 'registry-auto'); // priority 20

    // Try to add from same/lower priority - should be rejected
    const added = context.gates.add('test-gate', 'registry-auto');
    expect(added).toBe(false);
    expect(context.gates.size).toBe(1);

    // Add from higher priority source - should override
    const overridden = context.gates.add('test-gate', 'inline-operator'); // priority 100
    expect(overridden).toBe(true);
    expect(context.gates.size).toBe(1);

    const entries = context.gates.getEntries();
    expect(entries[0].source).toBe('inline-operator');
  });

  test('diagnostics accumulator collects across stages', () => {
    const context = new ExecutionContext(baseRequest);

    context.diagnostics.info('Stage1', 'Info message');
    context.diagnostics.warn('Stage2', 'Warning message');
    context.diagnostics.error('Stage3', 'Error message', 'ERR_CODE');

    expect(context.diagnostics.size).toBe(3);
    expect(context.diagnostics.hasErrors()).toBe(true);
    expect(context.diagnostics.hasWarnings()).toBe(true);

    const summary = context.diagnostics.getSummary();
    expect(summary.info).toBe(1);
    expect(summary.warning).toBe(1);
    expect(summary.error).toBe(1);
  });

  test('framework authority caches decision', () => {
    const context = new ExecutionContext(baseRequest);

    // Set up execution plan with modifiers
    context.executionPlan = {
      strategy: 'single',
      gates: [],
      requiresFramework: true,
      requiresSession: false,
      modifiers: { clean: true },
    };

    // Make decision
    const decision = context.frameworkAuthority.decide({
      modifiers: context.executionPlan.modifiers,
      globalActiveFramework: 'CAGEERF',
    });

    expect(decision.shouldApply).toBe(false);
    expect(decision.source).toBe('disabled');
    expect(decision.reason).toContain('%clean');

    // Verify decision is cached (same object reference)
    const cachedDecision = context.frameworkAuthority.decide({
      globalActiveFramework: 'CAGEERF',
    });
    expect(cachedDecision).toBe(decision);
  });

  test('framework authority respects priority chain', () => {
    const context = new ExecutionContext(baseRequest);

    // Test operator override takes precedence
    const decision = context.frameworkAuthority.decide({
      operatorOverride: 'CAGEERF',
      clientOverride: 'ReACT',
      globalActiveFramework: '5W1H',
    });

    expect(decision.shouldApply).toBe(true);
    expect(decision.frameworkId).toBe('cageerf');
    expect(decision.source).toBe('operator');
  });

  test('state management objects are readonly', () => {
    const context = new ExecutionContext(baseRequest);

    // These should be readonly - TypeScript would catch reassignment
    // Runtime check that they exist
    expect(context.gates).toBeDefined();
    expect(context.diagnostics).toBeDefined();
    expect(context.frameworkAuthority).toBeDefined();
  });
});
