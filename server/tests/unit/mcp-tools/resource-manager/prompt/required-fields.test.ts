/**
 * P6.240 (R126) — what "missing" means for a `resource_manager` prompt action's required field.
 *
 * MEASURED 2026-09-28 on `9e51f4cb`, driven over Streamable HTTP: `rollback` with `version: 0`
 * and `compare` with `from_version: 0` were refused "Missing required fields … version" — the
 * same reply as a call that sent no version at all — because the check was `!args[field]`. The
 * MCP layer now names its rule, `== null || === ''`: an empty string is missing, `0` and `false`
 * are values. The snapshot contract keeps its own stated rule, `== null`, untouched.
 */

import { describe, expect, it } from '@jest/globals';

import { validateRequiredFields } from '../../../../../src/mcp/tools/resource-manager/prompt/utils/validation.js';
import { missingRequiredFields } from '../../../../../src/modules/versioning/snapshot-contract.js';

type Args = { action: string; id?: string; version?: number | null; flag?: boolean };

const refusal = (args: Args, required: ReadonlyArray<'id' | 'version' | 'flag'>): string | null => {
  try {
    validateRequiredFields(args, required);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe('validateRequiredFields (R126)', () => {
  it('(a) `0` and `false` are values; an empty string is missing', () => {
    expect(refusal({ action: 'rollback', id: 'p', version: 0 }, ['id', 'version'])).toBeNull();
    expect(refusal({ action: 'history', id: 'p', flag: false }, ['id', 'flag'])).toBeNull();
    expect(refusal({ action: 'history', id: '' }, ['id'])).toContain(
      "Missing required fields for action 'history': id"
    );
  });

  it('(b) control: an absent or null field is missing', () => {
    expect(refusal({ action: 'rollback', id: 'p' }, ['id', 'version'])).toContain(
      "Missing required fields for action 'rollback': version"
    );
    expect(refusal({ action: 'rollback', id: 'p', version: null }, ['id', 'version'])).toContain(
      "Missing required fields for action 'rollback': version"
    );
  });
});

describe('missingRequiredFields keeps the snapshot rule (R126)', () => {
  it("(c) only an absent or null field is missing; `0`, `false` and `''` are recorded values", () => {
    expect(
      missingRequiredFields({ a: 0, b: false, c: '', d: null }, ['a', 'b', 'c', 'd', 'e'])
    ).toEqual(['d', 'e']);
  });
});
