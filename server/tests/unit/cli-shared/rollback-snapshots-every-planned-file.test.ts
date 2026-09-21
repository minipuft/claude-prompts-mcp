// @lifecycle canonical - Gate: a cpm byte restore snapshots every file it writes, not just the entry.
/**
 * `cpm rollback`'s transaction must snapshot the files the PLAN writes, not the caller's entry
 * file alone.
 *
 * WHY THIS IS A GATE AND NOT ONLY A BEHAVIOURAL TEST. It was found by a mutation that came back
 * GREEN: replacing `restoreTargets(available.plan)` with `restore.targets` — which is the entry
 * file, one path — left every test passing. The behavioural half of it now lives in
 * `tests/integration/versioning/byte-exact-restore.test.ts` ("restores every written file
 * byte-identical when the record throws", two files), but that case exercises `applyByteRestore`,
 * which is the SERVER's transaction. Nothing drove the CLI's own choice, and driving it needs a
 * `cpm` run whose version record fails after the files are written — a state this repository's
 * writers do not produce on demand.
 *
 * So the argument is constrained where it is passed. The failure it prevents is silent and
 * expensive: a `cpm rollback` whose record fails would restore the entry file to its pre-rollback
 * bytes and leave every companion file holding the RESTORED content, under a reply saying the
 * rollback failed — a state neither version ever held.
 *
 * It constrains the VALUE, not the presence of a name: `toMatch(/targets/)` would pass against
 * `targets: restore.targets`, which is the mutant. The whole property assignment is extracted and
 * compared.
 */

import { describe, it, expect } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../src/cli-shared/version-history.ts'
);

/**
 * The single `targets:` assignment inside `recordCheckpointedWrite`'s options, whitespace
 * collapsed.
 *
 * Read from the source rather than from the module, because the value is an expression evaluated
 * per call and there is no seam that reports which branch it took without running the failure this
 * gate exists to prevent.
 */
async function targetsAssignment(): Promise<string> {
  const source = await readFile(SOURCE, 'utf8');
  const marker = 'recordCheckpointedWrite(db, tenantId, request, {';
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const body = source.slice(start);
  const match = /\n\s*targets:\s*([\s\S]*?),\n\s*priorSnapshot:/.exec(body);
  expect(match?.[1]).toBeDefined();
  return (match?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

describe('cpm rollback snapshots every file its plan writes', () => {
  it("passes the plan's own paths on the byte path, and the caller's only otherwise", async () => {
    expect(await targetsAssignment()).toBe(
      "available.status === 'ready' ? restoreTargets(available.plan) : restore.targets"
    );
  });

  it('is a check the mutant would fail — control', async () => {
    // The positive control this gate needs: the assertion above must distinguish the fixed value
    // from the mutant, not merely match anything containing the word `targets`. Both strings do.
    const mutant = 'restore.targets';
    expect(await targetsAssignment()).not.toBe(mutant);
    expect(mutant).toMatch(/targets/);
  });
});
