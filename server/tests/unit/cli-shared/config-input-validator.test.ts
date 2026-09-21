/**
 * `validateConfigInput` after it became table-driven.
 *
 * The function used to be a 60-case `switch`, duplicated in `mcp/tools/config-utils.ts`. It is now
 * one lookup into `_generated/config-keys.ts`, which `scripts/generate-config-schema.ts` derives
 * from `ConfigFile`. So these cases are written against the TABLE's vocabulary — a type, an enum,
 * a bound, a pattern — rather than against key names a switch happened to list, and the last case
 * is the control that keeps the rest honest: every key the table declares must accept at least one
 * value, or the rejections above would pass equally well against a validator that rejects
 * everything.
 *
 * Classification: Unit (one pure function, no I/O).
 */

import { describe, expect, it } from '@jest/globals';

import {
  CONFIG_KEY_TABLE,
  CONFIG_RESTART_REQUIRED_KEYS,
  CONFIG_VALID_KEYS,
  validateConfigInput,
} from '../../../src/cli-shared/config-input-validator.js';
import type { ConfigLeafRule } from '../../../src/cli-shared/config-input-validator.js';

/** A value the table must accept for `rule`, built only from what the rule declares. */
function acceptableValue(rule: ConfigLeafRule): string {
  switch (rule.type) {
    case 'boolean':
      return 'true';
    case 'array':
      return rule.items?.pattern === undefined ? 'alpha,beta' : 'alpha-one,beta';
    case 'string':
      return rule.enum ? (rule.enum[0] as string) : 'a-value';
    case 'integer':
    case 'number': {
      const floor = rule.minimum ?? 1;
      const ceiling = rule.maximum ?? floor + 1;
      const midpoint = Math.min(ceiling, floor + (rule.type === 'integer' ? 1 : 0.5));
      return String(rule.type === 'integer' ? Math.ceil(midpoint) : midpoint);
    }
  }
}

describe('validateConfigInput', () => {
  describe('key resolution', () => {
    it('rejects an unknown key and names the nearest valid ones', () => {
      const result = validateConfigInput('gates.enabld', 'true');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown configuration key: gates.enabld');
      expect(result.error).toContain('gates.enabled');
    });

    it('rejects a key that names a section, listing the settings beneath it', () => {
      const result = validateConfigInput('telemetry', 'true');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('names a section, not a setting');
      expect(result.error).toContain('telemetry.enabled');
    });

    it('rejects a key with no near neighbour without inventing a suggestion', () => {
      const result = validateConfigInput('completely.unrelated.nonsense.key', 'true');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Unknown configuration key: completely.unrelated.nonsense.key');
    });
  });

  describe('coercion by table type', () => {
    it('parses an integer leaf to a number', () => {
      expect(validateConfigInput('server.port', '9091')).toMatchObject({
        valid: true,
        convertedValue: 9091,
        valueType: 'number',
      });
    });

    it('rejects a non-numeric value for an integer leaf', () => {
      const result = validateConfigInput('server.port', 'nine');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('server.port must be a whole number');
    });

    it('rejects a port above the leaf maximum, naming the bound', () => {
      // `server.port` carries `@minimum 1024 @maximum 65535` on its ConfigFile member (row 4.5,
      // ruling R53 — the bound moved off a switch this file's header already describes as retired
      // and back onto the generated table).
      const result = validateConfigInput('server.port', '70000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 1024 and 65535');
    });

    it('rejects a value above the leaf maximum', () => {
      // `resources.logs.maxEntries` carries `@minimum 50 @maximum 5000` on its ConfigFile member.
      const result = validateConfigInput('resources.logs.maxEntries', '6000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 50 and 5000');
    });

    it('rejects a value below the leaf minimum', () => {
      const result = validateConfigInput('resources.logs.maxEntries', '10');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 50 and 5000');
    });

    it('parses a float leaf without truncating it', () => {
      expect(validateConfigInput('telemetry.samplingRate', '0.25')).toMatchObject({
        valid: true,
        convertedValue: 0.25,
        valueType: 'number',
      });
    });

    it('rejects a value outside an enum', () => {
      const result = validateConfigInput('logging.level', 'loud');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('logging.level must be one of');
      expect(result.error).toContain('debug');
    });

    it('accepts an enum member, case-insensitively', () => {
      expect(validateConfigInput('logging.level', 'INFO')).toMatchObject({
        valid: true,
        convertedValue: 'info',
        valueType: 'string',
      });
    });

    it('parses a boolean leaf, and rejects anything that is not true/false', () => {
      expect(validateConfigInput('gates.enabled', 'false')).toMatchObject({
        valid: true,
        convertedValue: false,
        valueType: 'boolean',
      });
      expect(validateConfigInput('gates.enabled', 'yes')).toMatchObject({ valid: false });
    });

    it('rejects an empty value for a free-form string leaf', () => {
      expect(validateConfigInput('logging.directory', '   ')).toMatchObject({
        valid: false,
        error: 'Value cannot be empty',
      });
    });

    it('splits an array leaf on commas and enforces the item pattern', () => {
      expect(validateConfigInput('gates.harnessCovers', 'security, code-review')).toMatchObject({
        valid: true,
        convertedValue: ['security', 'code-review'],
        valueType: 'array',
      });

      const rejected = validateConfigInput('gates.harnessCovers', 'Security_Review');
      expect(rejected.valid).toBe(false);
      expect(rejected.error).toContain('Security_Review');
    });
  });

  describe('restart-required keys', () => {
    it('names only keys the table declares', () => {
      expect(CONFIG_RESTART_REQUIRED_KEYS).toEqual(['server.port']);
      for (const key of CONFIG_RESTART_REQUIRED_KEYS) {
        expect(CONFIG_VALID_KEYS).toContain(key);
      }
    });
  });

  // POSITIVE CONTROL. Without it, every rejection above would also pass against a validator that
  // returned `{ valid: false }` unconditionally — and every key the generator adds would be
  // unreachable with nothing saying so.
  describe('positive control — every declared key accepts a value built from its own rule', () => {
    it.each(CONFIG_VALID_KEYS.map((key) => [key] as const))('%s', (key) => {
      const rule = CONFIG_KEY_TABLE[key];
      const result = validateConfigInput(key, acceptableValue(rule));

      expect(result).toMatchObject({ valid: true });
    });

    it('covers every type the table can hold', () => {
      const types = new Set(CONFIG_VALID_KEYS.map((key) => CONFIG_KEY_TABLE[key].type));

      expect([...types].sort()).toEqual(['array', 'boolean', 'integer', 'number', 'string']);
    });
  });
});
