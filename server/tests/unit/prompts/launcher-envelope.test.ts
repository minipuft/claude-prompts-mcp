import { describe, expect, test } from '@jest/globals';

import { buildLauncherMessages } from '../../../src/modules/prompts/launcher-envelope.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';

/** Minimal ConvertedPrompt factory — only the fields the launcher reads. */
function makePrompt(overrides: Partial<ConvertedPrompt> = {}): ConvertedPrompt {
  return {
    id: 'hiring_manager_code_eval',
    name: 'Hiring Manager Code Eval',
    description: 'Evaluate a code sample as a hiring manager would.',
    category: 'development',
    userMessageTemplate: 'Evaluate {{code}}',
    arguments: [],
    ...overrides,
  } as ConvertedPrompt;
}

function textOf(messages: ReturnType<typeof buildLauncherMessages>): string {
  return messages[0].content.text;
}

describe('buildLauncherMessages', () => {
  test('returns a single user message that invokes prompt_engine with the >> command', () => {
    const messages = buildLauncherMessages(makePrompt(), {});

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content.type).toBe('text');
    expect(textOf(messages)).toContain('prompt_engine(command: ">>hiring_manager_code_eval")');
  });

  test('serializes provided args into the options channel', () => {
    const messages = buildLauncherMessages(makePrompt(), { code: 'function f(){}', lang: 'js' });

    expect(textOf(messages)).toContain(
      'prompt_engine(command: ">>hiring_manager_code_eval", options: {"code":"function f(){}","lang":"js"})'
    );
  });

  test('renders argument hints with requiredness and description', () => {
    const messages = buildLauncherMessages(
      makePrompt({
        arguments: [
          { name: 'code', required: true, description: 'The code sample to evaluate' },
          { name: 'role', required: false, description: 'Target role' },
        ],
      }),
      {}
    );

    const text = textOf(messages);
    expect(text).toContain('Arguments:');
    expect(text).toContain('• code (required) — The code sample to evaluate');
    expect(text).toContain('• role (optional) — Target role');
  });

  test('renders gate hints from prompt-declared gates', () => {
    const messages = buildLauncherMessages(
      makePrompt({
        gates: [
          {
            id: 'code-quality',
            name: 'Code Quality',
            type: 'validation',
            requirements: [],
            failureAction: 'retry',
          },
        ],
      }),
      {}
    );

    const text = textOf(messages);
    expect(text).toContain('Quality gates that will be enforced:');
    expect(text).toContain('• Code Quality (validation)');
  });

  test('renders gate hints from gateConfiguration.include', () => {
    const messages = buildLauncherMessages(
      makePrompt({ gateConfiguration: { include: ['security-review'] } }),
      {}
    );

    expect(textOf(messages)).toContain('• security-review');
  });

  test('omits the Arguments and gates sections when none are declared', () => {
    const text = textOf(buildLauncherMessages(makePrompt(), {}));

    expect(text).not.toContain('Arguments:');
    expect(text).not.toContain('Quality gates');
  });
});
