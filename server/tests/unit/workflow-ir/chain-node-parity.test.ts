// @lifecycle canonical - Tier A parity gate: one step vocabulary, three inputs.
//
// THE GATE ROW A.1 COMMISSIONED. `chainSteps[]` (YAML), `nodes[]` (submitted Workflow IR) and a
// `-->` chain all describe a step. Before Tier A two hand-written Zod objects agreed field-for-
// field by nobody's authority, and nothing failed when one side gained a field — the shape that
// left `inlineGateIds` declared and dead in three shipped chains.
//
// `ChainStepSchema` is now DERIVED from `workflowNodeSchema`, which makes divergence structurally
// impossible in the add-to-the-node-schema direction. This file is the OTHER direction plus the
// two deliberate deltas: a future edit that re-declares `ChainStepSchema` standalone, or adds a
// key to it alone, fails here rather than shipping a field one input silently drops.
import { describe, expect, it } from '@jest/globals';

import { ChainStepSchema, stripExporterOnlyStepKeys } from '#modules/prompts/prompt-schema.js';
import {
  EXPORTER_ONLY_STEP_KEYS,
  WORKFLOW_NODE_FIELDS,
  workflowNodeSchema,
} from '#modules/workflow-ir/node-schema.js';

/** Field names a Zod object declares, sorted so the comparison is order-insensitive. */
function fieldsOf(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape).sort();
}

describe('chain step / IR node parity (row A.1)', () => {
  it('declares exactly the same field names on both inputs', () => {
    expect(fieldsOf(ChainStepSchema)).toEqual([...WORKFLOW_NODE_FIELDS]);
  });

  it('keeps WORKFLOW_NODE_FIELDS a measurement of the node schema, not a hand list', () => {
    // Guards the guard: if the exported constant stopped being derived from the schema, the
    // assertion above would compare a list against itself and pass vacuously.
    expect([...WORKFLOW_NODE_FIELDS]).toEqual(fieldsOf(workflowNodeSchema));
  });

  describe('the two deliberate deltas — identity only', () => {
    const STEP = { promptId: 'analyze', stepName: 'Analyze' };

    it('requires an id on a node and mints one for a YAML step', () => {
      expect(workflowNodeSchema.safeParse(STEP).success).toBe(false);
      expect(ChainStepSchema.safeParse(STEP).success).toBe(true);
    });

    it('requires a stepName on a YAML step and defaults it for a node', () => {
      expect(ChainStepSchema.safeParse({ promptId: 'analyze', id: 'analyze' }).success).toBe(false);
      expect(workflowNodeSchema.safeParse({ promptId: 'analyze', id: 'analyze' }).success).toBe(
        true
      );
    });
  });

  describe('exporter-only keys are stripped, not declared and not rejected', () => {
    it('rejects `delegation` on a step when it reaches the schema', () => {
      // The field has no runtime reader on any of the three inputs, so it may not be part of the
      // vocabulary — `-->` and a submitted IR could never export it.
      expect(
        ChainStepSchema.safeParse({ promptId: 'a', stepName: 'A', delegation: true }).success
      ).toBe(false);
      expect(WORKFLOW_NODE_FIELDS).not.toContain('delegation');
    });

    it('removes it before validation so YAML the skills-sync exporter honours still loads', () => {
      const raw = {
        id: 'c',
        chainSteps: [{ promptId: 'a', stepName: 'A', delegation: true }],
      };
      const stripped = stripExporterOnlyStepKeys(raw) as typeof raw;

      expect(stripped.chainSteps[0]).not.toHaveProperty('delegation');
      expect(ChainStepSchema.safeParse(stripped.chainSteps[0]).success).toBe(true);
      // Never mutates its argument: `resource-verification-service` keeps the object it passes.
      expect(raw.chainSteps[0]).toHaveProperty('delegation');
    });

    it('returns the input untouched when no exporter-only key is present', () => {
      const raw = { chainSteps: [{ promptId: 'a', stepName: 'A' }] };
      expect(stripExporterOnlyStepKeys(raw)).toBe(raw);
      expect(EXPORTER_ONLY_STEP_KEYS).toEqual(['delegation']);
    });
  });
});
