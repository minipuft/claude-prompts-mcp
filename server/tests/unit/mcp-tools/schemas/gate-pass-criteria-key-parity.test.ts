/**
 * The MCP `resource_manager` tool's `gatePassCriteriaSchema` (resource-manager.schema.ts) is a
 * hand-written mirror of the engine's `GatePassCriteriaSchema` (gate-schema.ts) — not derived
 * from it, because the MCP surface intentionally drops `.passthrough()`: zod strips unknown keys
 * at the tool boundary, which is the safer behaviour for a network-facing tool and stays. A
 * hand-written mirror can drift silently — add a key to one side and nothing fails until an
 * author discovers the gap by hand. This file pins the two key sets equal, so a drift fails at
 * test time naming exactly which key moved and on which side.
 */
import { describe, expect, it } from '@jest/globals';

import { GatePassCriteriaSchema } from '../../../../src/engine/gates/core/gate-schema.js';
import { gatePassCriteriaSchema } from '../../../../src/mcp/tools/schemas/resource-manager.schema.js';

type KeyedShape = Record<string, unknown>;

/**
 * Set-diffs two zod-shape-like key sets, naming which key is missing from which side. Returns
 * `''` when the two sides agree, so a test can assert on the empty string directly rather than
 * on a boolean that would still need its own explanation on failure.
 */
function diffKeySets(
  labelA: string,
  shapeA: KeyedShape,
  labelB: string,
  shapeB: KeyedShape
): string {
  const keysA = new Set(Object.keys(shapeA));
  const keysB = new Set(Object.keys(shapeB));
  const onlyInA = [...keysA].filter((key) => !keysB.has(key)).sort();
  const onlyInB = [...keysB].filter((key) => !keysA.has(key)).sort();

  const parts: string[] = [];
  if (onlyInA.length > 0) parts.push(`only in ${labelA}: ${onlyInA.join(', ')}`);
  if (onlyInB.length > 0) parts.push(`only in ${labelB}: ${onlyInB.join(', ')}`);
  return parts.join('; ');
}

describe('diffKeySets (positive control)', () => {
  it('names a key present only on the left side', () => {
    const left: KeyedShape = { a: 1, b: 2 };
    const right: KeyedShape = { a: 1 };

    expect(diffKeySets('left', left, 'right', right)).toBe('only in left: b');
  });

  it('names a key present only on the right side', () => {
    const left: KeyedShape = { a: 1 };
    const right: KeyedShape = { a: 1, c: 3 };

    expect(diffKeySets('left', left, 'right', right)).toBe('only in right: c');
  });

  it('reports nothing when the two sides already agree', () => {
    const left: KeyedShape = { a: 1, b: 2 };
    const right: KeyedShape = { b: 99, a: 'anything' };

    expect(diffKeySets('left', left, 'right', right)).toBe('');
  });
});

describe('gate pass_criteria key parity (MCP tool schema vs engine schema)', () => {
  it('the MCP tool schema declares the same keys as the engine schema', () => {
    const diff = diffKeySets(
      'mcp gatePassCriteriaSchema',
      gatePassCriteriaSchema.shape,
      'engine GatePassCriteriaSchema',
      GatePassCriteriaSchema.shape
    );

    expect(diff).toBe('');
  });
});
