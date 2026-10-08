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
 * and the reply already reported the retry budget spent. Under the bundled gates a chain step's
 * review is opened up front, so the no-review path is reached where no review opens at render: a
 * single prompt, whose FAIL opens its review on the verdict. These pins lived on a `%clean` run
 * until P6.76 (R38): a FAIL on a step with no gates now opens no review and is refused by name
 * (MEASURED 2026-09-25: `%clean >>quick_decision` + answer + FAIL → "Step 1 carries no gates"),
 * so they moved to `>>review` with the shipped blocking `pr-security` gate, where the same call
 * shapes measured 1/2 and then 2/2 exhausted.
 */

import { afterEach, describe, expect, test } from '@jest/globals';

import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ExecutionRecordStore } from '../../src/modules/chains/execution-record-store.js';

import type { DatabasePort } from '../../src/shared/types/persistence.js';
import type { Logger } from '../../src/infra/logging/index.js';
import type { GateReview, GateVerdictSummary } from '../../src/shared/types/chain-execution.js';

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
  control(args: Record<string, unknown>): Promise<string>;
  seedReaderRecords(records: Array<{ nodeId: string; summaries: GateVerdictSummary[] }>): void;
  review(): GateReview | undefined;
  receipts(): Array<{
    nodeId: string;
    gateVerdicts: GateVerdictSummary[];
    startedAt: number;
    status: string;
  }>;
  stop(): Promise<void>;
}

/** Sections present but short: the phase guard fails them on every step. */
const shortSections = (step: number): string =>
  `## Context\nstep ${step}\n## Analysis\nx\n## Goals\ny\n## Execution\nz`;

/** Every required CAGEERF section at its minimum length or more: the phase guard passes it. */
const fullSections = (step: number): string =>
  ['Context', 'Analysis', 'Goals', 'Execution']
    .map(
      (name) =>
        `## ${name}\nStep ${step} ${name.toLowerCase()}: ${'a complete sentence. '.repeat(6)}`
    )
    .join('\n');

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
    const proc = startServerWithHttp(port, { env: roots.env, source: true });
    cleanup.push(roots.cleanup, () => killServer(proc));
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    const client = new ModernMcpClient(baseUrl, 'gate-review-truth-e2e');
    let nextId = 1;

    return {
      call: async (args) => {
        const outcome = await client.callToolWithNotifications('prompt_engine', args, nextId++);
        const result = outcome.result as { content?: Array<{ text?: string }> } | undefined;
        return (result?.content ?? []).map((part) => part.text ?? '').join('\n');
      },
      control: async (args) => {
        const outcome = await client.callToolWithNotifications('system_control', args, nextId++);
        const result = outcome.result as { content?: Array<{ text?: string }> } | undefined;
        return (result?.content ?? []).map((part) => part.text ?? '').join('\n');
      },
      // Controlled reader artifacts only: no claim that these model facts came from live SDK adjudication.
      seedReaderRecords: (records) => {
        const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'));
        try {
          const row = db.prepare('SELECT tenant_id FROM execution_records LIMIT 1').get() as {
            tenant_id: string;
          };
          const port = {
            run: (sql: string, params: readonly (string | number | null)[]) =>
              db.prepare(sql).run(...params),
          } as unknown as DatabasePort;
          const logger: Logger = {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          };
          const writer = new ExecutionRecordStore(port, logger);
          for (const record of records)
            writer.append({
              sessionId: 'seeded-reader-session',
              chainId: 'seeded-reader-chain',
              nodeId: record.nodeId,
              stepNumber: record.nodeId === 'mixed-node' ? 1 : 2,
              status: 'completed',
              startedAt: Date.now(),
              completedAt: Date.now(),
              gateVerdicts: record.summaries,
              scope: { continuityScopeId: row.tenant_id },
            });
        } finally {
          db.close();
        }
      },
      review: () => {
        const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'), {
          readOnly: true,
        });
        try {
          const row = db.prepare('SELECT state FROM chain_runs').get() as { state: string };
          // The residual persists every review in `reviews`, keyed by node; this run has one.
          const state = JSON.parse(row.state) as {
            reviews?: Record<string, GateReview>;
          };
          return Object.values(state.reviews ?? {}).find((review) => review.kind !== 'detached');
        } finally {
          db.close();
        }
      },
      receipts: () => {
        const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'), {
          readOnly: true,
        });
        try {
          const rows = db
            .prepare(
              'SELECT node_id, gate_verdicts_json, started_at, status FROM execution_records ORDER BY execution_id'
            )
            .all() as Array<{
            node_id: string;
            gate_verdicts_json: string;
            started_at: number;
            status: string;
          }>;
          return rows.map((row) => ({
            nodeId: row.node_id,
            startedAt: row.started_at,
            status: row.status,
            gateVerdicts: JSON.parse(row.gate_verdicts_json) as GateVerdictSummary[],
          }));
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

    // Only the final answer is short. Every answer sent with a verdict is graded (row 3.15), so a
    // short mid-run answer opens its own review, and the mid-run control below would then read a
    // review instead of the line it pins.
    const replies: string[] = [];
    for (const step of [1, 2, 3]) {
      replies.push(
        await session.call({
          chain_id: chainId,
          user_response: step === 3 ? shortSections(step) : fullSections(step),
          gate_verdict: 'GATE_REVIEW: PASS - reviewed',
        })
      );
    }
    const [, midRun, finalReply] = replies as [string, string, string];

    // CONTROL: a mid-run reply keeps the line inviting the next step.
    expect(midRun).not.toContain('Improvements Needed');
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

  /** A single prompt with a blocking gate: no review opens at render, the FAIL opens it. */
  const gatedSinglePrompt = { command: '>>review target:"src/index.ts"', gates: ['pr-security'] };

  test('P4.116: one call carrying the answer and a FAIL spends one attempt', async () => {
    const session = await startSession();
    const chainId = chainIdOf(await session.call(gatedSinglePrompt));
    expect(session.review()).toBeUndefined();

    const reply = await session.call({
      chain_id: chainId,
      user_response: 'review output',
      gate_verdict: 'GATE_REVIEW: FAIL - misses a constraint',
    });

    expect(session.review()?.attemptCount).toBe(1);
    expect(session.review()?.gateTiers?.['pr-security']).toBe('reminder');
    expect(reply).toContain('"reminders"');
    expect(reply).not.toContain('"per_gate"');
    expect(reply).not.toContain('Retry Limit Reached');
  }, 180000);

  test('P4.116 CONTROL: the same FAIL on two calls spends two attempts', async () => {
    const session = await startSession();
    const chainId = chainIdOf(await session.call(gatedSinglePrompt));

    await session.call({
      chain_id: chainId,
      gate_verdict: 'GATE_REVIEW: FAIL - misses a constraint',
    });
    expect(session.review()?.attemptCount).toBe(1);

    const reply = await session.call({
      chain_id: chainId,
      user_response: 'review output',
      gate_verdict: 'GATE_REVIEW: FAIL - still misses it',
    });
    expect(session.review()?.attemptCount).toBe(2);
    expect(reply).toContain('Retry Limit Reached');
  }, 180000);
  test('authorized skip appends server BYPASS after genuine FAILs without accepting client BYPASS', async () => {
    const session = await startSession();
    const chainId = chainIdOf(await session.call(gatedSinglePrompt));
    await session.call({
      chain_id: chainId,
      user_response: 'review output',
      gate_verdict: 'GATE_REVIEW: FAIL - first failure',
    });
    const held = session.review();
    expect(held?.attemptCount).toBe(1);
    await session.call({
      chain_id: chainId,
      gate_verdict: {
        overall: 'FAIL',
        rationale: 'second failure',
        per_gate: held!.gateIds.map((_gate, index) => ({
          index: index + 1,
          passed: false,
          rationale: 'second failure',
        })),
      },
    });
    const exhausted = session.review();
    expect(exhausted?.phase).toBe('exhausted');
    const before = session.receipts();
    const refused = await session.call({
      chain_id: chainId,
      gate_verdict: { overall: 'BYPASS', rationale: 'client cannot mint bypass' },
    });
    expect(refused).toContain('Input validation error');
    expect(refused).toContain('"PASS"|"FAIL"');
    expect(session.review()?.attemptCount).toBe(exhausted?.attemptCount);
    expect(session.receipts()).toEqual(before);
    await session.call({ chain_id: chainId, gate_action: 'skip' });
    const receipt = session
      .receipts()
      .flatMap((row) => row.gateVerdicts)
      .filter((entry) => entry.verdict === 'BYPASS');
    expect(receipt.map((entry) => entry.gateId)).toEqual(exhausted!.gateIds);
    expect(receipt.map((entry) => entry.gateId)).toContain('pr-security');
    for (const entry of receipt) {
      expect(entry).toMatchObject({
        verdict: 'BYPASS',
        source: 'gate_action',
        disposition: 'bypassed',
        attempt: 2,
        bypassReview: {
          nodeId: exhausted!.nodeId,
          phase: 'exhausted',
          attemptCount: 2,
          gateIds: exhausted!.gateIds,
        },
      });
      expect(entry).not.toHaveProperty('semanticResult');
      expect(entry).not.toHaveProperty('evaluation');
      expect(entry.bypassReview).not.toHaveProperty('prompts');
      expect(entry.bypassReview).not.toHaveProperty('history');
    }
    const history = await session.control({ action: 'execution_history', operation: 'list' });
    expect(history).toContain('↪ `pr-security` BYPASS');
    expect(history).toContain('Disposition: bypassed');
    for (const record of before)
      expect(history).toContain(new Date(record.startedAt).toISOString());
    expect(history).toContain('`input_required`');
    expect(history).toContain('second failure');
    const steps = await session.control({
      action: 'execution_history',
      operation: 'steps',
      session_id: chainId,
    });
    expect(steps).toContain('↪ `pr-security` BYPASS');
    expect(steps).not.toContain('✗ `pr-security` BYPASS');
    const statistics = await session.control({ action: 'analytics', operation: 'view' });
    expect(statistics).toContain('**Records With Gate Entries**');
    const gateBlock = statistics.split('- `pr-security`:')[1]!.split('\n- `')[0];
    const earlier = before
      .flatMap((row) => row.gateVerdicts)
      .filter((entry) => entry.gateId === 'pr-security' && entry.tier !== 'reminder');
    expect(gateBlock).toContain(
      `effective acceptance ${earlier.filter((entry) => entry.verdict === 'PASS').length} passed / ${earlier.filter((entry) => entry.verdict === 'FAIL').length} failed`
    );
    expect(gateBlock).toContain('Bypassed: 1; reminder attestations: 0');
    expect(session.review()).toBeUndefined();
  }, 180000);
  test('seeded reader facets stay separate through public history, latest steps and statistics', async () => {
    const session = await startSession();
    const chainId = chainIdOf(await session.call(gatedSinglePrompt));
    await session.call({
      chain_id: chainId,
      user_response: 'reader setup output',
      gate_verdict: 'GATE_REVIEW: FAIL - initialize ledger scope',
    });
    const binding = {
      gate_id: 'reader-mixed',
      node_id: 'mixed-node',
      attempt_id: 'old-attempt',
      definition_digest: 'frozen-definition',
      target_digest: 'old-target-A',
    };
    const base: GateVerdictSummary = {
      gateId: 'reader-mixed',
      verdict: 'FAIL',
      timestamp: 123456,
      attempt: 0,
      rationale: 'Seeded effective failure',
      reportedVerdict: 'PASS',
      reportedRationale: 'Exact seeded client claim',
      reportedReview: { overall: 'PASS', rationale: 'Exact seeded group claim' },
      reviewBinding: binding,
      requestedEvaluation: { mode: 'judge', model: 'requested-model', strict: true },
      evaluation: {
        binding,
        observations: [],
        reviewer: {
          provenance: 'client_reported',
          provider: 'claimed-provider',
          model: 'claimed-model',
          context: 'self',
        },
      },
      semanticResult: {
        valid: true,
        passed: false,
        issues: [],
        criteria: [
          { criterion_id: 'preserve-A', state: 'unmet', valid: true, passed: false, issues: [] },
        ],
      },
      toolChecks: [
        { gateId: 'reader-mixed', passed: true, summary: 'seeded recorded success' },
        { gateId: 'reader-mixed', passed: false, summary: 'seeded did-not-run' },
      ],
      disposition: 'advisory-cleared',
    };
    const invalid: GateVerdictSummary = {
      ...base,
      timestamp: 123450,
      attempt: 0,
      toolChecks: undefined,
      disposition: 'informational-cleared',
      semanticResult: {
        valid: false,
        passed: false,
        issues: [{ code: 'missing_report', message: 'Seeded missing report' }],
        criteria: [],
      },
    };
    const accepted: GateVerdictSummary = {
      ...base,
      verdict: 'PASS',
      attempt: 2,
      timestamp: 123460,
      toolChecks: undefined,
      disposition: 'held',
      reportedReview: { overall: 'FAIL', rationale: 'Other sibling held the group' },
      semanticResult: {
        valid: true,
        passed: true,
        issues: [],
        criteria: [
          { criterion_id: 'preserve-A', state: 'met', valid: true, passed: true, issues: [] },
        ],
      },
    };
    const bypass: GateVerdictSummary = {
      gateId: 'reader-bypass',
      verdict: 'BYPASS',
      timestamp: 123470,
      disposition: 'bypassed',
      source: 'gate_action',
      bypassReview: {
        nodeId: 'other-node',
        kind: 'gate',
        phase: 'exhausted',
        gateIds: ['reader-bypass'],
        attemptCount: 2,
        maxAttempts: 2,
        createdAt: 1,
        checkResults: [
          {
            gateId: 'reader-bypass',
            passed: false,
            summary: 'historical failure must not be recounted',
          },
        ],
      },
    };
    session.seedReaderRecords([
      { nodeId: 'mixed-node', summaries: [invalid] },
      { nodeId: 'mixed-node', summaries: [base] },
      { nodeId: 'mixed-node', summaries: [accepted] },
      { nodeId: 'mixed-node', summaries: [] },
      {
        nodeId: 'other-node',
        summaries: [
          bypass,
          { gateId: 'reader-reminder', verdict: 'PASS', tier: 'reminder', timestamp: 1 },
          { gateId: 'reader-legacy', verdict: 'PASS', timestamp: 1 },
        ],
      },
    ]);
    const history = await session.control({
      action: 'execution_history',
      operation: 'list',
      limit: 50,
    });
    expect(history).toContain('Semantic report contract: invalid');
    expect(history).toContain('Semantic report contract: rejected');
    expect(history).toContain('Semantic report contract: accepted');
    expect(history).toContain('Reported verdict: PASS — Exact seeded client claim');
    expect(history).toContain('"attempt_id":"old-attempt"');
    expect(history).toContain(
      'Requested evaluation: {"mode":"judge","model":"requested-model","strict":true}'
    );
    expect(history).toContain(
      'Client reviewer claim: {"provenance":"client_reported","provider":"claimed-provider","model":"claimed-model","context":"self"}'
    );
    expect(history).toContain('Host-observed reviewer: unknown; human verification: unknown.');
    const steps = await session.control({
      action: 'execution_history',
      operation: 'steps',
      session_id: 'seeded-reader-session',
    });
    expect(steps).toContain('`completed` step 1');
    expect(steps).toContain(
      'Latest-known gate facts (historical; not a grade of a newer empty row or target)'
    );
    expect(steps).toContain('`reader-mixed` PASS (attempt 2)');
    expect(steps).toContain(new Date(123460).toISOString());
    expect(steps).toContain('old-target-A');
    expect(steps).not.toContain('`reader-mixed` FAIL');
    expect(steps).toContain('↪ `reader-bypass` BYPASS');
    const statistics = await session.control({ action: 'analytics', operation: 'view' });
    const mixed = statistics.split('- `reader-mixed`:')[1]!.split('\n- `')[0];
    expect(mixed).toContain('effective acceptance 1 passed / 2 failed');
    expect(mixed).toContain('Semantic report acceptance: 1 accepted / 1 rejected / 1 invalid');
    expect(mixed).toContain('Recorded tool checks: 1 passed / 1 not passed');
    expect(mixed).toContain('attempted execution and exit status unavailable');
    expect(mixed).toContain('Legacy unverified acceptance: 0 passed / 0 failed');
    expect(mixed).toContain('Dispositions: 1 held / 1 advisory-cleared / 1 informational-cleared');
    const bypassStats = statistics.split('- `reader-bypass`:')[1]!.split('\n- `')[0];
    expect(bypassStats).toContain('effective acceptance 0 passed / 0 failed');
    expect(bypassStats).toContain('Bypassed: 1');
    expect(bypassStats).toContain('Recorded tool checks: 0 passed / 0 not passed');
    expect(statistics.split('- `reader-reminder`:')[1]!.split('\n- `')[0]).toContain(
      'reminder attestations: 1'
    );
    expect(statistics.split('- `reader-legacy`:')[1]!.split('\n- `')[0]).toContain(
      'Legacy unverified acceptance: 1 passed / 0 failed'
    );
  }, 180000);
});
