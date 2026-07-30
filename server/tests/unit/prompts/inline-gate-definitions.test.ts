// @lifecycle canonical - Unit tests for inline gate definition normalization (plan item 3.1)
import { describe, expect, it, jest } from '@jest/globals';

import { normalizeInlineGateDefinitions } from '../../../src/modules/prompts/yaml-prompt-loader';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const validDefinition = (overrides: Record<string, unknown> = {}) => ({
  name: 'Section Contract',
  type: 'validation',
  scope: 'execution',
  description: 'Checks the section contract holds',
  guidance: 'Verify every declared section is present',
  ...overrides,
});

/** All warning text emitted, joined — assertions read against the operator-visible message. */
const warnings = (logger: ReturnType<typeof createLogger>): string =>
  logger.warn.mock.calls.map((call) => String(call[0])).join('\n');

describe('normalizeInlineGateDefinitions', () => {
  describe('accepting well-formed definitions', () => {
    it('normalizes a complete definition without warning', () => {
      const logger = createLogger();

      const result = normalizeInlineGateDefinitions([validDefinition()], { logger });

      expect(result).toHaveLength(1);
      expect(result?.[0]?.name).toBe('Section Contract');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('carries optional fields through', () => {
      const result = normalizeInlineGateDefinitions([
        validDefinition({
          id: 'section-contract',
          expires_at: 1234,
          source: 'manual',
          context: { origin: 'test' },
          pass_criteria: ['a', 'b'],
        }),
      ]);

      expect(result?.[0]).toMatchObject({
        id: 'section-contract',
        expires_at: 1234,
        source: 'manual',
        context: { origin: 'test' },
        pass_criteria: ['a', 'b'],
      });
    });

    it('defaults pass_criteria to an empty array', () => {
      const result = normalizeInlineGateDefinitions([validDefinition()]);
      expect(result?.[0]?.pass_criteria).toEqual([]);
    });

    it('returns undefined for a non-array input', () => {
      expect(normalizeInlineGateDefinitions(undefined)).toBeUndefined();
      expect(normalizeInlineGateDefinitions('not an array')).toBeUndefined();
    });
  });

  describe('warn-on-drop (ADR 0001 release N)', () => {
    // The point of this release is that an operator can see, one release before inline
    // definitions begin to execute, which of their prompts would newly arm a gate. A silent
    // `continue` gave them nothing to look at.

    it('names the prompt, the gate, and the offending field', () => {
      const logger = createLogger();

      normalizeInlineGateDefinitions([validDefinition({ guidance: 42 })], {
        logger,
        promptId: 'scene_muse',
      });

      const text = warnings(logger);
      expect(text).toContain('scene_muse');
      expect(text).toContain('Section Contract');
      expect(text).toContain('guidance');
    });

    it('reports every offending field, not just the first', () => {
      // An author fixing one field per load cycle needs as many cycles as they have mistakes.
      const logger = createLogger();

      normalizeInlineGateDefinitions([{ name: 'Broken' }], { logger });

      const text = warnings(logger);
      expect(text).toContain('type');
      expect(text).toContain('scope');
      expect(text).toContain('description');
      expect(text).toContain('guidance');
    });

    it('names the enumerated values for type and scope', () => {
      const logger = createLogger();

      normalizeInlineGateDefinitions([validDefinition({ type: 'wrong', scope: 'wrong' })], {
        logger,
      });

      const text = warnings(logger);
      expect(text).toContain('validation');
      expect(text).toContain('execution');
    });

    it('falls back to the id, then a positional label, when name is unusable', () => {
      const logger = createLogger();

      normalizeInlineGateDefinitions(
        [
          { id: 'has-id', name: 99, type: 'validation', scope: 'execution' },
          { type: 'validation', scope: 'execution' },
        ],
        { logger }
      );

      const text = warnings(logger);
      expect(text).toContain('has-id');
      expect(text).toContain('#1');
    });

    it('warns for a non-object entry', () => {
      const logger = createLogger();

      normalizeInlineGateDefinitions(['just a string', null], { logger });

      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it('warns once per dropped definition and keeps the valid ones', () => {
      const logger = createLogger();

      const result = normalizeInlineGateDefinitions(
        [validDefinition({ name: 'Good' }), validDefinition({ description: null }), 'nope'],
        { logger }
      );

      expect(result).toHaveLength(1);
      expect(result?.[0]?.name).toBe('Good');
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it('states that the gate will not load, so the warning is actionable', () => {
      const logger = createLogger();

      normalizeInlineGateDefinitions([{ name: 'Broken' }], { logger });

      expect(warnings(logger)).toContain('will not load');
    });
  });

  describe('degrading rather than failing', () => {
    it('drops malformed definitions instead of throwing', () => {
      // A malformed block must not take a prompt out of service (ADR 0001 (d)).
      expect(() =>
        normalizeInlineGateDefinitions([{ name: 'Broken' }, null, 7, validDefinition()])
      ).not.toThrow();
    });

    it('returns undefined when every definition was dropped', () => {
      const result = normalizeInlineGateDefinitions([{ name: 'Broken' }]);
      expect(result).toBeUndefined();
    });

    it('stays silent when no logger is supplied', () => {
      // Keeps the function usable from call sites that have no logger; they lose the warning,
      // not correctness.
      expect(() => normalizeInlineGateDefinitions([{ name: 'Broken' }])).not.toThrow();
      expect(normalizeInlineGateDefinitions([{ name: 'Broken' }], {})).toBeUndefined();
    });
  });
});
