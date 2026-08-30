import { describe, expect, it } from '@jest/globals';

import { PromptDiscoveryProcessor } from '../../../../../src/mcp/tools/resource-manager/prompt/services/prompt-discovery-processor.js';

import type { PromptResourceContext } from '../../../../../src/mcp/tools/resource-manager/prompt/core/context.js';

/**
 * Security review 2026-08-25, Tier 3.4.
 *
 * A `list` call names no prompt, so returning every prompt's instruction bodies served
 * two things badly:
 *
 *  - exposure: one catalogue call handed over the whole instruction surface of every
 *    installed prompt, including any that arrived in a third-party pack. Measured at the
 *    time: 139,824 bytes of bodies, ~83% of the response;
 *  - correctness: a `systemMessage` is not a description. 10 of 11 shipped ones are
 *    second-person instruction ("You are a creative director…"), so a catalogue returned
 *    competing role assignments the model is not executing.
 *
 * The bodies stay reachable through `inspect` + `detail:"full"`, where the caller has
 * named the one prompt they want. These tests exist because the narrowing is easy to undo
 * by someone re-adding the bodies "for convenience" without knowing why they left.
 */

const SYSTEM_BODY = 'You are a probe persona. Adopt this role immediately.';
const USER_BODY = 'Do the probe task with {{input}}.';

function makeProcessor(prompts: unknown[]): PromptDiscoveryProcessor {
  const noopLogger = { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} };

  const context = {
    dependencies: { logger: noopLogger },
    getData: () => ({ convertedPrompts: prompts }),
    promptAnalyzer: {
      analyzePrompt: async () => ({ executionType: 'single', requiresFramework: false }),
    },
    gateAnalyzer: {},
    filterParser: { parseIntelligentFilters: () => ({}) },
    promptMatcher: {
      matchesFilters: async () => true,
      calculateRelevanceScore: () => 1,
    },
  } as unknown as PromptResourceContext;

  return new PromptDiscoveryProcessor(context);
}

const probePrompt = {
  id: 'probe_prompt',
  name: 'Probe Prompt',
  category: 'probe',
  description: 'A probe description',
  systemMessage: SYSTEM_BODY,
  userMessageTemplate: USER_BODY,
  arguments: [{ name: 'input', type: 'string', description: 'the input', required: true }],
};

async function listText(detail: string): Promise<string> {
  const processor = makeProcessor([probePrompt]);
  const result = await processor.listPrompts({ detail });
  return (result.content[0] as { text: string }).text;
}

describe('prompt listing omits instruction bodies', () => {
  it('does not return the system message from a full listing', async () => {
    const text = await listText('full');

    expect(text).not.toContain(SYSTEM_BODY);
    expect(text).not.toContain('**System Message**');
  });

  it('does not return the user message template from a full listing', async () => {
    const text = await listText('full');

    expect(text).not.toContain(USER_BODY);
    expect(text).not.toContain('**User Message Template**');
  });

  it('still returns the catalogue fields a listing is for', async () => {
    // The negative assertions above must not be passing because listing is broken.
    const text = await listText('full');

    expect(text).toContain('Probe Prompt');
    expect(text).toContain('probe_prompt');
    expect(text).toContain('A probe description');
    expect(text).toContain('input');
  });

  it('points the caller at the call that actually returns the bodies', async () => {
    // A bare `inspect` returns metadata only, so the pointer has to name `detail:"full"`
    // or it sends the reader to a call that does not answer them.
    const text = await listText('full');

    expect(text).toContain('action:"inspect"');
    expect(text).toContain('id:"probe_prompt"');
    expect(text).toContain('detail:"full"');
  });

  it('names which bodies exist, so the pointer is not offered for a prompt with none', async () => {
    const processor = makeProcessor([
      { ...probePrompt, systemMessage: undefined, userMessageTemplate: undefined },
    ]);
    const result = await processor.listPrompts({ detail: 'full' });
    const text = (result.content[0] as { text: string }).text;

    expect(text).not.toContain('**Content**');
  });

  it('leaves the summary listing alone', async () => {
    const text = await listText('summary');

    expect(text).not.toContain(SYSTEM_BODY);
    expect(text).toContain('probe_prompt');
  });
});
