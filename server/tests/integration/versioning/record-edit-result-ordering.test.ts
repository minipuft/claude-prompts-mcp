// @lifecycle canonical - Pins the transaction phase order the object store depends on (R67).
/**
 * The version record runs with the produced files ALREADY ON DISK, and the object store depends
 * on it.
 *
 * `ResourceMutationTransaction.run()` is `captureSnapshots → mutate → validate → commit`, and every
 * processor passes its version record as `commit`. That ordering is what lets `recordTree` read the
 * bytes the edit produced. Nothing pinned it, and the service's own docblock asserted the opposite
 * ("Called BEFORE the file write") from P4.2 until row O.4 measured it — so a reader reasoning
 * about what is on disk when a row is written had a comment pointing the wrong way and no test
 * pointing the right one.
 *
 * The whole sequence is recorded and compared as ONE value rather than as pairwise "A before B"
 * assertions: pairwise constraints only cover the pairs someone thought of, and they degrade
 * silently when a phase moves between two of them.
 */

import { describe, it, expect } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ResourceVerificationResult } from '../../../src/modules/resources/services/resource-verification-service.js';

import { ResourceMutationTransaction } from '../../../src/modules/resources/services/resource-mutation-transaction.js';

/** The verifier's own result shape, so the transaction reads a real verdict rather than a stub. */
function verification(valid: boolean): ResourceVerificationResult {
  return {
    valid,
    resourceType: 'gates',
    resourceId: 'ordering-probe',
    filePath: 'gate.yaml',
    errors: valid ? [] : [{ code: 'invalid', path: 'id', message: 'nope' }],
    warnings: [],
  };
}

describe('ResourceMutationTransaction phase order', () => {
  it('runs commit last, after mutate and validate, with the produced bytes readable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cs-write-order-'));
    const file = path.join(root, 'resource', 'gate.yaml');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'id: before\n');

    const sequence: string[] = [];
    let seenAtCommit: string | undefined;

    const result = await new ResourceMutationTransaction().run({
      targets: [{ path: path.dirname(file), kind: 'directory' }],
      mutate: async () => {
        sequence.push('mutate');
        await writeFile(file, 'id: after\n');
      },
      validate: () => {
        sequence.push('validate');
        return verification(true);
      },
      commit: async () => {
        sequence.push('commit');
        // The property the object store rests on: the PRODUCED bytes, not the prior ones.
        seenAtCommit = await readFile(file, 'utf8');
      },
    });

    expect(result.success).toBe(true);
    expect(sequence).toEqual(['mutate', 'validate', 'commit']);
    expect(seenAtCommit).toBe('id: after\n');

    await rm(root, { recursive: true, force: true });
  });

  it('restores the files when commit throws, and never reaches commit when validate fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cs-write-order-'));
    const file = path.join(root, 'resource', 'gate.yaml');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'id: before\n');

    // A throw in `commit` — which is what a failed version record is — puts the files back. That
    // is the other half of the contract: the object store may fail loudly without leaving the
    // edit half-applied.
    const txn = new ResourceMutationTransaction();
    const failed = await txn.run({
      targets: [{ path: path.dirname(file), kind: 'directory' }],
      mutate: async () => {
        await writeFile(file, 'id: after\n');
      },
      commit: () => {
        throw new Error('version record failed');
      },
    });
    expect(failed.success).toBe(false);
    expect(failed.rolledBack).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('id: before\n');

    // Positive control on the OTHER direction: a failing `validate` returns before `commit` runs
    // at all, so a record never describes a state the transaction is about to roll back.
    let commitRan = false;
    const invalid = await txn.run({
      targets: [{ path: path.dirname(file), kind: 'directory' }],
      mutate: async () => {
        await writeFile(file, 'id: invalid\n');
      },
      validate: () => verification(false),
      commit: () => {
        commitRan = true;
      },
    });
    expect(invalid.success).toBe(false);
    expect(commitRan).toBe(false);
    expect(await readFile(file, 'utf8')).toBe('id: before\n');

    await rm(root, { recursive: true, force: true });
  });
});
