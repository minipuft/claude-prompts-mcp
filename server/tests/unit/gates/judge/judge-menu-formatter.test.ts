// @lifecycle canonical - The %judge intro is a fixed line; it never reads a framework context.
import { describe, expect, test } from '@jest/globals';

import { JudgeMenuFormatter } from '../../../../src/engine/gates/judge/judge-menu-formatter.js';

import type { PromptRequestContext } from '../../../../src/engine/execution/context/index.js';

/**
 * Stage 10 (`JudgeSelection`) renders this menu and returns before stage 12 (`FrameworkResolution`)
 * writes `context.frameworkContext`, so the menu has no framework to introduce itself with. The
 * formatter once read `context.frameworkContext?.selectedFramework?.type` to pick a framework
 * judge prompt: a read that was undefined on every `%judge` call, and a provider wired for it that
 * never ran. The control below sets the key anyway and asserts the intro does not move — the
 * assertion would fail against the old read, which swapped the intro for the framework's prompt.
 */

const DEFAULT_INTRO =
  'You are an expert resource selector. Analyze the task below and select appropriate enhancement resources to improve the response quality.';

const EMPTY_MENU = { styles: [], frameworks: [], gates: [] };

const createContext = (frameworkContext?: unknown): PromptRequestContext =>
  ({
    mcpRequest: { command: '%judge analyze this' },
    parsedCommand: undefined,
    frameworkContext,
  }) as unknown as PromptRequestContext;

const render = (formatter: JudgeMenuFormatter, context: PromptRequestContext): string => {
  const response = formatter.buildJudgeResponse(EMPTY_MENU, context);
  return response.content[0]?.text ?? '';
};

describe('JudgeMenuFormatter intro', () => {
  test('introduces the menu with the fixed resource-selector line', () => {
    const text = render(new JudgeMenuFormatter(), createContext());

    expect(text).toContain(DEFAULT_INTRO);
    expect(text).not.toContain('### Framework-Specific Instructions');
  });

  test('a frameworkContext on the context does not change the intro', () => {
    const plain = render(new JudgeMenuFormatter(), createContext());
    const withFramework = render(
      new JudgeMenuFormatter(),
      createContext({ selectedFramework: { id: 'cageerf', type: 'CAGEERF' } })
    );

    expect(withFramework).toBe(plain);
    expect(withFramework).toContain(DEFAULT_INTRO);
  });
});
