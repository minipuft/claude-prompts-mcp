// @lifecycle canonical - `resource_manager` validate on a gate runs its examples, one line each.
/**
 * `GateToolHandler` dispatches `validate` to `GateLifecycleProcessor.handleValidate`, which runs
 * the examples beside a gate through `runGateExamples` with the handler's executor and appends an
 * `Examples (<n>)` section to the reply, carrying the report in `structuredContent.examples`.
 *
 * The fixture gate ships a `check.js` that passes a reply containing `## Summary` and fails any
 * other. Gates load through the real `GateDefinitionLoader`, so each has the source path the
 * runner resolves its example files and script against.
 *
 * Classification: Unit (real loader, real executor, real child process; registry stubbed).
 */

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GateDefinitionLoader } from '../../../../src/engine/gates/core/gate-definition-loader.js';
import { GATE_EXAMPLES_MODEL_JUDGED_REASON } from '../../../../src/engine/gates/services/gate-example-runner.js';
import { GenericGateGuide } from '../../../../src/engine/gates/registry/generic-gate-guide.js';
import { SHELL_VERIFY_ALLOWLIST_ENV } from '../../../../src/engine/gates/shell/shell-command-allowlist.js';
import { createShellVerifyExecutor } from '../../../../src/engine/gates/shell/shell-verify-executor.js';
import { GateToolHandler } from '../../../../src/mcp/tools/gate-manager/core/manager.js';
import { EMPTY_QUARANTINE_VIEW } from '../../../../src/shared/utils/resource-quarantine.js';

import type { GateExampleReport } from '../../../../src/engine/gates/services/gate-example-runner.js';
import type { GateManager } from '../../../../src/engine/gates/gate-manager.js';
import type { ShellVerifyExecutor } from '../../../../src/engine/gates/shell/shell-verify-executor.js';
import type { ConfigManager, Logger, ToolResponse } from '../../../../src/shared/types/index.js';

const CHECK_SCRIPT = [
  "let input = '';",
  "process.stdin.on('data', (chunk) => (input += chunk));",
  "process.stdin.on('end', () => process.exit(input.includes('## Summary') ? 0 : 1));",
  '',
].join('\n');

const EXAMPLE_FILES = {
  'examples/pass.md': '## Summary\nThe change is done.\n',
  'examples/fail.md': 'The change is done.\n',
};

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

describe('resource_manager gate validate runs the gate examples', () => {
  let root: string;
  let loader: GateDefinitionLoader;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gate-validate-examples-'));
    loader = new GateDefinitionLoader({ gatesDir: root, enableCache: false });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeGate(id: string, criteria: readonly string[], examples: readonly string[]): void {
    const dir = join(root, id);
    mkdirSync(join(dir, 'examples'), { recursive: true });
    writeFileSync(
      join(dir, 'gate.yaml'),
      [
        `id: ${id}`,
        'name: Example probe',
        'type: validation',
        'description: probe',
        ...criteria,
        ...examples,
        '',
      ].join('\n')
    );
    writeFileSync(join(dir, 'check.js'), CHECK_SCRIPT);
    for (const [relative, content] of Object.entries(EXAMPLE_FILES)) {
      writeFileSync(join(dir, relative), content);
    }
  }

  const COMMAND_CRITERIA = [
    'pass_criteria:',
    '  - type: shell_verify',
    '    shell_command: [node, check.js]',
    '    shell_stdin_source: agent_response',
  ];

  function examplesBlock(passExpect: string, failExpect: string): string[] {
    return [
      'examples:',
      '  - file: examples/pass.md',
      `    expect: ${passExpect}`,
      '  - file: examples/fail.md',
      `    expect: ${failExpect}`,
    ];
  }

  /** The command as the executor sees it: the shipped script resolved into the gate directory. */
  function allowing(id: string): ShellVerifyExecutor {
    return createShellVerifyExecutor({
      gateSystemEnabled: () => true,
      allowlist: [`node ${join(root, id, 'check.js')}`],
    });
  }

  async function validate(
    id: string,
    executor: ShellVerifyExecutor,
    requestedId = id
  ): Promise<ToolResponse> {
    const loaded = loader.loadGate(id);
    if (loaded === undefined) throw new Error(`fixture gate '${id}' did not load`);
    const guide = new GenericGateGuide(loaded);
    const handler = new GateToolHandler({
      logger: silentLogger,
      gateManager: {
        get: (gateId: string) => (gateId === id ? guide : undefined),
        getQuarantine: () => EMPTY_QUARANTINE_VIEW,
      } as unknown as GateManager,
      configManager: {
        getGatesDirectory: () => root,
        getBundledResourceDirectory: () => undefined,
        getVersioningConfig: () => ({ mode: 'off', maxVersions: 50 }),
      } as unknown as ConfigManager,
      shellVerifyExecutor: executor,
    });
    return handler.handleAction({ action: 'validate', id: requestedId }, {});
  }

  const textOf = (response: ToolResponse): string =>
    response.content.map((part) => part.text).join('\n');

  const examplesOf = (response: ToolResponse): GateExampleReport =>
    (response.structuredContent as { examples: GateExampleReport }).examples;

  test('(a) a pass and a fail example each get their own line, with no mismatch', async () => {
    writeGate('summary-check', COMMAND_CRITERIA, examplesBlock('pass', 'fail'));

    const response = await validate('summary-check', allowing('summary-check'));

    expect(response.isError).toBe(false);
    const text = textOf(response);
    expect(text).toContain('Examples (2)\n');
    expect(text).toContain('✓ examples/pass.md — expected pass, got pass');
    expect(text).toContain('✓ examples/fail.md — expected fail, got fail');
    expect(text).not.toContain('(mismatch)');
    expect(examplesOf(response)).toMatchObject({ executed: true, mismatches: 0 });
    expect(response.structuredContent).toMatchObject({ action: 'validate', valid: true });
  });

  test('(b) swapped expectations give two mismatch lines and an error reply', async () => {
    writeGate('summary-check', COMMAND_CRITERIA, examplesBlock('fail', 'pass'));

    const response = await validate('summary-check', allowing('summary-check'));

    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toContain('✗ examples/pass.md — expected fail, got pass (mismatch)');
    expect(text).toContain('✗ examples/fail.md — expected pass, got fail (mismatch)');
    expect(text.match(/\(mismatch\)/g)).toHaveLength(2);
    expect(examplesOf(response).mismatches).toBe(2);
    expect(response.structuredContent).toMatchObject({ valid: false });
  });

  test('(c) a gate judged by the client model lists its examples as not executed', async () => {
    writeGate(
      'model-judged',
      ['pass_criteria:', '  - type: inline_guidance'],
      examplesBlock('pass', 'fail')
    );

    const response = await validate('model-judged', allowing('model-judged'));

    expect(response.isError).toBe(false);
    const text = textOf(response);
    expect(text).toContain(`Examples (2) — executed: no (${GATE_EXAMPLES_MODEL_JUDGED_REASON})`);
    expect(text).toContain(
      `· examples/pass.md — expected pass, not executed: ${GATE_EXAMPLES_MODEL_JUDGED_REASON}`
    );
    expect(text).toContain('· examples/fail.md — expected fail, not executed:');
    expect(text).not.toMatch(/^[✓✗⛔] /m);
    expect(examplesOf(response)).toMatchObject({ executed: false, mismatches: 0 });
  });

  test('(d) with no allowlist every example is refused and none is reported as passing', async () => {
    writeGate('summary-check', COMMAND_CRITERIA, examplesBlock('pass', 'fail'));
    // An empty list is what an unset `MCP_SHELL_VERIFY_ALLOWLIST` resolves to.
    const unset = createShellVerifyExecutor({ gateSystemEnabled: () => true, allowlist: [] });

    const response = await validate('summary-check', unset);

    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toMatch(/^Examples \(2\) — executed: no \(/m);
    expect(text).toMatch(/^⛔ examples\/pass\.md — expected pass, refused: /m);
    expect(text).toMatch(/^⛔ examples\/fail\.md — expected fail, refused: /m);
    expect(text).toContain(SHELL_VERIFY_ALLOWLIST_ENV);
    expect(text).not.toContain('✓');
    // One line per example: a multi-line refusal is collapsed onto its example's line.
    const section = text.slice(text.indexOf('Examples (2)'));
    expect(section.split('\n')).toHaveLength(3);
  });

  test('(e) a gate without examples adds no section', async () => {
    writeGate('summary-check', COMMAND_CRITERIA, []);

    const response = await validate('summary-check', allowing('summary-check'));

    expect(response.isError).toBe(false);
    expect(textOf(response)).not.toContain('Examples (');
    expect(response.structuredContent).not.toHaveProperty('examples');
    expect(response.structuredContent).toMatchObject({ action: 'validate', valid: true });
  });

  test('an id the registry does not hold is refused by name', async () => {
    writeGate('summary-check', COMMAND_CRITERIA, examplesBlock('pass', 'fail'));

    const response = await validate('summary-check', allowing('summary-check'), 'no-such-gate');

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain("Gate 'no-such-gate' not found");
  });
});
