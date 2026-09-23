// @lifecycle test - P4.116 / P4.119: a gate review's record and reply state one truth, driven live.
/**
 * Two rows, driven against a real spawned server under shipped defaults (CAGEERF, the bundled
 * gates, the packaged config), reading only what a client can read plus the run's own row.
 *
 * P4.119 / R96 — the phase guard grades the final step's answer AFTER the capture has walked the
 * run past its last node, so the store had already latched `completed` when the guard opened a
 * review. MEASURED before the fix on `acaf76c6`: that reply carried `✓ Chain complete (3/3)` AND
 * `Next: …, gate_verdict=…`, and the next call — the verdict it asked for — was answered
 * "✓ Chain run already complete." The verdict could never land.
 *
 * P4.116 — a FAIL verdict that arrives with the step's answer while no review is open was
 * recorded twice in one call: MEASURED before the fix, one such call left `attemptCount: 2` of 2
 * and the reply already reported the retry budget spent. Under the bundled gates a review is
 * opened up front at every step, so the no-review path is reached on a run with no gates
 * (`%clean`), which is where it lives.
 */

import { afterEach, describe, expect, test } from '@jest/globals';

import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

interface Session {
  call(args: Record<string, unknown>): Promise<string>;
  attemptCount(): number | undefined;
  stop(): Promise<void>;
}

/** Sections present but short: the phase guard fails them on every step. */
const shortSections = (step: number): string =>
  `## Context\nstep ${step}\n## Analysis\nx\n## Goals\ny\n## Execution\nz`;

function chainIdOf(text: string): string {
  const match = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`no chain id in response: ${text.slice(0, 400)}`);
  }
  return match[1];
}

describe('Streamable HTTP: a gate review states one state', () => {
  let cleanup: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    cleanup = [];
  });

  const startSession = async (): Promise<Session> => {
    const roots = createHermeticRoots('gate-review-truth-e2e');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, { env: roots.env });
    cleanup.push(() => killServer(proc), roots.cleanup);
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    const client = new ModernMcpClient(baseUrl, 'gate-review-truth-e2e');
    let nextId = 1;

    return {
      call: async (args) => {
        const outcome = await client.callToolWithNotifications('prompt_engine', args, nextId++);
        const result = outcome.result as { content?: Array<{ text?: string }> } | undefined;
        return (result?.content ?? []).map((part) => part.text ?? '').join('\n');
      },
      attemptCount: () => {
        const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'));
        try {
          const row = db.prepare('SELECT state FROM chain_runs').get() as { state: string };
          // The residual persists every review in `reviews`, keyed by node; this run has one.
          const state = JSON.parse(row.state) as {
            reviews?: Record<string, { kind?: string; attemptCount?: number }>;
          };
          return Object.values(state.reviews ?? {}).find((review) => review.kind !== 'detached')
            ?.attemptCount;
        } finally {
          db.close();
        }
      },
      stop: () => killServer(proc),
    };
  };

  test('P4.119: the final step awaits its verdict, the verdict lands, and only then is it complete', async () => {
    const session = await startSession();
    const chainId = chainIdOf(await session.call({ command: '>>quick_decision topic:"latch"' }));

    const replies: string[] = [];
    for (const step of [1, 2, 3]) {
      replies.push(
        await session.call({
          chain_id: chainId,
          user_response: shortSections(step),
          gate_verdict: 'GATE_REVIEW: PASS - reviewed',
        })
      );
    }
    const [, midRun, finalReply] = replies as [string, string, string];

    // CONTROL: a mid-run reply keeps the line inviting the next step.
    expect(midRun).toContain('Next: chain_id=');

    // The final step's answer failed its section check: the run waits for the verdict.
    expect(finalReply).toContain('Improvements Needed');
    expect(finalReply).toContain('→ Final step 3/3 — awaiting gate verdict');
    expect(finalReply).not.toContain('Chain complete');
    expect(finalReply).not.toContain('Next:');

    // The verdict it waits for is accepted — not refused as a resume of a finished run.
    const landed = await session.call({
      chain_id: chainId,
      gate_verdict: 'GATE_REVIEW: PASS - sections expanded',
    });
    expect(landed).not.toContain('already complete');
    expect(landed).toContain('✓ Chain complete (3/3)');
    expect(landed).not.toContain('Next:');

    // And only now is the run finished.
    const after = await session.call({ chain_id: chainId, gate_verdict: 'GATE_REVIEW: PASS - x' });
    expect(after).toContain('Chain run already complete');
  }, 180000);

  test('P4.116: one call carrying the answer and a FAIL spends one attempt', async () => {
    const session = await startSession();
    const chainId = chainIdOf(await session.call({ command: '%clean >>quick_decision topic:"b"' }));
    expect(session.attemptCount()).toBeUndefined();

    const reply = await session.call({
      chain_id: chainId,
      user_response: 'step one output',
      gate_verdict: 'GATE_REVIEW: FAIL - misses a constraint',
    });

    expect(session.attemptCount()).toBe(1);
    expect(reply).not.toContain('failed after 2 attempts');
  }, 180000);

  test('P4.116 CONTROL: the same FAIL on two calls spends two attempts', async () => {
    const session = await startSession();
    const chainId = chainIdOf(await session.call({ command: '%clean >>quick_decision topic:"b"' }));

    await session.call({
      chain_id: chainId,
      gate_verdict: 'GATE_REVIEW: FAIL - misses a constraint',
    });
    expect(session.attemptCount()).toBe(1);

    const reply = await session.call({
      chain_id: chainId,
      user_response: 'step one output',
      gate_verdict: 'GATE_REVIEW: FAIL - still misses it',
    });
    expect(session.attemptCount()).toBe(2);
    expect(reply).toContain('failed after 2 attempts');
  }, 180000);
});
