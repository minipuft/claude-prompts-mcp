/**
 * `system_control execution_history` operations as a caller reads them: the refusals, the empty
 * states, the session summary footer, status icons and every gate-fact line the ledger renders.
 *
 * Classification: Unit. The handler is driven through `execute` with only the execution-record
 * store port stubbed; every assertion is on the response text. The latest-per-step selection rule
 * has its own file (`execution-history-latest-facts.test.ts`).
 */

import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionHistoryActionHandler } from '../../../../src/mcp/tools/system-control/handlers/execution-history-action-handler.js';
import { hashCanonical } from '../../../../src/shared/utils/hash.js';

import type { SystemControlContext } from '../../../../src/mcp/tools/system-control/core/types.js';
import type {
  ExecutionRecord,
  GateVerdictSummary,
} from '../../../../src/shared/types/chain-execution.js';

const record = (overrides: Partial<ExecutionRecord> = {}): ExecutionRecord =>
  ({
    executionId: 'x',
    sessionId: 'sess-1',
    nodeId: 'n1',
    stepNumber: 1,
    status: 'completed',
    startedAt: 0,
    gateVerdicts: [],
    ...overrides,
  }) as ExecutionRecord;

const verdict = (overrides: Partial<GateVerdictSummary> = {}): GateVerdictSummary => ({
  gateId: 'g',
  verdict: 'PASS',
  timestamp: 0,
  ...overrides,
});

interface Stub {
  recent?: ExecutionRecord[];
  latest?: ExecutionRecord[];
  history?: ExecutionRecord[];
  scope?: unknown;
}

function build(stub: Stub = {}) {
  const store = {
    queryRecent: jest.fn((_limit?: number, _scope?: unknown) => stub.recent ?? []),
    queryLatestPerStep: jest.fn((_runId: string, _scope?: unknown) => stub.latest ?? []),
    queryBySession: jest.fn((_sessionId: string, _scope?: unknown) => stub.history ?? []),
  };
  const context = {
    executionRecordStore: store,
    requestScope: stub.scope,
    startTime: Date.now(),
    createMinimalSystemResponse: (text: string) => ({ content: [{ type: 'text', text }] }),
  } as unknown as SystemControlContext;
  return { store, handler: new ExecutionHistoryActionHandler(context) };
}

async function text(args: Record<string, unknown>, stub: Stub = {}): Promise<string> {
  const response = await build(stub).handler.execute(args);
  return response.content[0]?.text ?? '';
}

/** The ledger text for one record carrying one gate summary, read through `list`. */
async function listGate(summary: GateVerdictSummary): Promise<string> {
  return text({}, { recent: [record({ gateVerdicts: [summary] })] });
}

describe('execution_history refusals', () => {
  test('a server started without a database says the ledger is not available', async () => {
    const context = {
      executionRecordStore: undefined,
      createMinimalSystemResponse: (body: string) => ({ content: [{ type: 'text', text: body }] }),
    } as unknown as SystemControlContext;

    const response = await new ExecutionHistoryActionHandler(context).execute({});

    expect(response.content[0]?.text).toContain('Execution Ledger Not Available');
    expect(response.content[0]?.text).toContain('started without a database');
  });

  test('an unknown operation names itself and the valid ones', async () => {
    await expect(text({ operation: 'purge' })).rejects.toThrow(
      'Unknown execution_history operation: purge. Valid operations: list, steps'
    );
  });

  test.each([
    ['absent', {}],
    ['blank', { session_id: '   ' }],
    ['not a string', { session_id: 42 }],
  ])('steps with a session_id that is %s asks for one', async (_label, extra) => {
    await expect(text({ operation: 'steps', ...extra })).rejects.toThrow(
      'execution_history operation "steps" needs session_id'
    );
  });
});

describe('execution_history empty states', () => {
  test('list with no records says nothing has been recorded for this scope', async () => {
    const out = await text({ operation: 'list' });

    expect(out).toContain('No Execution History');
    expect(out).toContain('No chain executions have been recorded for this scope yet.');
  });

  test('steps for a run with no records names the run', async () => {
    const out = await text({ operation: 'steps', session_id: 'run-9' });

    expect(out).toContain('No Step Records');
    expect(out).toContain('No step of `run-9` has been recorded for this scope.');
  });
});

describe('execution_history list', () => {
  test('passes a numeric limit and the request scope to the store, and drops a non-numeric limit', async () => {
    const scope = { workspaceId: 'ws' };
    const numeric = build({ scope });
    await numeric.handler.execute({ limit: 7 });
    expect(numeric.store.queryRecent).toHaveBeenCalledWith(7, scope);

    const textual = build({ scope });
    await textual.handler.execute({ limit: '7' });
    expect(textual.store.queryRecent).toHaveBeenCalledWith(undefined, scope);
  });

  test('groups records by session with the chain label, step lines, elapsed time and error', async () => {
    const out = await text(
      {},
      {
        recent: [
          record({
            sessionId: 'sess-a',
            chainId: 'chain-a',
            stepNumber: 2,
            promptId: 'p1',
            startedAt: 1000,
            completedAt: 1250,
            status: 'failed',
            errorMessage: 'boom',
          }),
          record({ sessionId: 'sess-a', stepNumber: undefined, status: 'completed' }),
          record({ sessionId: 'sess-b', status: 'completed' }),
        ],
      }
    );

    expect(out).toContain('(3 record(s) across 2 session(s))');
    expect(out).toContain('### ❌ sess-a `chain-a`');
    expect(out).toContain('### ✅ sess-b');
    expect(out).not.toContain('### ✅ sess-b `');
    expect(out).toContain('`failed` step 2 · p1 · 1970-01-01T00:00:01.000Z · 250ms · ⚠️ boom');
    expect(out).toContain('`completed` chain · 1970-01-01T00:00:00.000Z');
  });

  test.each([
    ['completed', '✅'],
    ['failed', '❌'],
    ['cancelled', '🚫'],
    ['input_required', '⏸️'],
    ['working', '⏳'],
  ])('a %s session is headed with %s', async (status, icon) => {
    const out = await text(
      {},
      { recent: [record({ status: status as ExecutionRecord['status'] })] }
    );

    expect(out).toContain(`### ${icon} sess-1`);
  });

  test('counts non-terminal records and leaves the note out when every record is terminal', async () => {
    const mixed = await text(
      {},
      {
        recent: [
          record({ status: 'working' }),
          record({ status: 'input_required' }),
          record({ status: 'cancelled' }),
        ],
      }
    );
    expect(mixed).toContain('_2 record(s) are not in a terminal state');

    const terminal = await text({}, { recent: [record({ status: 'completed' })] });
    expect(terminal).not.toContain('not in a terminal state');
  });

  describe('session telemetry footer', () => {
    test('a record with no telemetry columns renders no footer', async () => {
      const out = await text({}, { recent: [record()] });

      expect(out).not.toContain('_planned');
    });

    test('renders planned, executed distinct steps, gates, retries and unknowns', async () => {
      const out = await text(
        {},
        {
          recent: [
            record({
              stepNumber: 2,
              stepsPlanned: 3,
              gatesFired: 4,
              gateRetries: 1,
              unknownsOpened: 2,
              unknownsClosed: 1,
            }),
            record({ stepNumber: 1 }),
            record({ stepNumber: 1 }),
            record({ stepNumber: undefined }),
          ],
        }
      );

      expect(out).toContain(
        '_planned 3 / executed 2 · gates fired 4 (retries 1) · unknowns opened 2 / closed 1_'
      );
    });

    test('a single telemetry column renders the rest as zero', async () => {
      const out = await text({}, { recent: [record({ unknownsClosed: 5 })] });

      expect(out).toContain(
        '_planned 0 / executed 1 · gates fired 0 (retries 0) · unknowns opened 0 / closed 5_'
      );
    });

    test('mutation and interrupt counters appear only once one is non-zero', async () => {
      const quiet = await text(
        {},
        { recent: [record({ stepsPlanned: 1, nodesInserted: 0, interruptsRaised: 0 })] }
      );
      expect(quiet).not.toContain('nodes inserted');
      expect(quiet).not.toContain('interrupts');

      const mutated = await text(
        {},
        { recent: [record({ stepsPlanned: 1, nodesInserted: 2, nodesSkipped: 1 })] }
      );
      expect(mutated).toContain(' · nodes inserted 2 / skipped 1');

      const skippedOnly = await text(
        {},
        { recent: [record({ stepsPlanned: 1, nodesSkipped: 3 })] }
      );
      expect(skippedOnly).toContain(' · nodes inserted 0 / skipped 3');

      const insertedOnly = await text(
        {},
        { recent: [record({ stepsPlanned: 1, nodesInserted: 1 })] }
      );
      expect(insertedOnly).toContain(' · nodes inserted 1 / skipped 0');

      const raisedOnly = await text(
        {},
        { recent: [record({ stepsPlanned: 1, interruptsRaised: 1 })] }
      );
      expect(raisedOnly).toContain(' · interrupts 1 / remainders 0');

      const interrupted = await text(
        {},
        { recent: [record({ stepsPlanned: 1, interruptsRaised: 1, remaindersAccepted: 2 })] }
      );
      expect(interrupted).toContain(' · interrupts 1 / remainders 2');

      const remaindersOnly = await text(
        {},
        { recent: [record({ stepsPlanned: 1, remaindersAccepted: 2 })] }
      );
      expect(remaindersOnly).toContain(' · interrupts 0 / remainders 2');
    });
  });
});

describe('execution_history gate facts', () => {
  test('a passed check gate shows its 1-based attempt and rationale', async () => {
    const out = await listGate(verdict({ attempt: 0, rationale: 'looks right' }));

    expect(out).toContain('  - ✓ `g` PASS (attempt 1) — looks right');
    expect(out).toContain('Legacy unverified acceptance: no recorded semantic or tool component.');
  });

  test('a failed gate shows ✗ and omits an empty rationale and an unknown attempt', async () => {
    const out = await listGate(verdict({ verdict: 'FAIL', rationale: '' }));

    expect(out).toContain('  - ✗ `g` FAIL\n');
  });

  test('a reminder is marked self-declared and not as a legacy acceptance', async () => {
    const out = await listGate(verdict({ tier: 'reminder' }));

    expect(out).toContain('  - ≡ `g` PASS');
    expect(out).toContain('Reminder attestation: self-declared, not graded.');
    expect(out).not.toContain('Legacy unverified acceptance');
  });

  test('a disposition is printed on its own line', async () => {
    const out = await listGate(verdict({ disposition: 'advisory-cleared' }));

    expect(out).toContain('    Disposition: advisory-cleared');
  });

  test.each([
    [{ valid: true, passed: true }, 'accepted'],
    [{ valid: true, passed: false }, 'rejected'],
    [{ valid: false, passed: false }, 'invalid'],
  ])('a semantic result %j is reported as %s, not as model accuracy', async (flags, expected) => {
    const out = await listGate(
      verdict({
        semanticResult: {
          ...flags,
          issues: [],
          criteria: [
            { criterion_id: 'c1', state: 'met', valid: true, passed: true, issues: [] },
            { criterion_id: 'c2', state: 'invalid', valid: false, passed: false, issues: [] },
          ],
        } as unknown as GateVerdictSummary['semanticResult'],
      })
    );

    expect(out).toContain(`Semantic report contract: ${expected} (not model accuracy)`);
    expect(out).toContain('Criterion states: c1: met; c2: invalid');
    expect(out).not.toContain('Legacy unverified acceptance');
  });

  test('tool checks list passed and not-passed results with the unavailable-exit-status caveat', async () => {
    const out = await listGate(
      verdict({
        toolChecks: [
          { gateId: 'g', passed: true, summary: 'npm test exit 0' },
          { gateId: 'g', passed: false, summary: 'lint exit 1' },
        ],
      })
    );

    expect(out).toContain(
      'Recorded tool checks: passed — npm test exit 0; not passed — lint exit 1'
    );
    expect(out).toContain('Attempted execution and exit status: unavailable');
    expect(out).not.toContain('Legacy unverified acceptance');
  });

  test('reported claims render the reported verdict, group and both bindings', async () => {
    const binding = {
      gate_id: 'g',
      node_id: 'n1',
      attempt_id: 'a1',
      definition_digest: 'dd',
      target_digest: 'td',
    };
    const out = await listGate(
      verdict({
        reportedVerdict: 'FAIL',
        reportedRationale: 'client disagreed',
        reportedReview: { overall: 'PASS', rationale: 'group fine' },
        reviewBinding: binding,
        evaluation: {
          binding: { ...binding, attempt_id: 'a2' },
          observations: [],
          reviewer: { provenance: 'client_reported', model: 'm1' },
        },
      })
    );

    expect(out).toContain('Reported verdict: FAIL — client disagreed');
    expect(out).toContain('Reported group: PASS — group fine');
    expect(out).toContain(`Server review binding: ${JSON.stringify(binding)}`);
    expect(out).toContain(`Reported binding: ${JSON.stringify({ ...binding, attempt_id: 'a2' })}`);
    expect(out).toContain(
      `Client reviewer claim: ${JSON.stringify({ provenance: 'client_reported', model: 'm1' })}`
    );
    expect(out).toContain('Host-observed reviewer: unknown; human verification: unknown.');
  });

  test('a reported verdict with no rationale does not print "undefined"', async () => {
    const out = await listGate(verdict({ reportedVerdict: 'PASS' }));

    expect(out).toContain('Reported verdict: PASS — \n');
    expect(out).not.toContain('undefined');
  });

  test('a requested evaluation prints it with an unknown reviewer claim', async () => {
    const requested = { mode: 'judge' as const, model: undefined, strict: true };
    const out = await listGate(verdict({ requestedEvaluation: requested }));

    expect(out).toContain(`Requested evaluation: ${JSON.stringify(requested)}`);
    expect(out).toContain(`Client reviewer claim: ${JSON.stringify({ provenance: 'unknown' })}`);
  });

  test('a gate with no semantic, evaluation or request prints no reviewer lines', async () => {
    const out = await listGate(verdict());

    expect(out).not.toContain('Client reviewer claim');
    expect(out).not.toContain('Host-observed reviewer');
    expect(out).not.toContain('Requested evaluation');
  });

  describe('bypass', () => {
    test('names the last attempt against its budget and skips acceptance facts', async () => {
      const out = await listGate(
        verdict({
          verdict: 'BYPASS',
          attempt: 2,
          rationale: 'operator skipped',
          disposition: 'bypassed',
          tier: 'reminder',
          bypassReview: { maxAttempts: 3 } as unknown as GateVerdictSummary['bypassReview'],
        })
      );

      expect(out).toContain('  - ↪ `g` BYPASS (after attempt 2/3) — operator skipped');
      expect(out).toContain('    Disposition: bypassed');
      expect(out).not.toContain('Reminder attestation');
      expect(out).not.toContain('Legacy unverified acceptance');
    });

    test('without a known budget the attempt has no denominator', async () => {
      const out = await listGate(verdict({ verdict: 'BYPASS', attempt: 1 }));

      expect(out).toContain('`g` BYPASS (after attempt 1)\n');
    });

    test('a PASS carrying only the bypassed disposition still renders as a bypass', async () => {
      const out = await listGate(verdict({ disposition: 'bypassed' }));

      expect(out).toContain('  - ↪ `g` BYPASS');
    });

    test('the requested evaluation is read from the frozen review definition', async () => {
      const definition = { id: 'g', evaluation: { mode: 'judge', strict: true } };
      const out = await listGate(
        verdict({
          verdict: 'BYPASS',
          bypassReview: {
            semanticContext: {
              nodeId: 'n1',
              attemptId: 'a1',
              definitions: { g: { definition, definitionDigest: hashCanonical(definition) } },
            },
          } as unknown as GateVerdictSummary['bypassReview'],
        })
      );

      expect(out).toContain(`Requested evaluation: ${JSON.stringify(definition.evaluation)}`);
    });

    test('a frozen review with no definition for the gate prints no requested evaluation', async () => {
      const out = await listGate(
        verdict({
          verdict: 'BYPASS',
          bypassReview: {
            semanticContext: { nodeId: 'n1', attemptId: 'a1', definitions: {} },
          } as unknown as GateVerdictSummary['bypassReview'],
        })
      );

      expect(out).not.toContain('Requested evaluation');
    });
  });
});

describe('execution_history steps', () => {
  test('one line per step with status icon, step number and prompt; a missing step number reads "step ?"', async () => {
    const out = await text(
      { operation: 'steps', session_id: 'run-1' },
      {
        latest: [
          record({ status: 'failed', stepNumber: 2, promptId: 'review' }),
          record({ status: 'input_required', stepNumber: undefined, nodeId: undefined }),
        ],
      }
    );

    expect(out).toContain('**Steps of `run-1`** (latest record per step)');
    expect(out).toContain('- ❌ `failed` step 2 · review');
    expect(out).toContain('- ⏸️ `input_required` step ?');
  });

  test('queries the run scoped to the request and reads history once per distinct session', async () => {
    const scope = { workspaceId: 'ws' };
    const { store, handler } = build({
      scope,
      latest: [
        record({ sessionId: 's1', stepNumber: 1 }),
        record({ sessionId: 's1', stepNumber: 2 }),
        record({ sessionId: 's2', stepNumber: 1 }),
      ],
    });

    await handler.execute({ operation: 'steps', session_id: 'run-1' });

    expect(store.queryLatestPerStep).toHaveBeenCalledWith('run-1', scope);
    expect(store.queryBySession).toHaveBeenCalledTimes(2);
    expect(store.queryBySession).toHaveBeenCalledWith('s1', scope);
    expect(store.queryBySession).toHaveBeenCalledWith('s2', scope);
  });

  test('gate facts of another step of the same session are not shown under this step', async () => {
    const other = record({
      executionId: '2',
      nodeId: 'n2',
      stepNumber: 2,
      gateVerdicts: [verdict({ gateId: 'other-gate' })],
    });
    const out = await text(
      { operation: 'steps', session_id: 'run-1' },
      { latest: [record({ stepNumber: 1 })], history: [other] }
    );

    expect(out).not.toContain('Latest-known gate facts');
    expect(out).not.toContain('other-gate');
  });

  test('facts are keyed by step number when a record has no node id', async () => {
    const graded = record({
      executionId: '1',
      nodeId: undefined,
      stepNumber: 4,
      gateVerdicts: [verdict({ gateId: 'by-step', timestamp: 5000 })],
    });
    const out = await text(
      { operation: 'steps', session_id: 'run-1' },
      { latest: [record({ nodeId: undefined, stepNumber: 4 })], history: [graded] }
    );

    expect(out).toContain('`by-step` PASS');
    expect(out).toContain('Recorded at 1970-01-01T00:00:05.000Z · record `1`');
  });
});
