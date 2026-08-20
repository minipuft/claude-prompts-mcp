import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ChainOperatorExecutor } from '../../../../src/engine/execution/operators/chain-operator-executor.js';

import type { ScriptReferenceResolverPort } from '../../../../src/shared/utils/jsonUtils.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

/**
 * Tier D.1 — a chain step must reach its prompt's OWN script tools.
 *
 * `WorkspaceScriptLoader` tries prompt-local `${promptDir}/tools/${id}/` before the workspace
 * `resources/scripts/${id}/`, but only when it is GIVEN a promptDir. The single-prompt path
 * (18-execution-stage) always passed one; the chain renderer did not, so a prompt whose tool
 * lives beside it rendered standalone and failed as a chain step with
 * `ScriptNotRegisteredError: Script "word_count" not found. Searched: .../resources/scripts/word_count`
 * — naming only the path it had searched, never the one the author used.
 *
 * The assertion is on the promptDir REACHING the resolver, because that is the single bit that
 * decides whether prompt-local lookup is attempted at all. Asserting on rendered output instead
 * would pass for a prompt that has no scripts, which is most of them.
 */
describe('Tier D.1 — chain steps pass promptDir to the script resolver', () => {
  let seenPromptDirs: Array<string | undefined>;
  let scriptResolver: ScriptReferenceResolverPort;
  let logger: Logger;

  const PROMPT_DIR = '/repo/resources/prompts/examples/reference_demo';

  const prompts: ConvertedPrompt[] = [
    {
      id: 'scripted',
      name: 'Scripted',
      description: 'carries a prompt-local tool',
      category: 'examples',
      userMessageTemplate: 'Count: {{script:word_count}}',
      promptDir: PROMPT_DIR,
      arguments: [],
    },
    {
      id: 'plain',
      name: 'Plain',
      description: 'second step',
      category: 'examples',
      userMessageTemplate: 'done',
      promptDir: '/repo/resources/prompts/examples/plain',
      arguments: [],
    },
  ] as unknown as ConvertedPrompt[];

  beforeEach(() => {
    seenPromptDirs = [];
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;

    scriptResolver = {
      hasScriptReferences: (template: string) => template.includes('{{script:'),
      preResolve: async (template: string, _ctx: Record<string, unknown>, promptDir?: string) => {
        seenPromptDirs.push(promptDir);
        return {
          resolvedTemplate: template.replace('{{script:word_count}}', '7'),
          scriptResults: new Map<string, unknown>(),
          diagnostics: { scriptsResolved: 1, scriptsFailed: 0, totalDurationMs: 0 },
        };
      },
    } as unknown as ScriptReferenceResolverPort;
  });

  const executorWith = () =>
    new ChainOperatorExecutor(logger, prompts, undefined, undefined, {
      scriptReferenceResolver: scriptResolver,
    });

  test('the rendering step hands its own promptDir to the script resolver', async () => {
    const result = await executorWith().renderStep({
      executionType: 'normal',
      stepPrompts: [
        { stepNumber: 1, promptId: 'scripted', args: {} },
        { stepNumber: 2, promptId: 'plain', args: {} },
      ],
      currentStepIndex: 0,
    } as never);

    // The bit under test: without it the loader searches only the workspace directory.
    expect(seenPromptDirs).toContain(PROMPT_DIR);
    expect(seenPromptDirs).not.toContain(undefined);
    // And the reference actually resolved, so the render did not fall into the catch that
    // returns "[ERROR] Template rendering failed".
    expect(result.content).toContain('Count: 7');
    expect(result.content).not.toContain('Template rendering failed');
  });
});
