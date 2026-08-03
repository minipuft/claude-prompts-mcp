import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { createSymbolicCommandParser } from '../../../src/engine/execution/parsers/symbolic-operator-parser.js';
import { JudgeSelectionStage } from '../../../src/engine/execution/pipeline/stages/10-judge-selection-stage.js';

import type { Logger } from '../../../src/infra/logging/index.js';

/**
 * Integration test: judge selection re-entry.
 *
 * `JudgeMenuFormatter` tells the client, verbatim, to answer the resource menu by
 * calling `prompt_engine` again with inline operators:
 *
 *   command: "<task> @<framework> :: <gate_id> #<style>"
 *
 * These tests prove each of those three operators actually reaches its consumer.
 * That claim is load-bearing: `state.framework.clientOverride` and
 * `state.framework.clientSelectedGates` were removed on 2026-08-02 as a redundant
 * second channel precisely because these paths carry the selection. If any of these
 * fail, that removal was wrong — see ADR 0001 § Amendment 2026-08-02.
 *
 * Real collaborators throughout (parser, FrameworkDecisionAuthority, GateAccumulator,
 * JudgeSelectionStage); only the logger is mocked.
 */

const JUDGE_REPLY = '>>demo @cageerf :: code-quality #analytical';

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

describe('Judge selection re-entry via inline operators', () => {
  let logger: Logger;
  let parser: ReturnType<typeof createSymbolicCommandParser>;

  beforeEach(() => {
    logger = createLogger();
    parser = createSymbolicCommandParser(logger);
  });

  test('the menu-documented reply parses into all three selection channels', () => {
    const detection = parser.detectOperators(JUDGE_REPLY);
    const plan = parser.generateExecutionPlan(detection, 'demo', '');

    expect(plan.frameworkOverride).toBe('CAGEERF');
    expect(plan.styleSelection).toBe('analytical');
    expect(plan.finalValidation?.parsedCriteria).toContain('code-quality');
  });

  test('framework selection reaches FrameworkDecisionAuthority as an operator decision', () => {
    const detection = parser.detectOperators(JUDGE_REPLY);
    const plan = parser.generateExecutionPlan(detection, 'demo', '');

    const context = new ExecutionContext({ command: JUDGE_REPLY });
    const decision = context.frameworkAuthority.decide({
      ...(plan.frameworkOverride !== undefined && { operatorOverride: plan.frameworkOverride }),
      globalActiveFramework: 'ReACT',
    });

    // The judge-phase choice wins over the globally active framework, and is
    // attributed to the operator — there is no separate client-selection source.
    expect(decision.shouldApply).toBe(true);
    expect(decision.frameworkId).toBe('cageerf');
    expect(decision.source).toBe('operator');
  });

  test('gate selection lands in the accumulator at inline-operator, outranking lower sources', () => {
    const context = new ExecutionContext({ command: JUDGE_REPLY });

    // A gate the registry auto-selected, then the same gate chosen at the judge menu.
    context.gates.add('code-quality', 'registry-auto');
    context.gates.add('code-quality', 'inline-operator');

    const entry = context.gates.getEntries().find((e) => e.id === 'code-quality');

    expect(entry?.source).toBe('inline-operator');
    expect(context.gates.getAll()).toContain('code-quality');
  });

  test('style selection reaches state.framework.clientSelectedStyle, normalized', async () => {
    const stage = new JudgeSelectionStage(
      null as never, // resourceCollector — only used on the judge branch
      null as never, // menuFormatter — only used on the judge branch
      null, // configManager
      logger
    );

    const context = new ExecutionContext({ command: JUDGE_REPLY });
    context.parsedCommand = {
      commandType: 'single',
      styleSelection: 'Analytical',
    } as never;

    await stage.execute(context);

    expect(context.state.framework.clientSelectedStyle).toBe('analytical');
  });
});
