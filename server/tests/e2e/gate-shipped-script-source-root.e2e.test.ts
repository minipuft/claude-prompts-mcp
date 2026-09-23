// @lifecycle test - P4.140: a workspace gate's shipped shell_verify script runs from the gate's directory on the live path.
/**
 * A `shell_verify` criterion may name a script that ships beside `gate.yaml` (`sh check.sh`). The
 * runner resolves such an argument against `{sourceRoot}/{id}`, so the definition the pipeline
 * reads must carry `sourceRoot`. The live server reads gates through `GateManagerProvider`, not
 * `GateLoader`; before the converters became one function the provider dropped `sourceRoot`, and
 * the script resolved against the server's working directory (`server/`), where it does not exist.
 *
 * Live case: a real spawned server over a hermetic workspace. Step A of a chain carries the gate;
 * answering it renders the gate review, and stage 20 runs the check and prints the command it ran.
 * MEASURED on `1161853f` before the fix: `sh check.sh`, exit 2, "cannot open check.sh".
 * Twin: the same gate directory loaded through `GateLoader` and run through the same runner
 * in-process — the path that always carried `sourceRoot`.
 *
 * Classification: E2E (live case) + integration twin. Real executor, real shell, no mocks.
 */

import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { GateLoader } from '../../src/engine/gates/core/gate-loader.js';
import { runGateShellVerifications } from '../../src/engine/gates/services/gate-shell-verify-runner.js';
import { createShellVerifyExecutor } from '../../src/engine/gates/shell/shell-verify-executor.js';
import { createHermeticRoots } from './helpers/child-env.js';
import { cageerfAnswer } from './helpers/cageerf-answer.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const GATE_ID = 'shipped-script';
/** Only the shipped script prints this; the in-process twin reads it from the result's stdout. */
const SCRIPT_MARKER = 'SHIPPED-SCRIPT-RAN';
const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };

/** Write `<workspace>/resources/gates/<id>/{gate.yaml,check.sh}` and return the gates root. */
function writeWorkspaceGate(workspace: string): string {
  const gatesRoot = path.join(workspace, 'resources', 'gates');
  const gateDir = path.join(gatesRoot, GATE_ID);
  mkdirSync(gateDir, { recursive: true });
  writeFileSync(
    path.join(gateDir, 'gate.yaml'),
    [
      `id: ${GATE_ID}`,
      'name: Shipped Script',
      'type: validation',
      'description: runs a script that ships beside gate.yaml',
      'pass_criteria:',
      '  - type: shell_verify',
      '    shell_command: [sh, check.sh]',
      '',
    ].join('\n'),
    'utf8'
  );
  writeFileSync(path.join(gateDir, 'check.sh'), `echo ${SCRIPT_MARKER}\n`, 'utf8');
  return gatesRoot;
}

describe('a gate-shipped shell_verify script resolves from the gate directory (P4.140)', () => {
  let cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    cleanup = [];
  });

  test('live provider path: the review shows the shipped script ran', async () => {
    const roots = createHermeticRoots('gate-shipped-script-e2e');
    const workspace = path.join(roots.root, 'workspace');
    const script = path.join(writeWorkspaceGate(workspace), GATE_ID, 'check.sh');

    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      env: {
        HOME: roots.home,
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: roots.runtimeRoot,
        MCP_SHELL_VERIFY_ALLOWLIST: 'sh *',
      },
    });
    cleanup.push(() => killServer(proc), roots.cleanup);
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });

    const client = new ModernMcpClient(baseUrl, 'gate-shipped-script-e2e');
    let nextId = 1;
    const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const outcome = await client.callToolWithNotifications(name, args, nextId++);
      const result = outcome.result as { content?: Array<{ text?: string }> } | undefined;
      return (result?.content ?? []).map((part) => part.text ?? '').join('\n');
    };

    for (const [id, template, extra] of [
      ['sv_step', 'SV-STEP-BODY', {}],
      [
        'sv_chain',
        'chain',
        { chain_steps: [{ promptId: 'sv_step', stepName: 'A', inlineGateIds: [GATE_ID] }] },
      ],
    ] as const) {
      await call('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id,
        category: 'general',
        name: id,
        description: `e2e ${id}`,
        user_message_template: template,
        gate_configuration: OPT_OUT,
        ...extra,
      });
    }

    const start = await call('prompt_engine', { command: '>>sv_chain' });
    const chainId = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(start)?.[1];
    expect(chainId).toBeDefined();
    const review = await call('prompt_engine', {
      chain_id: chainId,
      user_response: cageerfAnswer('step A output'),
    });

    // Positive control: the check ran at all, so a wrong path below is a resolution failure and
    // not a review that never happened. A passing check prints its command, not its stdout.
    expect(review).toContain('## Shell Verification Results');
    expect(review).toContain(`**Command:** \`sh ${script}\``);
    expect(review).toContain('### Shipped Script — PASSED');
  }, 120000);

  test('twin: the same gate through GateLoader resolves the same script', async () => {
    const roots = createHermeticRoots('gate-shipped-script-twin');
    cleanup.push(roots.cleanup);
    const gatesRoot = writeWorkspaceGate(path.join(roots.root, 'workspace'));
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const results = await runGateShellVerifications(
      [GATE_ID],
      new GateLoader(logger as never, gatesRoot),
      undefined,
      createShellVerifyExecutor({ allowlist: ['sh *'] })
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.stdout).toContain(SCRIPT_MARKER);
    expect(results[0]?.passed).toBe(true);
  }, 30000);
});
