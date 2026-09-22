import { describe, expect, jest, test } from '@jest/globals';

import { GateLoader } from '../../../../../src/engine/gates/core/gate-loader.js';
import { GateAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { PromptAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { ContentAnalyzer } from '../../../../../src/modules/semantic/content-analyzer.js';

import type { ConvertedPrompt } from '../../../../../src/engine/execution/types.js';
import type { PromptResourceDependencies } from '../../../../../src/mcp/tools/resource-manager/prompt/core/types.js';
import type { Logger } from '../../../../../src/shared/types/index.js';

const createLogger = () =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * Real `ContentAnalyzer`, not a mock. It is pure and dependency-free, so mocking it here would
 * only assert that the mock returns what it was told to — the branch under test reads the
 * analyzer's actual output, which is the thing worth pinning.
 */
const createAnalyzer = () =>
  new PromptAnalyzer({
    logger: createLogger(),
    semanticAnalyzer: new ContentAnalyzer(createLogger()),
  });

const promptData = {
  id: 'sample',
  name: 'Sample',
  description: 'A prompt',
  category: 'analysis',
  userMessageTemplate: 'Hello {{name}}',
  arguments: [{ name: 'name', type: 'string', required: true }],
};

describe('PromptAnalyzer.analyzePromptIntelligence', () => {
  // The feedback used to be suppressed behind `semanticAnalyzer.isLLMEnabled()`, which defaulted
  // false — so every user saw "API Analysis Disabled" and no gate suggestions, even though the
  // analyzer produced real output and `GateAnalyzer` is rule-based with no model dependency.
  // These assertions pin the ungated behavior.
  test('reports the analysis line rather than a disabled notice', async () => {
    const result = await createAnalyzer().analyzePromptIntelligence(promptData);

    expect(result.feedback).not.toContain('API Analysis Disabled');
    expect(result.feedback).toContain(result.classification.executionType);
  });

  // `ContentAnalyzer` suggests no gates (it has no gate registry to check a name against), so
  // the feedback line carries no "Suggested gates:" clause. Pinned here rather than asserting a
  // nonzero count: a previous version hardcoded `suggestedGates: ['basic_validation']`, a gate id
  // that never existed in `resources/gates/`, and this test previously required that fabricated
  // list to be nonempty.
  test('carries no suggested-gates clause, because the analyzer suggests none', async () => {
    const result = await createAnalyzer().analyzePromptIntelligence(promptData);

    expect(result.classification.suggestedGates).toEqual([]);
    expect(result.feedback).not.toContain('Suggested gates:');
  });

  test('returns the classification alongside the feedback', async () => {
    const result = await createAnalyzer().analyzePromptIntelligence(promptData);

    expect(result.classification.executionType).toBe('single');
    expect(Array.isArray(result.suggestions)).toBe(true);
  });
});

/**
 * Icon selection, pinned per reachable input.
 *
 * `getAnalysisIcon` is private, so these drive it through `analyzePromptIntelligence` — the only
 * caller. Two inputs are reachable: the normal path yields `analysisMode: 'minimal'`, and a
 * throwing analyzer routes through the catch to `analysisMode: 'fallback'`. These assertions are
 * the guard for collapsing the switch: they hold identically before and after, which is what makes
 * the removal of the unreachable arms provably behavior-preserving rather than merely plausible.
 */
describe('PromptAnalyzer icon selection', () => {
  test('renders the analysis icon on the normal path', async () => {
    const result = await createAnalyzer().analyzePromptIntelligence(promptData);

    expect(result.classification.analysisMode).toBe('minimal');
    expect(result.feedback.startsWith('🧠')).toBe(true);
  });

  test('renders the fallback icon when analysis throws', async () => {
    const throwingAnalyzer = new PromptAnalyzer({
      logger: createLogger(),
      semanticAnalyzer: {
        analyzePrompt: jest.fn(async () => {
          throw new Error('analysis exploded');
        }),
      } as never,
    });

    const result = await throwingAnalyzer.analyzePromptIntelligence(promptData);

    expect(result.classification.analysisMode).toBe('fallback');
    expect(result.feedback.startsWith('🚨')).toBe(true);
  });
});

/**
 * A hardcoded gate id in a create/update-prompt reply is a claim the caller cannot act on unless
 * it resolves through the gate registry — `resources/gates/` is the only source of truth for what
 * a gate id names. `basic_validation` shipped in exactly this reply without ever existing there.
 * These tests drive every gate-suggesting path reachable from a prompt-analysis reply against the
 * REAL, bundled `GateLoader` (no mock — a mock would only assert that it returns what it was told
 * to, which proves nothing about whether a suggested id is real) and fail if any of them ever
 * names an id the registry cannot resolve.
 */
describe('gate suggestions resolve through the gate registry', () => {
  const gateLoader = new GateLoader(createLogger());

  function createPrompt(partial: Partial<ConvertedPrompt> = {}): ConvertedPrompt {
    return {
      id: 'prompt',
      name: 'Prompt',
      description: 'Test prompt',
      category: 'general',
      userMessageTemplate: 'Hello {{name}}',
      arguments: [{ name: 'name', type: 'string', required: true }],
      ...partial,
    };
  }

  test('positive control: a fabricated id does not resolve — proving this check can fail', async () => {
    const availableGates = await gateLoader.listAvailableGates();

    expect(availableGates.length).toBeGreaterThan(0);
    // The exact id this suite exists to catch. If a gate by this name is ever added, swap in
    // another id nothing defines — the point is a name the registry does NOT resolve.
    expect(availableGates).not.toContain('basic_validation');
  });

  test('ContentAnalyzer and PromptAnalyzer never suggest a gate id the registry cannot resolve', async () => {
    const availableGates = new Set(await gateLoader.listAvailableGates());

    const direct = await new ContentAnalyzer(createLogger()).analyzePrompt(createPrompt());
    for (const gateId of direct.suggestedGates) {
      expect(availableGates.has(gateId)).toBe(true);
    }

    const normalPath = await createAnalyzer().analyzePromptIntelligence(promptData);
    for (const gateId of normalPath.classification.suggestedGates) {
      expect(availableGates.has(gateId)).toBe(true);
    }

    // The failure fallback is the other reachable source of `suggestedGates` in this reply.
    const throwingAnalyzer = new PromptAnalyzer({
      logger: createLogger(),
      semanticAnalyzer: {
        analyzePrompt: jest.fn(async () => {
          throw new Error('analysis exploded');
        }),
      } as never,
    });
    const fallbackPath = await throwingAnalyzer.analyzePromptIntelligence(promptData);
    expect(fallbackPath.classification.analysisMode).toBe('fallback');
    for (const gateId of fallbackPath.classification.suggestedGates) {
      expect(availableGates.has(gateId)).toBe(true);
    }
  });

  // `GateAnalyzer` is the second, separate gate-suggesting channel a create-prompt reply calls
  // (`prompt-lifecycle-processor.ts`, "Suggested Gates: Consider adding these gates"). Driven
  // across every content signal `analyzePromptContent` branches on, plus every category
  // `getCategoryGateMapping` maps, so the union of `recommendedGates` collected here is the full
  // set the analyzer can ever produce — not just whatever one prompt happens to trigger.
  test('GateAnalyzer never recommends a gate id the registry cannot resolve', async () => {
    const dependencies = { logger: createLogger() } as unknown as PromptResourceDependencies;
    const gateAnalyzer = new GateAnalyzer(dependencies);
    const availableGates = new Set(await gateLoader.listAvailableGates());

    const contentTriggerTemplates = [
      'Write a function and a class with a variable and a method',
      'Research and investigate this topic; analyze and examine the study',
      'Learn and understand this; explain it clearly',
      'This covers technical specification, implementation, and architecture',
      'Please structure and organize this; outline the steps',
    ];
    const categories = [
      'analysis',
      'education',
      'development',
      'research',
      'debugging',
      'documentation',
      'content_processing',
      'general',
    ];

    const recommended = new Set<string>();
    for (const userMessageTemplate of contentTriggerTemplates) {
      for (const category of categories) {
        const result = await gateAnalyzer.analyzePromptForGates(
          createPrompt({ userMessageTemplate, category })
        );
        for (const gateId of result.recommendedGates) {
          recommended.add(gateId);
        }
      }
    }

    // Guards the guard: if nothing was ever recommended, the loop above stopped exercising the
    // branches it claims to, and every assertion below would pass vacuously.
    expect(recommended.size).toBeGreaterThan(0);
    for (const gateId of recommended) {
      expect(availableGates.has(gateId)).toBe(true);
    }
  });
});

/**
 * ONE scorer decides a prompt's execution type and complexity (P4.90).
 *
 * `GateAnalyzer.extractGateSuggestionContext` used to re-derive both with its own formula, which
 * weighed the raw template LENGTH where `PromptAnalyzer.analyzeComplexity` weighs template
 * VARIABLES, chain steps and system-message size. Scored across the 51 bundled prompts on
 * 2026-09-21 the two disagreed on 25 of them, in both directions — so a prompt could be `high` to
 * the gate suggester and `low` to the analyzer in the same reply.
 *
 * `GateAnalyzer` has no public window onto the context it builds, but its first reasoning line
 * renders both values verbatim ("Analyzed <type> with <level> complexity in <category> category"),
 * so that line is the observation point. The fixtures below are chosen so the deleted formula and
 * the surviving one land on DIFFERENT levels: if the inline derivation is ever restored, the
 * rendered line stops matching `PromptAnalyzer` and these assertions go red.
 */
describe('one scorer owns execution type and complexity', () => {
  const analyzer = createAnalyzer();
  const gateAnalyzer = new GateAnalyzer(
    { logger: createLogger() } as unknown as PromptResourceDependencies,
    analyzer
  );

  function createPrompt(partial: Partial<ConvertedPrompt> = {}): ConvertedPrompt {
    return {
      id: 'prompt',
      name: 'Prompt',
      description: 'Test prompt',
      category: 'general',
      userMessageTemplate: 'Hello',
      arguments: [],
      ...partial,
    };
  }

  /** The complexity level the DELETED inline formula would have produced. */
  function retiredInlineLevel(prompt: ConvertedPrompt): 'low' | 'medium' | 'high' {
    const score =
      (prompt.arguments?.length || 0) +
      (prompt.chainSteps?.length || 0) +
      prompt.userMessageTemplate.length / 100;
    if (score > 10) return 'high';
    if (score > 5) return 'medium';
    return 'low';
  }

  // A long prose template with no variables: the retired formula called it `high` on length
  // alone, the owner calls it `low`.
  const longTemplate = createPrompt({ userMessageTemplate: 'word '.repeat(300) });
  // A six-step chain with a short template: the owner doubles chain steps and calls it `high`,
  // the retired formula counted each step once and called it `medium`.
  const shortChain = createPrompt({
    userMessageTemplate: 'Go',
    chainSteps: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
      promptId: id,
      stepName: id,
    })) as ConvertedPrompt['chainSteps'],
  });

  test('positive control: the fixtures are ones the two formulas score differently', () => {
    // Without this, both assertions below could pass against either formula and prove nothing.
    expect(retiredInlineLevel(longTemplate)).toBe('high');
    expect(analyzer.analyzeComplexity(longTemplate).level).toBe('low');

    expect(retiredInlineLevel(shortChain)).toBe('medium');
    expect(analyzer.analyzeComplexity(shortChain).level).toBe('high');
  });

  test.each([
    ['long prose template, no variables', longTemplate],
    ['six-step chain, short template', shortChain],
  ])('gate suggestions report %s exactly as PromptAnalyzer scored it', async (_label, prompt) => {
    const result = await gateAnalyzer.analyzePromptForGates(prompt);

    const expectedType = analyzer.detectExecutionType(prompt);
    const expectedLevel = analyzer.analyzeComplexity(prompt).level;

    expect(result.reasoning[0]).toBe(
      `Analyzed ${expectedType} with ${expectedLevel} complexity in ${prompt.category} category`
    );
    // Names which derivation answered, so the assertion cannot keep passing once the retired
    // formula comes back under a different level.
    expect(result.reasoning[0]).not.toContain(`${retiredInlineLevel(prompt)} complexity`);
  });
});
