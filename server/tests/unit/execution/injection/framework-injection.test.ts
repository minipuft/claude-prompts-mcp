// @lifecycle canonical - Unit tests for the pre-injection framework projection (plan item 2.4)
import { describe, expect, it } from '@jest/globals';

import { isFrameworkInjected } from '../../../../src/engine/execution/pipeline/decisions/injection/framework-injection.js';

describe('isFrameworkInjected', () => {
  describe('modifiers', () => {
    it('reports suppressed under %lean — the incoherence this exists to fix', () => {
      // F4 in the plan: %lean suppressed the framework system prompt while keeping the gates
      // that score adherence to it. This is the signal that lets the nesting veto drop them.
      expect(isFrameworkInjected({ modifiers: { lean: true } })).toBe(false);
    });

    it('reports suppressed under %clean', () => {
      expect(isFrameworkInjected({ modifiers: { clean: true } })).toBe(false);
    });

    it('reports injected under %judge, which forces the methodology in', () => {
      // Mirrors InjectionDecisionService.checkModifiers: %judge forces system-prompt injection
      // so the judge selection phase always sees the framework.
      expect(isFrameworkInjected({ modifiers: { judge: true } })).toBe(true);
    });

    it('lets %judge win over %lean, matching force-before-disable ordering', () => {
      expect(isFrameworkInjected({ modifiers: { judge: true, lean: true } })).toBe(true);
    });

    it('reports injected when no modifier is active', () => {
      expect(isFrameworkInjected({ modifiers: { clean: false, lean: false } })).toBe(true);
      expect(isFrameworkInjected({})).toBe(true);
      expect(isFrameworkInjected({ modifiers: undefined })).toBe(true);
    });
  });

  describe('prompt-level declaration', () => {
    it('reports suppressed when the prompt disables system-prompt injection', () => {
      expect(
        isFrameworkInjected({ promptInjection: { 'system-prompt': { enabled: false } } })
      ).toBe(false);
    });

    it('reports injected when the prompt explicitly enables it', () => {
      expect(isFrameworkInjected({ promptInjection: { 'system-prompt': { enabled: true } } })).toBe(
        true
      );
    });

    it('ignores a rule that declares only frequency or target', () => {
      // Declaring how often to inject is not declaring whether to — an author tuning frequency
      // must not lose their framework gates as a side effect.
      expect(
        isFrameworkInjected({
          promptInjection: { 'system-prompt': { frequency: { mode: 'first-only' } } },
        })
      ).toBe(true);
      expect(
        isFrameworkInjected({ promptInjection: { 'system-prompt': { target: 'steps' } } })
      ).toBe(true);
    });

    it('ignores opt-outs of other injection types', () => {
      expect(
        isFrameworkInjected({
          promptInjection: {
            'gate-guidance': { enabled: false },
            'style-guidance': { enabled: false },
          },
        })
      ).toBe(true);
    });

    it('lets %judge force the methodology in over a prompt-level opt-out', () => {
      expect(
        isFrameworkInjected({
          modifiers: { judge: true },
          promptInjection: { 'system-prompt': { enabled: false } },
        })
      ).toBe(true);
    });
  });

  describe('direction of error', () => {
    it('defaults to injected, so gates are withheld only on positive suppression', () => {
      // The tiers this projection cannot see before stage 07b runs — runtime overrides,
      // chain/category/global enabled flags, frequency — can only make the real answer more
      // restrictive. Defaulting to `true` means no gate is ever dropped on a guess.
      expect(isFrameworkInjected({})).toBe(true);
      expect(isFrameworkInjected({ promptInjection: {} })).toBe(true);
      expect(isFrameworkInjected({ promptInjection: { 'system-prompt': {} } })).toBe(true);
    });
  });
});
