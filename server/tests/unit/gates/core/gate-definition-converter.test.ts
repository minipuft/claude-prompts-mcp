/**
 * `toGateDefinition` — the one conversion from a loaded gate.yaml to the pipeline's definition.
 *
 * Classification: Unit. Pure function, fed a parsed definition built by the real schema.
 */
import { describe, expect, test } from '@jest/globals';

import { toGateDefinition } from '../../../../src/engine/gates/core/gate-definition-converter.js';
import { GateDefinitionSchema } from '../../../../src/engine/gates/core/gate-schema.js';

import type { LoadedGateDefinition } from '../../../../src/engine/gates/core/gate-schema.js';
import type { LightweightGateDefinition } from '../../../../src/engine/gates/types.js';

/** A definition with every key `LightweightGateDefinition` declares populated. */
function fullDefinition(): LoadedGateDefinition {
  return {
    ...GateDefinitionSchema.parse({
      id: 'full',
      name: 'Full',
      type: 'validation',
      description: 'every key',
      subject: 'output',
      severity: 'high',
      enforcementMode: 'advisory',
      guidanceFile: 'guidance.md',
      guidance: 'GUIDE',
      pass_criteria: [{ type: 'inline_guidance' }],
      retry_config: { max_attempts: 4, improvement_hints: false, preserve_context: false },
      activation: { explicit_request: true },
      gate_type: 'category',
      blockResponseOnFail: true,
      evaluation: { mode: 'judge', model: 'haiku', strict: true },
    }),
    sourceRoot: '/roots/gates',
  };
}

/**
 * Every key of the output type, as a runtime list. The `Record<keyof …, true>` annotation makes this
 * object exhaustive at compile time, so a key added to the interface cannot be missed here either.
 */
const OUTPUT_KEYS: Record<keyof LightweightGateDefinition, true> = {
  id: true,
  name: true,
  type: true,
  description: true,
  subject: true,
  severity: true,
  enforcementMode: true,
  guidanceFile: true,
  guidance: true,
  pass_criteria: true,
  retry_config: true,
  activation: true,
  gate_type: true,
  blockResponseOnFail: true,
  evaluation: true,
  sourceRoot: true,
};

describe('toGateDefinition', () => {
  test('every declared key round-trips with its value', () => {
    const loaded = fullDefinition();
    const converted = toGateDefinition(loaded);

    expect(Object.keys(converted).sort()).toEqual(Object.keys(OUTPUT_KEYS).sort());
    for (const key of Object.keys(OUTPUT_KEYS) as Array<keyof LightweightGateDefinition>) {
      expect(converted[key]).toEqual(loaded[key]);
    }
  });

  test('sourceRoot, evaluation, enforcementMode and blockResponseOnFail are carried', () => {
    const converted = toGateDefinition(fullDefinition());

    expect(converted.sourceRoot).toBe('/roots/gates');
    expect(converted.evaluation).toEqual({ mode: 'judge', model: 'haiku', strict: true });
    expect(converted.enforcementMode).toBe('advisory');
    expect(converted.blockResponseOnFail).toBe(true);
  });

  test('an undeclared passthrough key is not carried; the output type is closed', () => {
    const loaded = GateDefinitionSchema.parse({
      id: 'planted',
      name: 'Planted',
      type: 'guidance',
      description: 'carries an undeclared key',
      planted_extra: 'PLANTED',
    });
    // Positive control: the schema's passthrough kept the key, so its absence below is the
    // converter's decision and not the parser's.
    expect(loaded['planted_extra']).toBe('PLANTED');

    expect(toGateDefinition(loaded)).not.toHaveProperty('planted_extra');
  });

  test('absent optional keys stay absent, and schema defaults arrive', () => {
    const converted = toGateDefinition(
      GateDefinitionSchema.parse({ id: 'min', name: 'Min', type: 'guidance', description: 'd' })
    );

    expect(converted).toEqual({
      id: 'min',
      name: 'Min',
      type: 'guidance',
      description: 'd',
      severity: 'medium',
      gate_type: 'custom',
    });
  });

  test('a partial retry_config is completed with the declared defaults', () => {
    const loaded = { ...fullDefinition(), retry_config: { max_attempts: 5 } };

    expect(toGateDefinition(loaded).retry_config).toEqual({
      max_attempts: 5,
      improvement_hints: true,
      preserve_context: true,
    });
  });

  test('the input is not mutated', () => {
    const loaded = fullDefinition();
    const before = JSON.stringify(loaded);

    toGateDefinition(loaded);

    expect(JSON.stringify(loaded)).toBe(before);
  });
});
