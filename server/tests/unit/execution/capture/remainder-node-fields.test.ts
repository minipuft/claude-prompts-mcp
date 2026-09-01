// @lifecycle canonical - Row A.5 gate: every IR node field is carried by a remainder or refused by it.
//
// THE ENUMERATION THAT CLOSES THE CLASS. A remainder node has no entry in
// `parsedCommand.steps`, so the renderer synthesizes its step from the node alone
// (`operators/node-step-projection.ts`). Anything the node does not carry is therefore a field
// the run provably never sees — and until row A.5 the remainder path accepted the whole IR node
// vocabulary and silently narrowed it to `{id, promptId, stepName}`.
//
// Fixing the two operators A.3 refused by name would have left the same defect standing on
// `args`, `subagentModel`, `retries` and five more (dev-workflow.md: a fix at the sites you found
// is not a fix of the class). This file is the gate that owns the class: a field added to
// `workflowNodeSchema` fails here until someone decides whether the remainder path carries it or
// refuses it. Neither decision is free, which is the point — the third option, silently dropping
// it, is the one that has no cost at the time and produces P-A-F5 later.
import { describe, expect, test } from '@jest/globals';

import {
  REMAINDER_CARRIED_NODE_FIELDS,
  REMAINDER_REFUSED_NODE_FIELDS,
} from '#engine/execution/capture/remainder-processor.js';
import { WORKFLOW_NODE_FIELDS } from '#modules/workflow-ir/node-schema.js';

describe('row A.5 — the remainder node vocabulary is a closed decision', () => {
  const carried = [...REMAINDER_CARRIED_NODE_FIELDS];
  const refused = Object.keys(REMAINDER_REFUSED_NODE_FIELDS);

  test('every workflow node field is either carried or refused, and none is both', () => {
    expect([...carried, ...refused].sort()).toEqual([...WORKFLOW_NODE_FIELDS].sort());
    expect(carried.filter((field) => refused.includes(field))).toEqual([]);
  });

  test('every refusal names what the caller should do instead', () => {
    // A refusal with no alternative is a dead end, and P-A-F5 is about refusal messages rotting
    // into folklore. Each entry owes the submitter a next move.
    for (const field of refused) {
      expect(REMAINDER_REFUSED_NODE_FIELDS[field]?.length ?? 0).toBeGreaterThan(10);
    }
  });

  test('the two operators row A.3 refused are on opposite sides of the split', () => {
    // The asymmetry is deliberate and is the whole ruling A.5 landed: `==>` reaches the run
    // through the node's `delegated` declaration; a raw `::` token cannot, because the gate
    // registry resolution that gives it meaning runs at parse time and an appended node joins a
    // run that is resuming.
    expect(carried).toContain('delegated');
    expect(refused).toContain('inlineGateCriteria');
  });
});
