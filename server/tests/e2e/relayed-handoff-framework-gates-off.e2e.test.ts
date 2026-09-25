// @lifecycle test - Row P6.16: a relayed worker handoff is not graded for sections its prompt declined, over Streamable HTTP.
/**
 * `strategic_worker` declares `gateConfiguration.framework_gates: false`, so under the shipped
 * defaults (CAGEERF + the default gates) its delegated node declares no framework sections (R22):
 * a planner relaying the worker's handoff verbatim — no `## ` headers, a word the framework
 * forbids, a valid `HANDOFF RESULT` trailer — is captured, opens no structural review, and the
 * next node's brief renders.
 *
 * MEASURED on `fdbbeaac` (2026-09-24): the same relay opened "Structural Review Required" on the
 * delegated node, graded against CAGEERF's sections and its forbidden terms.
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
  type StreamNotification,
} from './helpers/http-mcp-client.js';

const STEP_COMPLETE = 'notifications/chain/step_complete';

interface ToolOutcome {
  text: string;
  isError: boolean;
  methods: string[];
}

function tokenOf(brief: string): string {
  const match = /^node:\s*(\S+)\s*$/m.exec(brief);
  if (match?.[1] === undefined) throw new Error(`no node token in: ${brief.slice(0, 400)}`);
  return match[1];
}

describe('Streamable HTTP: a relayed strategic_worker handoff (shipped defaults, P6.16)', () => {
  let teardown: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of teardown.reverse()) await fn();
    teardown = [];
  });

  test('is captured with no structural review and the next brief renders', async () => {
    const roots = createHermeticRoots('relayed-handoff-e2e');
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      env: { HOME: roots.home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: roots.runtimeRoot },
    });
    teardown.push(() => killServer(proc), roots.cleanup);
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    const client = new ModernMcpClient(baseUrl, 'relayed-handoff-e2e');
    let nextId = 1;
    const call = async (args: Record<string, unknown>): Promise<ToolOutcome> => {
      const outcome = await client.callToolWithNotifications('prompt_engine', args, nextId++);
      const result = outcome.result as
        { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
      return {
        text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        isError: result?.isError === true,
        methods: outcome.notifications.map((n: StreamNotification) => n.method),
      };
    };

    const start = await call({
      command:
        '>>strategic_worker task:"row one" ==> >>strategic_worker task:"row two" ==> >>strategic_worker task:"row three"',
    });
    const chainId = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(start.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${start.text.slice(0, 400)}`);
    const resume = (args: Record<string, unknown>) => call({ chain_id: chainId, ...args });

    // Step 1 is the parent's own; answering it renders step 2's brief, which declares nothing.
    const brief = await resume({ user_response: 'Row one done.' });
    expect(brief.isError).toBe(false);
    expect(brief.text).toContain('EXECUTION BRIEF');
    expect(brief.text).not.toContain('Required Sections');
    const token = tokenOf(brief.text);

    // The planner relays the worker's handoff verbatim: no headers, and a word CAGEERF forbids.
    const relayed = await resume({
      user_response: `done: the row is in; the placeholder identifier kept its name.\n\nHANDOFF RESULT\nnode: ${token}`,
    });
    expect(relayed.isError).toBe(false);
    expect(relayed.methods).toContain(STEP_COMPLETE); // positive control: the stream is read
    expect(relayed.text).not.toContain('Review Required');
    expect(relayed.text).toContain('**Row**: row three');
    expect(relayed.text).toContain('→ Progress 3/3');
  }, 180000);
});
