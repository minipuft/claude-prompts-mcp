/**
 * Config Input Validator — Pure validation for config.json keys and values.
 *
 * ONE TABLE, NOT A SWITCH
 * This file used to carry a 60-case `switch` over dotted keys, and `mcp/tools/config-utils.ts`
 * carried a second, shorter one. Three lists therefore had to agree by hand — the switch, the
 * key tuple above it, and `config.schema.json` — and they did not: the MCP copy accepted 24 keys
 * where this one accepted 60, so the same `key=value` was valid on one tool surface and unknown
 * on the other. Both switches are gone. `_generated/config-keys.ts` is generated from
 * `config.schema.json` (itself generated from `ConfigFile`), so the settable key set and the
 * constraint each key is checked by now come from the one declaration the loader also validates
 * the whole document against.
 *
 * WHAT THE TABLE CANNOT SAY, IT DOES NOT SAY
 * A bound the switch asserted but `ConfigFile` does not declare is NOT re-added here — that would
 * rebuild the second source this file exists to delete. The fix for a missing bound is a
 * `@minimum` / `@maximum` / `@pattern` tag on the member in `src/shared/types/config-file.ts`,
 * which reaches the schema, the table, and this validator in one regeneration.
 *
 * The two uniform rules below are the exception, and they are uniform precisely so they cannot
 * drift per key: a non-enum string must be non-empty after trimming, and an enum comparison is
 * case-insensitive. Every enum member the schema declares is lowercase, so lowercasing only ever
 * widens what is accepted; it never rejects a value the old switch took.
 */

import {
  CONFIG_KEY_TABLE,
  CONFIG_VALID_KEYS,
  type ConfigKey,
  type ConfigLeafRule,
} from './_generated/config-keys.js';

export {
  CONFIG_KEY_TABLE,
  CONFIG_VALID_KEYS,
  type ConfigKey,
  type ConfigLeafRule,
} from './_generated/config-keys.js';

/**
 * Keys whose new value the running process cannot pick up without a restart.
 *
 * `server.port` is the whole list: it is read once when the HTTP listener binds. The other three
 * entries this constant used to carry are gone for two different reasons — `server.transport` is
 * no longer a config key at all (the transport is chosen per launch), and `telemetry.mode` /
 * `telemetry.exporterEndpoint` are re-read by the telemetry subsystem on config reload.
 */
export const CONFIG_RESTART_REQUIRED_KEYS: ConfigKey[] = ['server.port'];

export interface ConfigInputValidationResult {
  valid: boolean;
  error?: string;
  convertedValue?: unknown;
  /** `integer` leaves report `'number'`: the distinction is a schema concern, not a caller's. */
  valueType?: 'string' | 'number' | 'boolean' | 'array';
}

// ── Key resolution ───────────────────────────────────────────────────────────

/**
 * Reads a cell of a row this module built itself. An out-of-range index is a bug in the loop
 * below, never a data case, so it throws rather than substituting a value that would make the
 * distance silently wrong.
 */
function cellAt(row: readonly number[], index: number): number {
  const cell = row[index];
  if (cell === undefined) {
    throw new Error(`editDistance: row index ${index} out of range (length ${row.length})`);
  }
  return cell;
}

/** Levenshtein distance, used only to rank suggestions for an unknown key. */
function editDistance(left: string, right: string): number {
  const row: number[] = Array.from({ length: right.length + 1 }, (_unused, index) => index);

  for (let i = 1; i <= left.length; i++) {
    let diagonal = cellAt(row, 0);
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = cellAt(row, j);
      const substitution = diagonal + (left[i - 1] === right[j - 1] ? 0 : 1);
      row[j] = Math.min(cellAt(row, j - 1) + 1, above + 1, substitution);
      diagonal = above;
    }
  }

  return cellAt(row, right.length);
}

/** The three closest valid keys, closest first — empty when nothing is close enough to help. */
function nearestKeys(key: string): string[] {
  return CONFIG_VALID_KEYS.map((candidate) => ({
    candidate,
    distance: editDistance(key, candidate),
  }))
    .filter(({ distance }) => distance <= Math.max(3, Math.round(key.length / 3)))
    .sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.candidate < b.candidate ? -1 : 1;
    })
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

/** Valid keys nested under `key`, i.e. the settings a section name stands in front of. */
function leavesBeneath(key: string): string[] {
  return CONFIG_VALID_KEYS.filter((candidate) => candidate.startsWith(`${key}.`));
}

function unknownKeyResult(key: string): ConfigInputValidationResult {
  const beneath = leavesBeneath(key);
  if (beneath.length > 0) {
    return {
      valid: false,
      error:
        `Configuration key ${key} names a section, not a setting. Set one of: ` +
        `${beneath.join(', ')}`,
    };
  }

  const suggestions = nearestKeys(key);
  return {
    valid: false,
    error:
      suggestions.length > 0
        ? `Unknown configuration key: ${key}. Did you mean: ${suggestions.join(', ')}?`
        : `Unknown configuration key: ${key}`,
  };
}

// ── Per-type coercion ────────────────────────────────────────────────────────

function coerceBoolean(value: string): ConfigInputValidationResult {
  const normalized = value.trim().toLowerCase();
  if (normalized !== 'true' && normalized !== 'false') {
    return { valid: false, error: "Value must be 'true' or 'false'" };
  }
  return { valid: true, convertedValue: normalized === 'true', valueType: 'boolean' };
}

/** `must be between 1 and 10` / `must be >= 30` / `` — whichever bounds the rule declares. */
function boundsClause(rule: ConfigLeafRule): string {
  const { minimum, maximum } = rule;
  if (minimum !== undefined && maximum !== undefined) return ` between ${minimum} and ${maximum}`;
  if (minimum !== undefined) return ` >= ${minimum}`;
  if (maximum !== undefined) return ` <= ${maximum}`;
  return '';
}

function coerceNumeric(
  key: string,
  value: string,
  rule: ConfigLeafRule
): ConfigInputValidationResult {
  const trimmed = value.trim();
  const isInteger = rule.type === 'integer';
  const shape = isInteger ? /^[+-]?\d+$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const noun = isInteger ? 'a whole number' : 'a number';
  const parsed = isInteger ? Number.parseInt(trimmed, 10) : Number.parseFloat(trimmed);

  if (!shape.test(trimmed) || Number.isNaN(parsed)) {
    return { valid: false, error: `${key} must be ${noun}${boundsClause(rule)}` };
  }
  if (
    (rule.minimum !== undefined && parsed < rule.minimum) ||
    (rule.maximum !== undefined && parsed > rule.maximum)
  ) {
    return { valid: false, error: `${key} must be ${noun}${boundsClause(rule)}` };
  }

  return { valid: true, convertedValue: parsed, valueType: 'number' };
}

function coerceString(
  key: string,
  value: string,
  rule: ConfigLeafRule
): ConfigInputValidationResult {
  if (rule.enum !== undefined) {
    const normalized = value.trim().toLowerCase();
    if (!rule.enum.includes(normalized)) {
      return { valid: false, error: `${key} must be one of: ${rule.enum.join(', ')}` };
    }
    return { valid: true, convertedValue: normalized, valueType: 'string' };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Value cannot be empty' };
  }
  return { valid: true, convertedValue: trimmed, valueType: 'string' };
}

/** Comma-separated on the wire, `string[]` on disk — a CLI argument has no other way to say a list. */
function coerceArray(
  key: string,
  value: string,
  rule: ConfigLeafRule
): ConfigInputValidationResult {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const pattern = rule.items?.pattern;
  if (pattern !== undefined) {
    const invalid = entries.filter((entry) => !new RegExp(pattern).test(entry));
    if (invalid.length > 0) {
      return {
        valid: false,
        error:
          `${key} must be comma-separated entries matching ${pattern} ` +
          `(invalid: ${invalid.join(', ')})`,
      };
    }
  }

  return { valid: true, convertedValue: entries, valueType: 'array' };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Validates one `key=value` candidate against the generated leaf table and returns the coerced
 * value. Pure: it neither reads nor writes `config.json`.
 */
export function validateConfigInput(key: string, value: string): ConfigInputValidationResult {
  if (!CONFIG_VALID_KEYS.includes(key as ConfigKey)) {
    return unknownKeyResult(key);
  }

  const rule = CONFIG_KEY_TABLE[key as ConfigKey];

  switch (rule.type) {
    case 'boolean':
      return coerceBoolean(value);
    case 'integer':
    case 'number':
      return coerceNumeric(key, value, rule);
    case 'array':
      return coerceArray(key, value, rule);
    case 'string':
      return coerceString(key, value, rule);
  }
}
