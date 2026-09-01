/**
 * A mutation response must OPEN with the outcome its `isError` flag carries.
 *
 * Measured 2026-08-30 against a real create: the body opened `✅ **Prompt Created**` and carried
 * `❌ **Post-write verification failed**` at LINE 14, underneath the headline, the analysis and the
 * receipt. `isError` was `true` the whole time — the flag was right and the prose contradicted it,
 * so any reader that quotes the opening line (a client summarising, a log excerpt, a truncated
 * transcript) reported a success.
 *
 * Both directions are asserted. A test that only proves the failure branch leads with `❌` passes
 * equally against a function that returns `❌` unconditionally, which is the likelier regression
 * once someone "simplifies" this.
 */

import { describe, expect, it } from '@jest/globals';

import { mutationHeadline } from '../../../../src/mcp/tools/resource-manager/prompt/utils/mutation-headline.js';

const VERIFIED = { verified: true } as const;
const FAILED = {
  verified: false,
  error: "Prompt 'x' was written but the refreshed registry did not expose the expected state.",
} as const;

describe('mutationHeadline', () => {
  describe('verification passed', () => {
    it('leads with the success claim', () => {
      const headline = mutationHeadline('Created', 'My Prompt', 'my_prompt', VERIFIED);
      expect(headline.split('\n')[0]).toBe('✅ **Prompt Created**: My Prompt (my_prompt)');
    });

    it('carries no failure marker at all', () => {
      expect(mutationHeadline('Updated', 'My Prompt', 'my_prompt', VERIFIED)).not.toContain('❌');
    });
  });

  describe('verification failed', () => {
    it('leads with the failure, not with a success claim', () => {
      const firstLine = mutationHeadline('Created', 'My Prompt', 'my_prompt', FAILED).split(
        '\n'
      )[0];
      expect(firstLine).toContain('❌');
      expect(firstLine).not.toContain('✅');
    });

    it('still says the write happened — the write did happen, verification did not', () => {
      // The honest claim is narrow: files landed, the registry did not come back with them. A
      // headline reading "creation failed" would send the caller looking for a prompt that exists.
      const headline = mutationHeadline('Created', 'My Prompt', 'my_prompt', FAILED);
      expect(headline).toContain('Prompt Created');
      expect(headline).toContain('post-write verification FAILED');
    });

    it('states the reason on the line under the headline, not further down', () => {
      const lines = mutationHeadline('Updated', 'My Prompt', 'my_prompt', FAILED).split('\n');
      expect(lines[1]).toBe(FAILED.error);
    });

    it('names a reason even when the verifier reported none', () => {
      // `error` is optional on the verification result, so an absent one must not render
      // `undefined` into client-facing prose.
      const headline = mutationHeadline('Created', 'My Prompt', 'my_prompt', { verified: false });
      expect(headline).not.toContain('undefined');
      expect(headline).toContain('No reason reported.');
    });
  });

  it('distinguishes create from update in both branches', () => {
    expect(mutationHeadline('Created', 'N', 'i', VERIFIED)).toContain('Prompt Created');
    expect(mutationHeadline('Updated', 'N', 'i', VERIFIED)).toContain('Prompt Updated');
    expect(mutationHeadline('Created', 'N', 'i', FAILED)).toContain('Prompt Created');
    expect(mutationHeadline('Updated', 'N', 'i', FAILED)).toContain('Prompt Updated');
  });
});
