// @lifecycle test - A shell check an operator control refused is recorded as that refusal, not as an exit code.
import { describe, expect, jest, test } from '@jest/globals';

import { runGateReviewEvidence } from '../../../../src/engine/gates/services/gate-review-evidence.js';
import { ShellVerifyExecutor } from '../../../../src/engine/gates/shell/shell-verify-executor.js';

import type { GateDefinitionProvider } from '../../../../src/engine/gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../../src/engine/gates/types.js';

const GATE: LightweightGateDefinition = {
  id: 'check-gate',
  name: 'Check',
  type: 'validation',
  description: 'Public fixture',
  enforcementMode: 'blocking',
  pass_criteria: [{ type: 'shell_verify', shell_command: ['false'] }],
};

const provider = {
  loadGate: jest.fn(async (id: string) => (id === GATE.id ? GATE : null)),
  loadGates: jest.fn(async (ids: string[]) => (ids.includes(GATE.id) ? [GATE] : [])),
} as unknown as GateDefinitionProvider;

async function evidenceWith(allowlist: readonly string[]) {
  const executor = new ShellVerifyExecutor({ gateSystemEnabled: () => true, allowlist });
  return runGateReviewEvidence([GATE.id], provider, 'output', { shellVerifyExecutor: executor });
}

describe('recorded check summary of a refused shell command', () => {
  test('an empty allowlist records the refusal, naming the control, not an exit code', async () => {
    const evidence = await evidenceWith([]);
    expect(evidence.shellResults).toEqual([
      expect.objectContaining({ gateId: GATE.id, passed: false, refused: true, exitCode: -1 }),
    ]);
    expect(evidence.checkResults).toEqual([
      {
        gateId: GATE.id,
        passed: false,
        summary: expect.stringContaining('MCP_SHELL_VERIFY_ALLOWLIST'),
      },
    ]);
    expect(evidence.checkResults[0]?.summary).toMatch(/^false: Shell verification refused/);
    expect(evidence.checkResults[0]?.summary).not.toContain('exit -1');
  });

  test('positive control: an allowed command that ran records its exit code', async () => {
    const evidence = await evidenceWith(['false']);
    expect(evidence.shellResults[0]?.refused).toBeUndefined();
    expect(evidence.checkResults).toEqual([
      { gateId: GATE.id, passed: false, summary: 'false exit 1' },
    ]);
  });
});
