// @lifecycle canonical - The restore planner's three buckets, its refusals, and its determinism.
/**
 * Hand-built trees only. The planner reads no file and opens no database, so every case here is a
 * pair of `{path, hash}` lists — which is the point of it being pure: the three-way decision a
 * rollback makes can be pinned without a disk, and the byte-level proof that the decision is
 * CARRIED OUT correctly lives where it belongs, in the `tools/call` tests over real fixtures.
 */

import { describe, it, expect } from '@jest/globals';
import * as path from 'node:path';

import {
  planRestore,
  restoreWritesNothing,
  describeRestorePlan,
} from '../../../src/modules/versioning/restore-plan.js';

import type {
  RecordedFile,
  RestorePlan,
  RestorePlanInput,
} from '../../../src/modules/versioning/restore-plan.js';

const ROOT = path.resolve('/tmp/restore-plan-root/alpha');

function planInput(overrides: Partial<RestorePlanInput> = {}): RestorePlanInput {
  return {
    resourceType: 'gate',
    resourceId: 'alpha',
    version: 3,
    destinationRoot: ROOT,
    destinationOrigin: 'primary',
    recordedOrigin: 'primary',
    target: [],
    current: [],
    ...overrides,
  };
}

function file(p: string, hash: string): RecordedFile {
  return { path: p, hash: `sha256:${hash}` };
}

/** The plan, or a thrown assertion naming the refusal — so every `ok` case reads as one line. */
function planOf(overrides: Partial<RestorePlanInput>): RestorePlan {
  const result = planRestore(planInput(overrides));
  if (!result.ok) throw new Error(`expected a plan, got a refusal: ${result.refusal}`);
  return result.plan;
}

describe('planRestore — the three buckets', () => {
  it('writes a path whose recorded bytes differ from the bytes on disk', () => {
    const plan = planOf({
      target: [file('gate.yaml', 'aaa')],
      current: [file('gate.yaml', 'bbb')],
    });

    expect(plan.write).toEqual([
      {
        path: 'gate.yaml',
        absolutePath: path.join(ROOT, 'gate.yaml'),
        hash: 'sha256:aaa',
        reason: 'differs',
      },
    ]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.leftInPlace).toEqual([]);
  });

  it('writes a recorded path that is not on disk at all, and says which reason', () => {
    const plan = planOf({
      target: [file('gate.yaml', 'aaa'), file('guidance.md', 'ccc')],
      current: [file('gate.yaml', 'aaa')],
    });

    expect(plan.write).toEqual([
      {
        path: 'guidance.md',
        absolutePath: path.join(ROOT, 'guidance.md'),
        hash: 'sha256:ccc',
        reason: 'missing-on-disk',
      },
    ]);
    expect(plan.unchanged).toEqual(['gate.yaml']);
  });

  it('leaves a matching path out of the write list entirely, so its bytes cannot move', () => {
    const plan = planOf({
      target: [file('gate.yaml', 'aaa'), file('guidance.md', 'ccc')],
      current: [file('gate.yaml', 'aaa'), file('guidance.md', 'ccc')],
    });

    expect(plan.write).toEqual([]);
    expect(plan.unchanged).toEqual(['gate.yaml', 'guidance.md']);
    expect(restoreWritesNothing(plan)).toBe(true);
  });

  it('keeps a file the target version never recorded, and names it (owner ruling R57)', () => {
    const plan = planOf({
      target: [file('gate.yaml', 'aaa')],
      current: [file('gate.yaml', 'aaa'), file('notes.md', 'ddd')],
    });

    expect(plan.leftInPlace).toEqual(['notes.md']);
    // The assertion that makes R57 a property rather than a comment: nothing anywhere in the plan
    // proposes touching that path.
    expect(plan.write.map((entry) => entry.path)).not.toContain('notes.md');
    expect(JSON.stringify(plan.write)).not.toContain('notes.md');
  });

  it('partitions the union: write ∪ unchanged is exactly the target tree', () => {
    const target = [file('a.md', '1'), file('b.md', '2'), file('c.md', '3')];
    const plan = planOf({
      target,
      current: [file('b.md', '2'), file('c.md', 'different'), file('z.md', '9')],
    });

    expect([...plan.write.map((entry) => entry.path), ...plan.unchanged].sort()).toEqual([
      'a.md',
      'b.md',
      'c.md',
    ]);
    expect(plan.leftInPlace).toEqual(['z.md']);
  });

  it('is one value regardless of the order the trees arrive in', () => {
    const forward = planOf({
      target: [file('a.md', '1'), file('b.md', '2'), file('c.md', '3')],
      current: [file('b.md', '2'), file('z.md', '9'), file('y.md', '8')],
    });
    const reversed = planOf({
      target: [file('c.md', '3'), file('b.md', '2'), file('a.md', '1')],
      current: [file('y.md', '8'), file('z.md', '9'), file('b.md', '2')],
    });

    // Compared as ONE value, which is the property the preview/apply equality assertion rests on.
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });
});

describe('planRestore — refusals write nothing at all', () => {
  it.each([
    ['a parent-directory escape', '../escaped.yaml'],
    ['a deep escape', '../../../../etc/passwd'],
    ['a POSIX absolute path', '/etc/passwd'],
    ['an empty path', ''],
  ])('refuses %s by name, and returns no plan', (_label, tampered) => {
    const result = planRestore(
      planInput({
        target: [file('gate.yaml', 'aaa'), file(tampered, 'evil')],
        current: [file('gate.yaml', 'bbb')],
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // Named, per the guard's own convention — and the refusal must be about the tampered entry,
    // not a generic failure that would read the same for any input.
    expect(result.refusal).toContain(tampered === '' ? 'empty path' : tampered);
  });

  it('refuses a path that resolves to the resource root itself', () => {
    const result = planRestore(planInput({ target: [file('.', 'aaa')] }));
    expect(result.ok).toBe(false);
  });

  it('a refusal on ONE entry refuses the WHOLE restore', () => {
    const result = planRestore(
      planInput({
        target: [file('gate.yaml', 'aaa'), file('../escaped', 'evil'), file('guidance.md', 'ccc')],
        current: [],
      })
    );
    // The two innocent paths get no plan of their own: a partial restore is a state no version
    // ever held, announced as a rollback.
    expect(result.ok).toBe(false);
  });

  it('refuses to write into the bundled tree, whatever the recorded origin was', () => {
    const result = planRestore(
      planInput({
        destinationOrigin: 'bundled',
        target: [file('gate.yaml', 'aaa')],
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.refusal).toContain('bundled');
  });

  it('refuses a recorded tree with no files in it', () => {
    const result = planRestore(planInput({ target: [] }));
    expect(result.ok).toBe(false);
  });

  it('PLANS for an overlay destination — only `bundled` is refused', () => {
    // Positive control for the refusal above: the check must key on the bundled root specifically,
    // not merely on "the origin is not primary", or every overlay workspace loses rollback.
    const plan = planOf({ destinationOrigin: 'overlay', target: [file('gate.yaml', 'aaa')] });
    expect(plan.write).toHaveLength(1);
  });

  it('PLANS a bundled-ORIGIN version into a workspace root, and says so', () => {
    // The copy-on-write case `resource_manager rollback` already performs today: the bytes were
    // recorded from the package tree, and they land in the workspace as an override.
    const plan = planOf({ recordedOrigin: 'bundled', target: [file('gate.yaml', 'aaa')] });
    expect(plan.write).toHaveLength(1);
    expect(describeRestorePlan(plan)).toContain('workspace override');
  });
});

describe('describeRestorePlan', () => {
  it('names every written path and every left-in-place path', () => {
    const text = describeRestorePlan(
      planOf({
        target: [file('gate.yaml', 'aaa'), file('guidance.md', 'ccc')],
        current: [file('gate.yaml', 'bbb'), file('notes.md', 'ddd')],
      })
    );

    expect(text).toContain('gate.yaml');
    expect(text).toContain('guidance.md');
    expect(text).toContain('notes.md');
    expect(text).toContain('was missing');
    expect(text).toContain('never deletes a file');
  });

  it('says nothing was written when nothing differs', () => {
    const text = describeRestorePlan(
      planOf({ target: [file('gate.yaml', 'aaa')], current: [file('gate.yaml', 'aaa')] })
    );
    expect(text).toContain('No file differs');
    // Positive control that the left-in-place warning is conditional rather than always absent.
    expect(text).not.toContain('Left in place');
  });
});
