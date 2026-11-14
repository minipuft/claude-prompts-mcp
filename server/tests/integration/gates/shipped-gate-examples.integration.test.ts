// @lifecycle canonical - Every shipped gate that declares examples gives each its expected outcome.
/**
 * A gate that ships `examples:` claims its own check passes and fails the replies beside it. This
 * runs that claim for every gate in the bundled catalog: each gate directory is loaded by the real
 * `GateDefinitionLoader`, and each one declaring examples goes through `runGateExamples` with a
 * real executor and a real child process, the path `resource_manager` validate takes.
 *
 * The executor is given the allowlist an operator would write for the bundled catalog — `node`
 * running a script under the shipped gates directory, as a prefix entry — injected into this
 * test's own executor rather than written to the process environment. A shipped gate whose
 * command falls outside it is refused, and a refusal counts as a mismatch here, so a new
 * command-checked gate with examples has to be runnable this way or fail this test.
 *
 * Classification: Integration (real loader, bundled resources, real executor, real subprocess).
 */

import { describe, expect, test } from '@jest/globals';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';
import { runGateExamples } from '../../../src/engine/gates/services/gate-example-runner.js';
import { createShellVerifyExecutor } from '../../../src/engine/gates/shell/shell-verify-executor.js';

import type { LoadedGateDefinition } from '../../../src/engine/gates/core/gate-schema.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHIPPED_GATES = path.join(SERVER_ROOT, 'resources', 'gates');

/** Every bundled gate that declares at least one example, loaded as the server loads it. */
function shippedGatesWithExamples(): LoadedGateDefinition[] {
  const loader = new GateDefinitionLoader({ gatesDir: SHIPPED_GATES, enableCache: false });
  return readdirSync(SHIPPED_GATES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loader.loadGate(entry.name))
    .filter((gate): gate is LoadedGateDefinition => (gate?.examples ?? []).length > 0);
}

const gates = shippedGatesWithExamples();

describe('shipped gate examples', () => {
  test('the catalog has gates with examples to run (positive control for the walk)', () => {
    // An empty list would make every case below vacuous. `handoff-artifacts` is the shipped
    // command-checked gate that reads the reply; `test-suite` runs `npm test` and reads none, so
    // an example could not change its outcome and it ships none.
    expect(gates.map((gate) => gate.id)).toContain('handoff-artifacts');
  });

  test.each(gates.map((gate) => [gate.id, gate] as const))(
    '%s gives every example its expected outcome',
    async (_id, gate) => {
      const executor = createShellVerifyExecutor({
        gateSystemEnabled: () => true,
        allowlist: [`node ${SHIPPED_GATES}${path.sep}*`],
      });

      const report = await runGateExamples(gate, { executor });

      // The per-example rows first: on a failure they name the file and the exit status.
      expect(
        report.results.map((r) => ({ file: r.file, outcome: r.outcome, detail: r.detail }))
      ).toEqual(report.results.map((r) => ({ file: r.file, outcome: r.expect, detail: r.detail })));
      expect(report.executed).toBe(true);
      expect(report.mismatches).toBe(0);
      expect(report.results.some((r) => r.expect === 'pass')).toBe(true);
      expect(report.results.some((r) => r.expect === 'fail')).toBe(true);
    }
  );
});
