// @lifecycle test - Tier 5 verification: ExecutionRecordStore round-trip + scope + ordering
/**
 * Integration test for ExecutionRecordStore.
 *
 * Verifies the append-only execution log against a real :memory: SQLite database
 * (node:sqlite DatabaseSync). The test mirrors the table shape declared in
 * sqlite-engine.ts so a real schema/code drift would surface here.
 *
 * Plan reference: ~/.claude/plans/execution-ledger-evidence-contracts-2026-04-27.md
 * Tier 5 rows #11 (per-step records) + #12 (chain-terminal record).
 */

import { afterEach, beforeEach, describe, expect, test, jest } from '@jest/globals';

import { installIssuedReviewCloneFixture } from './issued-review-clone-fixture.js';
import { resolveFrozenReviewDefinition } from '../../../src/engine/execution/pipeline/decisions/gates/frozen-review-definitions.js';

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { StepCaptureService } from '../../../src/engine/execution/capture/step-capture-service.js';
import { UnknownObservationProcessor } from '../../../src/engine/execution/capture/unknown-observation-processor.js';
import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import {
  composeStructuralReview,
  PHASE_GUARD_GATE_ID,
  selectToolReviewGateIds,
} from '../../../src/engine/execution/pipeline/decisions/gates/structural-review-composition.js';
import {
  bindSemanticReviewTarget,
  createSemanticReviewContext,
} from '../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import { StepResponseCaptureStage } from '../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';
import { hashBytes } from '../../../src/shared/utils/hash.js';

import type { GateDefinitionProvider } from '../../../src/engine/gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../src/engine/gates/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { GateReview } from '../../../src/shared/types/chain-execution.js';
import type { GateVerdictSubmission } from '../../../src/shared/types/gate-evaluation.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

let issuedCloneFixture: ReturnType<typeof installIssuedReviewCloneFixture>;
beforeEach(() => {
  issuedCloneFixture = installIssuedReviewCloneFixture();
});
afterEach(() => {
  issuedCloneFixture.restore();
});

const REVIEW_SCOPE = { continuityScopeId: 'semantic-capture-scope' };
const REVIEW_OUTPUT = 'A😀e\u0301 Z';
const REVIEW_GATE: LightweightGateDefinition = {
  id: 'retention-gate',
  name: 'Retention gate',
  type: 'validation',
  description: 'Ordinary gate carrying a staged rich report',
  guidance: 'Review the actual output',
  enforcementMode: 'blocking',
  pass_criteria: [{ type: 'inline_guidance' }],
};

/** Real persistence/capture collaborators; only the gate loader's filesystem is substituted. */
async function reviewFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'review-capture-cold-'));
  const logger = createLogger();
  const dbPath = path.join(root, 'state.db');
  let engine = await SqliteEngine.getInstance(logger, { dbPath });
  await engine.initialize();
  const createStore = async () => {
    const store = new ChainSessionStore(
      logger,
      new TextReferenceStore(logger),
      { cleanupIntervalMs: 60_000, defaultScope: REVIEW_SCOPE },
      engine
    );
    // Await the constructor's real load, as sibling cold-storage tests do.
    await (store as unknown as { initPromise: Promise<void> }).initPromise;
    return store;
  };
  let store = await createStore();
  const provider = {
    loadGate: async (id: string) => (id === REVIEW_GATE.id ? REVIEW_GATE : null),
    loadGates: async (ids: string[]) => (ids.includes(REVIEW_GATE.id) ? [REVIEW_GATE] : []),
  } as unknown as GateDefinitionProvider;
  return {
    logger,
    get store() {
      return store;
    },
    get records() {
      return new ExecutionRecordStore(engine, logger);
    },
    authority: () => new GateEnforcementAuthority(store, logger, provider),
    async cold() {
      await store.cleanup();
      await engine.shutdown();
      engine = await SqliteEngine.getInstance(logger, { dbPath });
      await engine.initialize();
      store = await createStore();
    },
    async close() {
      await store.cleanup();
      await engine.shutdown();
      await rm(root, { recursive: true, force: true });
    },
  };
}

type ReviewFixture = Awaited<ReturnType<typeof reviewFixture>>;

async function openReview(f: ReviewFixture, kind: 'gate' | 'detached' = 'gate') {
  await f.store.createSession(
    'review-session',
    'review-chain#1',
    2,
    {},
    {
      ...REVIEW_SCOPE,
      nodes: [
        { id: 'reviewed-node', promptId: 'draft', stepName: 'Draft' },
        { id: 'current-node', promptId: 'next', stepName: 'Next' },
      ],
    }
  );
  return f.authority().createReview('review-session', kind, 'reviewed-node', {
    gateIds: [REVIEW_GATE.id],
    instructions: 'Review',
    maxAttempts: 3,
    ...(kind === 'detached' ? { reviewedOutput: REVIEW_OUTPUT } : {}),
  });
}

function retainedVerdict(review: GateReview): GateVerdictSubmission {
  const issued = review.semanticContext;
  const definition = issued?.definitions[REVIEW_GATE.id];
  if (issued === undefined || definition === undefined) throw new Error('Missing issued context');
  return {
    overall: 'FAIL',
    rationale: 'The ordinary review failed',
    per_gate: [
      {
        index: 1,
        passed: false,
        rationale: 'Retain this failed attempt',
        evaluation: {
          binding: {
            gate_id: REVIEW_GATE.id,
            node_id: issued.nodeId,
            attempt_id: issued.attemptId,
            definition_digest: definition.definitionDigest,
            target_digest: hashBytes(REVIEW_OUTPUT),
          },
          observations: [
            {
              criterion_id: 'staged-carrier',
              state: 'unmet',
              value: false,
              evidence: [
                {
                  target_digest: hashBytes(REVIEW_OUTPUT),
                  start: 0,
                  end: REVIEW_OUTPUT.length,
                  quote: REVIEW_OUTPUT,
                },
              ],
              rationale: 'Exact Unicode carrier, not live semantic adjudication',
            },
          ],
          reviewer: {
            provenance: 'client_reported',
            model: 'declared-reviewer',
            context: 'separate_pass',
          },
        },
      },
    ],
  };
}

function reviewContext(f: ReviewFixture, userResponse?: string, verdict?: GateVerdictSubmission) {
  const context = new ExecutionContext(
    {
      chain_id: 'review-chain#1',
      ...(userResponse !== undefined ? { user_response: userResponse } : {}),
      ...(verdict !== undefined ? { gate_verdict: verdict } : {}),
    },
    f.logger
  );
  context.state.identity.continuityScopeId = REVIEW_SCOPE.continuityScopeId;
  const session = f.store.getSession('review-session', REVIEW_SCOPE);
  if (session === undefined) throw new Error('Missing review session');
  context.sessionContext = {
    sessionId: session.sessionId,
    chainId: session.chainId,
    isChainExecution: true,
    currentNodeId: session.state.currentNodeId,
    totalSteps: 2,
  };
  context.gateEnforcement = f.authority();
  return context;
}

function reviewStage(f: ReviewFixture) {
  return new StepResponseCaptureStage(
    new GateVerdictProcessor(f.store, f.logger),
    new StepCaptureService(f.store, f.logger, f.records),
    f.store,
    new UnknownObservationProcessor(f.store, f.logger),
    f.logger
  );
}

/** Draft semantic rubric, installed directly for custody checks rather than live resource activation. */
async function draftReview(f: ReviewFixture, review: GateReview) {
  const issued = review.semanticContext;
  if (issued === undefined) throw new Error('Missing issued review');
  const context = createSemanticReviewContext(review.nodeId, issued.attemptId, [
    {
      ...REVIEW_GATE,
      pass_criteria: [
        {
          type: 'semantic_evaluation',
          id: 'staged-carrier',
          target: { kind: 'step_output' },
          question: 'Does the output preserve the contract?',
          evidence_requirements: { min_items: 1 },
          result: { kind: 'boolean' },
          acceptance: { kind: 'equals', value: true },
        },
      ],
    },
  ]);
  const drafted = {
    ...review,
    semanticContext:
      issued.target === undefined
        ? context
        : bindSemanticReviewTarget(context, issued.target.content),
  };
  await f.store.setReview('review-session', drafted);
  return drafted;
}

function detachedContext(f: ReviewFixture, output: string, verdict?: GateVerdictSubmission) {
  const context = reviewContext(f, output, verdict);
  context.parsedCommand = {
    commandType: 'chain',
    promptId: 'draft',
    rawArgs: '',
    format: 'symbolic',
    confidence: 1,
    metadata: {
      originalCommand: '>>draft --> >>next',
      parseStrategy: 'fixture',
      detectedFormat: 'symbolic',
      warnings: [],
    },
    chainId: 'review-chain#1',
    steps: [
      { stepNumber: 1, nodeId: 'reviewed-node', promptId: 'draft', args: {}, await: 'run' },
      { stepNumber: 2, nodeId: 'current-node', promptId: 'next', args: {} },
    ],
    promptArgs: {},
  };
  return context;
}

function addStructuralFinding(review: GateReview): GateReview {
  return {
    ...composeStructuralReview(review, {
      gateId: PHASE_GUARD_GATE_ID,
      feedback: 'Missing declared context',
      retryHints: ['Add context'],
      failedPhases: ['context'],
      mode: 'enforce',
      previousResponse: REVIEW_OUTPUT,
      reviewedStep: { nodeId: review.nodeId, stepNumber: 1 },
      maxAttempts: 3,
      createdAt: 42,
    }),
    nodeId: review.nodeId,
    kind: review.kind,
    phase: review.phase,
  };
}

function currentReview(f: ReviewFixture): GateReview {
  const review = f.store.getReview('review-session', 'reviewed-node');
  if (review === undefined) throw new Error('Missing stored review');
  return review;
}

function remapDecisionState(f: ReviewFixture) {
  const session = f.store.getSession('review-session', REVIEW_SCOPE);
  if (session === undefined) throw new Error('Missing stored session');
  // Session lookup touches lastActivity; compare the complete node/review decision state instead.
  return structuredClone({
    state: session.state,
    reviews: session.reviews,
    gateRemap: session.gateRemap,
    runStatus: session.runStatus,
    telemetry: f.store.getRunTelemetry('review-session'),
  });
}

describe('authorized bypass ledger custody (real SQLite)', () => {
  test.each(['gate', 'detached'] as const)(
    '%s skip persists BYPASS before advance/completion and retains cold server facts',
    async (kind) => {
      const f = await reviewFixture();
      try {
        const opened = await draftReview(f, await openReview(f, kind));
        await f.store.updateSessionState('review-session', 'reviewed-node', REVIEW_OUTPUT, {
          isPlaceholder: false,
        });
        await f.store.completeStep('review-session', 'reviewed-node');
        const captured = f.authority().bindReviewOutput(opened, REVIEW_OUTPUT);
        await f.store.setReview('review-session', captured);
        if (kind === 'detached') {
          await f.store.markNodeSpawned('review-session', 'reviewed-node');
          await f.store.advanceStep('review-session', 'reviewed-node');
        }
        // A genuine failed attempt remains independently available before operator bypass.
        const failure =
          kind === 'detached'
            ? detachedContext(f, 'HANDOFF RESULT\nnode: reviewed-node', retainedVerdict(captured))
            : reviewContext(f, undefined, retainedVerdict(captured));
        await reviewStage(f).execute(failure);
        const exhausted = {
          ...currentReview(f),
          phase: 'exhausted' as const,
          attemptCount: 3,
          metadata: { serverReceipt: { value: 'original' } },
        };
        await f.store.setReview('review-session', exhausted);
        const original = JSON.parse(JSON.stringify(currentReview(f))) as GateReview;
        const context =
          kind === 'detached'
            ? detachedContext(f, 'HANDOFF RESULT\nnode: reviewed-node')
            : reviewContext(f);
        const actionContext = new ExecutionContext(
          { ...context.mcpRequest, gate_action: 'skip' },
          f.logger
        );
        actionContext.state.identity.continuityScopeId = REVIEW_SCOPE.continuityScopeId;
        actionContext.sessionContext = context.sessionContext;
        actionContext.parsedCommand = context.parsedCommand;
        actionContext.gateEnforcement = f.authority();
        const grade = jest.spyOn(f.store, 'recordGateReviewOutcome');
        const assertRecordedBeforeMove = () => {
          const latest = f.records.queryBySession('review-session', REVIEW_SCOPE).at(-1);
          expect(latest?.gateVerdicts[0]).toMatchObject({
            verdict: 'BYPASS',
            disposition: 'bypassed',
            source: 'gate_action',
          });
        };
        const complete = f.store.completeHeldRun.bind(f.store);
        const advance = f.store.advanceStep.bind(f.store);
        const movement =
          kind === 'detached'
            ? jest.spyOn(f.store, 'completeHeldRun').mockImplementation(async (id) => {
                assertRecordedBeforeMove();
                return complete(id);
              })
            : jest.spyOn(f.store, 'advanceStep').mockImplementation(async (id, node) => {
                assertRecordedBeforeMove();
                return advance(id, node);
              });
        await reviewStage(f).execute(actionContext);
        expect(movement).toHaveBeenCalled();
        expect(grade).not.toHaveBeenCalled();
        expect(f.store.getReview('review-session', 'reviewed-node')).toBeUndefined();
        const records = f.records.queryBySession('review-session', REVIEW_SCOPE);
        expect(records[0]?.gateVerdicts[0]?.verdict).toBe('FAIL');
        const last = records.at(-1)!;
        const receipt = last.gateVerdicts[0]!;
        expect(last.nodeId).toBe('reviewed-node');
        expect(receipt).toMatchObject({
          verdict: 'BYPASS',
          disposition: 'bypassed',
          attempt: 3,
          bypassReview: {
            nodeId: original.nodeId,
            phase: 'exhausted',
            semanticContext: original.semanticContext,
            gateIds: original.gateIds,
            metadata: original.metadata,
          },
        });
        expect(receipt).not.toHaveProperty('evaluation');
        expect(receipt).not.toHaveProperty('semanticResult');
        expect(receipt).not.toHaveProperty('reportedVerdict');
        expect(receipt.bypassReview).not.toHaveProperty('prompts');
        expect(receipt.bypassReview).not.toHaveProperty('history');
        const saved = JSON.parse(JSON.stringify(records));
        Reflect.set(receipt.bypassReview!.gateIds, '0', 'getter-mutated');
        if (exhausted.metadata !== undefined)
          exhausted.metadata['serverReceipt'] = { value: 'input-mutated' };
        expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toEqual(saved);
        await f.cold();
        expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toEqual(saved);
      } finally {
        await f.close();
      }
    }
  );

  test.each(['awaiting-verdict', 'exhausted'] as const)(
    'refused %s skip creates no bypass receipt or ledger/advance',
    async (phase) => {
      const f = await reviewFixture();
      try {
        const opened = await openReview(f);
        await f.store.setReview('review-session', {
          ...opened,
          phase,
          attemptCount: phase === 'exhausted' ? 3 : 0,
        });
        const base = reviewContext(f);
        const context = new ExecutionContext({ ...base.mcpRequest, gate_action: 'skip' }, f.logger);
        context.state.identity.continuityScopeId = REVIEW_SCOPE.continuityScopeId;
        context.sessionContext = base.sessionContext;
        context.gateEnforcement = f.authority();
        const before = remapDecisionState(f);
        const move = jest.spyOn(f.store, 'advanceStep');
        await reviewStage(f).execute(context);
        expect(context.response?.isError).toBe(true);
        expect(context.state.gates.reviewActionDetection).toBeUndefined();
        expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toEqual([]);
        expect(move).not.toHaveBeenCalled();
        expect(remapDecisionState(f)).toEqual(before);
      } finally {
        await f.close();
      }
    }
  );

  test('accepted skip receipt copies caller review before delayed ledger append', async () => {
    const f = await reviewFixture();
    try {
      const issued = await openReview(f);
      await f.store.updateSessionState('review-session', 'reviewed-node', REVIEW_OUTPUT, {
        isPlaceholder: false,
      });
      await f.store.completeStep('review-session', 'reviewed-node');
      await f.store.setReview('review-session', {
        ...issued,
        phase: 'exhausted',
        attemptCount: 3,
        metadata: { receipt: 'original' },
      });
      const base = reviewContext(f);
      const context = new ExecutionContext({ ...base.mcpRequest, gate_action: 'skip' }, f.logger);
      context.state.identity.continuityScopeId = REVIEW_SCOPE.continuityScopeId;
      context.sessionContext = base.sessionContext;
      context.gateEnforcement = f.authority();
      const session = f.store.getSession('review-session', REVIEW_SCOPE)!;
      const callerReview = { ...currentReview(f) };
      session.reviews = { 'reviewed-node': callerReview };
      await new GateVerdictProcessor(f.store, f.logger).handleGateAction(
        context,
        session,
        'skip',
        context.sessionContext!
      );
      Reflect.set(callerReview, 'gateIds', ['caller-mutated']);
      Reflect.set(callerReview, 'metadata', { receipt: 'caller-mutated' });
      new StepCaptureService(f.store, f.logger, f.records).ledgerSubmittedReviewAction(
        context,
        'review-session',
        session
      );
      const receipt = f.records.queryBySession('review-session', REVIEW_SCOPE)[0]?.gateVerdicts[0];
      expect(receipt).toMatchObject({
        gateId: REVIEW_GATE.id,
        verdict: 'BYPASS',
        bypassReview: { gateIds: [REVIEW_GATE.id], metadata: { receipt: 'original' } },
      });
    } finally {
      await f.close();
    }
  });

  test('bypass receipt deep-copies input before clearing and append failure prevents advancement', async () => {
    const f = await reviewFixture();
    try {
      const review = await openReview(f);
      await f.store.updateSessionState('review-session', 'reviewed-node', REVIEW_OUTPUT, {
        isPlaceholder: false,
      });
      await f.store.completeStep('review-session', 'reviewed-node');
      await f.store.setReview('review-session', { ...review, phase: 'exhausted', attemptCount: 3 });
      const base = reviewContext(f);
      const context = new ExecutionContext({ ...base.mcpRequest, gate_action: 'skip' }, f.logger);
      context.state.identity.continuityScopeId = REVIEW_SCOPE.continuityScopeId;
      context.sessionContext = base.sessionContext;
      context.gateEnforcement = f.authority();
      const records = f.records;
      jest.spyOn(records, 'append').mockImplementation(() => {
        throw new Error('ledger unavailable');
      });
      const moved = jest.spyOn(f.store, 'advanceStep');
      const stage = new StepResponseCaptureStage(
        new GateVerdictProcessor(f.store, f.logger),
        new StepCaptureService(f.store, f.logger, records),
        f.store,
        new UnknownObservationProcessor(f.store, f.logger),
        f.logger
      );
      await expect(stage.execute(context)).rejects.toThrow('ledger unavailable');
      expect(moved).not.toHaveBeenCalled();
      // Review clearing already happened; no atomic rollback is promised.
      expect(f.store.getReview('review-session', 'reviewed-node')).toBeUndefined();
    } finally {
      await f.close();
    }
  });
});

describe('issued review capture and cold custody (real SQLite)', () => {
  test.each(['gate', 'detached'] as const)(
    '%s mixed structural marker survives input/getter mutation and real SQLite cold reopen',
    async (kind) => {
      const f = await reviewFixture();
      try {
        const opened = await openReview(f, kind);
        const bound = f.authority().bindReviewOutput(
          {
            ...opened,
            attemptCount: 2,
            maxAttempts: 5,
            metadata: {
              ...opened.metadata,
              source: kind === 'detached' ? 'worker-report' : 'gate-enforcement',
            },
          },
          REVIEW_OUTPUT
        );
        const markers = [PHASE_GUARD_GATE_ID];
        const submitted = { ...addStructuralFinding(bound), structuralGateIds: markers };
        const expected = structuredClone(submitted);
        await f.store.setReview('review-session', submitted);
        markers.splice(0, 1, 'caller-replaced-marker');
        expect(currentReview(f)).toEqual(expected);
        const getterCopy = currentReview(f);
        if (getterCopy.structuralGateIds === undefined) throw new Error('Missing server marker');
        Reflect.set(getterCopy.structuralGateIds, '0', 'getter-replaced-marker');
        expect(currentReview(f)).toEqual(expected);
        // Persist again after both mutation attempts, so cold proof observes current owned state.
        await f.store.setReview('review-session', currentReview(f));
        await f.cold();
        const cold = currentReview(f);
        expect(cold).toEqual(expected);
        expect(cold.gateIds).toEqual([REVIEW_GATE.id, PHASE_GUARD_GATE_ID]);
        expect(selectToolReviewGateIds(cold)).toEqual([REVIEW_GATE.id]);
        expect(cold.semanticContext?.target?.content).toBe(REVIEW_OUTPUT);
        if (cold.structuralGateIds === undefined) throw new Error('Missing cold marker');
        Reflect.set(cold.structuralGateIds, '0', 'cold-getter-replaced-marker');
        expect(currentReview(f).structuralGateIds).toEqual([PHASE_GUARD_GATE_ID]);
      } finally {
        await f.close();
      }
    }
  );

  test('cold authored canonical collision retains marker, full requirement and frozen authority', async () => {
    const f = await reviewFixture();
    try {
      const opened = await openReview(f, 'detached');
      if (opened.semanticContext === undefined) throw new Error('Missing issued attempt');
      const collision: GateReview = {
        ...opened,
        gateIds: [PHASE_GUARD_GATE_ID],
        prompts: opened.prompts.map((prompt) => ({ ...prompt, gateId: PHASE_GUARD_GATE_ID })),
        gateTiers: { [PHASE_GUARD_GATE_ID]: opened.gateTiers?.[REVIEW_GATE.id] ?? 'reminder' },
        attemptCount: 2,
        maxAttempts: 5,
        metadata: { ...opened.metadata, source: 'worker-report' },
        semanticContext: bindSemanticReviewTarget(
          createSemanticReviewContext(opened.nodeId, opened.semanticContext.attemptId, [
            { ...REVIEW_GATE, id: PHASE_GUARD_GATE_ID },
          ]),
          REVIEW_OUTPUT
        ),
      };
      const composed = addStructuralFinding(collision);
      await f.store.setReview('review-session', composed);
      await f.cold();
      const cold = currentReview(f);
      expect(cold).toEqual(composed);
      expect(cold.structuralGateIds).toEqual([PHASE_GUARD_GATE_ID]);
      expect(selectToolReviewGateIds(cold)).toEqual([PHASE_GUARD_GATE_ID]);
      expect(cold.gateIds).toEqual([PHASE_GUARD_GATE_ID]);
    } finally {
      await f.close();
    }
  });

  test('reverse remap onto existing structural membership refuses before all node/review/pin state changes', async () => {
    const f = await reviewFixture();
    try {
      const opened = await openReview(f, 'detached');
      const mixed = addStructuralFinding(opened);
      await f.store.setReview('review-session', mixed);
      await f.store.setReview('review-session', {
        ...opened,
        nodeId: 'current-node',
        kind: 'gate',
        semanticContext: createSemanticReviewContext('current-node', 'sibling-attempt', [
          REVIEW_GATE,
        ]),
      });
      const before = remapDecisionState(f);
      await expect(
        f.store.remapRunGates('review-session', new Map([[REVIEW_GATE.id, PHASE_GUARD_GATE_ID]]))
      ).rejects.toThrow(/retention-gate.*__phase_guard__.*existing server structural membership/);
      expect(remapDecisionState(f)).toEqual(before);
      expect(currentReview(f)).toEqual(mixed);
      expect(selectToolReviewGateIds(currentReview(f))).toEqual([REVIEW_GATE.id]);
      await f.cold();
      expect(remapDecisionState(f)).toEqual(before);
      expect(currentReview(f)).toEqual(mixed);
    } finally {
      await f.close();
    }
  });

  test('ordinary and forward structural remaps preserve behavior without creating an authored-ID exemption', async () => {
    const f = await reviewFixture();
    try {
      const mixed = addStructuralFinding(await openReview(f, 'detached'));
      await f.store.setReview('review-session', mixed);
      await f.store.remapRunGates('review-session', new Map([[REVIEW_GATE.id, 'ordinary-alias']]));
      const ordinary = currentReview(f);
      expect(ordinary.gateIds).toEqual(['ordinary-alias', PHASE_GUARD_GATE_ID]);
      expect(ordinary.structuralGateIds).toEqual([PHASE_GUARD_GATE_ID]);
      expect(selectToolReviewGateIds(ordinary)).toEqual(['ordinary-alias']);
      expect(ordinary.semanticContext).toEqual({
        ...mixed.semanticContext,
        definitionAliases: {
          'ordinary-alias': REVIEW_GATE.id,
          [PHASE_GUARD_GATE_ID]: PHASE_GUARD_GATE_ID,
        },
      });
      await f.store.remapRunGates(
        'review-session',
        new Map([
          [REVIEW_GATE.id, 'ordinary-alias'],
          [PHASE_GUARD_GATE_ID, 'structural-alias'],
        ])
      );
      const forward = currentReview(f);
      expect(forward.gateIds).toEqual(['ordinary-alias', 'structural-alias']);
      expect(forward.structuralGateIds).toEqual([PHASE_GUARD_GATE_ID]);
      expect(selectToolReviewGateIds(forward)).toEqual(['ordinary-alias', 'structural-alias']);
      expect(forward.semanticContext).toEqual({
        ...mixed.semanticContext,
        definitionAliases: {
          'ordinary-alias': REVIEW_GATE.id,
          'structural-alias': PHASE_GUARD_GATE_ID,
        },
      });
      await f.cold();
      expect(currentReview(f)).toEqual(forward);
      expect(selectToolReviewGateIds(currentReview(f))).toEqual([
        'ordinary-alias',
        'structural-alias',
      ]);
    } finally {
      await f.close();
    }
  });

  test('ordinary authored remap onto the canonical ID remains allowed when no structural member exists', async () => {
    const f = await reviewFixture();
    try {
      const opened = await openReview(f);
      await f.store.remapRunGates(
        'review-session',
        new Map([[REVIEW_GATE.id, PHASE_GUARD_GATE_ID]])
      );
      const remapped = currentReview(f);
      expect(remapped.gateIds).toEqual([PHASE_GUARD_GATE_ID]);
      expect(remapped.structuralGateIds).toBeUndefined();
      expect(selectToolReviewGateIds(remapped)).toEqual([PHASE_GUARD_GATE_ID]);
      expect(remapped.semanticContext).toEqual({
        ...opened.semanticContext,
        definitionAliases: { [PHASE_GUARD_GATE_ID]: REVIEW_GATE.id },
      });
      await f.cold();
      expect(currentReview(f)).toEqual(remapped);
    } finally {
      await f.close();
    }
  });

  test('cold reopened review retains pins and getter copies cannot mutate stored authority', async () => {
    const f = await reviewFixture();
    try {
      const opened = await openReview(f);
      const bound = f.authority().bindReviewOutput(opened, `  ${REVIEW_OUTPUT}\n`);
      await f.store.setReview('review-session', bound);
      await f.cold();
      const copy = f.store.getReview('review-session', 'reviewed-node');
      expect(copy?.semanticContext).toEqual(bound.semanticContext);
      const copied = copy?.semanticContext;
      if (copied === undefined) throw new Error('Missing cold authority');
      Reflect.set(copied, 'attemptId', 'caller-replacement');
      Reflect.set(copied.definitions[REVIEW_GATE.id]!.definition, 'guidance', 'caller rewrite');
      Reflect.set(copied.target!, 'content', 'caller target');
      expect(f.store.getReview('review-session', 'reviewed-node')?.semanticContext).toEqual(
        bound.semanticContext
      );
      expect(
        f.store.getSession('review-session', { continuityScopeId: 'another-scope' })
      ).toBeUndefined();
    } finally {
      await f.close();
    }
  });

  test('same-call ordinary capture retains exact failed report and canonical target through cold load', async () => {
    const f = await reviewFixture();
    try {
      const opened = await openReview(f);
      const verdict = retainedVerdict(opened);
      const context = reviewContext(f, `  ${REVIEW_OUTPUT}\n`, verdict);
      await reviewStage(f).execute(context);
      const records = f.records.queryBySession('review-session', REVIEW_SCOPE);
      expect(records).toHaveLength(1);
      expect(records[0]?.gateVerdicts[0]?.evaluation).toEqual(verdict.per_gate?.[0]?.evaluation);
      expect(records[0]?.gateVerdicts[0]?.attempt).toBe(0);
      expect(records[0]?.nodeId).toBe('reviewed-node');
      const pins = f.store.getReview('review-session', 'reviewed-node')?.semanticContext;
      expect(pins?.target).toEqual({
        kind: 'step_output',
        content: REVIEW_OUTPUT,
        digest: hashBytes(REVIEW_OUTPUT),
      });
      await f.cold();
      expect(f.store.getReview('review-session', 'reviewed-node')?.semanticContext).toEqual(pins);
      expect(f.records.queryBySession('review-session', REVIEW_SCOPE)[0]?.gateVerdicts).toEqual(
        records[0]?.gateVerdicts
      );
      expect(
        f.records.queryBySession('review-session', { continuityScopeId: 'another-scope' })
      ).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test('renewed ordinary completed-node capture binds fresh bytes and preserves failed attempt after cold load', async () => {
    const f = await reviewFixture();
    try {
      await draftReview(f, await openReview(f));
      await reviewStage(f).execute(reviewContext(f, REVIEW_OUTPUT));
      const before = f.store.getReview('review-session', 'reviewed-node');
      if (before === undefined) throw new Error('Missing captured review');
      const submission = retainedVerdict(before);
      await reviewStage(f).execute(reviewContext(f, undefined, submission));
      const renewed = f.store.getReview('review-session', 'reviewed-node');
      expect(renewed?.semanticContext?.attemptId).not.toBe(before.semanticContext?.attemptId);
      expect(renewed?.semanticContext).not.toHaveProperty('target');
      const replacement = 'Fresh ordinary answer 😀';
      await reviewStage(f).execute(reviewContext(f, replacement));
      const captured = f.store.getReview('review-session', 'reviewed-node');
      expect(captured?.semanticContext?.attemptId).toBe(renewed?.semanticContext?.attemptId);
      expect(captured?.semanticContext?.target).toEqual({
        kind: 'step_output',
        content: replacement,
        digest: hashBytes(replacement),
      });
      expect(captured?.semanticContext?.definitions).toEqual(before.semanticContext?.definitions);
      expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(replacement);
      const records = f.records.queryBySession('review-session', REVIEW_SCOPE);
      expect(records).toHaveLength(3);
      expect(records[1]?.gateVerdicts[0]?.evaluation).toEqual(submission.per_gate?.[0]?.evaluation);
      expect(submission.per_gate?.[0]?.evaluation?.binding.attempt_id).not.toBe(
        captured?.semanticContext?.attemptId
      );
      await f.cold();
      expect(f.store.getReview('review-session', 'reviewed-node')?.semanticContext).toEqual(
        captured?.semanticContext
      );
      expect(f.records.queryBySession('review-session', REVIEW_SCOPE)[1]?.gateVerdicts).toEqual(
        records[1]?.gateVerdicts
      );
    } finally {
      await f.close();
    }
  });

  test('unchanged completed output without renewed authority keeps the ordinary early return', async () => {
    const f = await reviewFixture();
    try {
      await openReview(f);
      await reviewStage(f).execute(reviewContext(f, REVIEW_OUTPUT));
      await reviewStage(f).execute(reviewContext(f, 'Unsolicited overwrite with bound review'));
      expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(REVIEW_OUTPUT);
      expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toHaveLength(1);
      await f.store.clearReview('review-session', 'reviewed-node');
      await reviewStage(f).execute(reviewContext(f, 'Unsolicited overwrite'));
      expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(REVIEW_OUTPUT);
      expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  test('detached replacement renews before capture and structural grading keeps persisted fresh pins after cold load', async () => {
    const f = await reviewFixture();
    try {
      const before = await draftReview(f, await openReview(f, 'detached'));
      await f.store.markNodeSpawned('review-session', 'reviewed-node');
      await f.store.updateSessionState('review-session', 'reviewed-node', REVIEW_OUTPUT, {
        isPlaceholder: false,
      });
      await f.store.completeStep('review-session', 'reviewed-node');
      await f.store.advanceStep('review-session', 'reviewed-node');
      const submission = retainedVerdict(before);
      await reviewStage(f).execute(
        detachedContext(f, 'HANDOFF RESULT\nnode: reviewed-node', submission)
      );
      const waiting = f.store.getReview('review-session', 'reviewed-node');
      expect(waiting?.phase).toBe('awaiting-replacement');
      expect(waiting?.semanticContext?.attemptId).toBe(before.semanticContext?.attemptId);
      const replacement = 'Fresh detached answer 😀\nHANDOFF RESULT\nnode: reviewed-node';
      const grader = jest.fn(
        async (
          _context: ExecutionContext,
          sessionId: string,
          _node: unknown,
          review: GateReview | null
        ) => {
          if (review === null) throw new Error('Missing replacement review');
          expect(review.semanticContext?.target?.content).toBe(replacement);
          const graded = { ...review, retryHints: ['Structural finding retained'] };
          await f.store.setReview(sessionId, graded);
          return graded;
        }
      );
      const stage = new StepResponseCaptureStage(
        new GateVerdictProcessor(f.store, f.logger),
        new StepCaptureService(f.store, f.logger, f.records),
        f.store,
        new UnknownObservationProcessor(f.store, f.logger),
        f.logger,
        { gradeLateReport: grader }
      );
      await stage.execute(detachedContext(f, replacement));
      expect(grader).toHaveBeenCalledTimes(1);
      const captured = f.store.getReview('review-session', 'reviewed-node');
      expect(captured?.semanticContext?.attemptId).not.toBe(before.semanticContext?.attemptId);
      expect(captured?.semanticContext?.target).toEqual({
        kind: 'step_output',
        content: replacement,
        digest: hashBytes(replacement),
      });
      expect(captured?.semanticContext?.definitions).toEqual(before.semanticContext?.definitions);
      expect(captured?.retryHints).toEqual(['Structural finding retained']);
      expect(f.store.getSession('review-session')?.state.currentNodeId).toBe('current-node');
      expect(f.store.getReview('review-session', 'current-node')).toBeUndefined();
      const records = f.records.queryBySession('review-session', REVIEW_SCOPE);
      expect(records[0]?.gateVerdicts[0]?.evaluation).toEqual(submission.per_gate?.[0]?.evaluation);
      expect(records[1]?.nodeId).toBe('reviewed-node');
      await f.cold();
      expect(f.store.getReview('review-session', 'reviewed-node')?.semanticContext).toEqual(
        captured?.semanticContext
      );
      expect(f.records.queryBySession('review-session', REVIEW_SCOPE)[0]?.gateVerdicts).toEqual(
        records[0]?.gateVerdicts
      );
    } finally {
      await f.close();
    }
  });

  test('initial detached report opens a review bound to the already persisted output', async () => {
    const f = await reviewFixture();
    try {
      await openReview(f, 'detached');
      await f.store.clearReview('review-session', 'reviewed-node');
      await f.store.markNodeSpawned('review-session', 'reviewed-node');
      await f.store.updateSessionState('review-session', 'reviewed-node', 'Pending report', {
        isPlaceholder: true,
      });
      await f.store.completeStep('review-session', 'reviewed-node', { preservePlaceholder: true });
      await f.store.advanceStep('review-session', 'reviewed-node');
      const output = 'Initial detached output\nHANDOFF RESULT\nnode: reviewed-node';
      const context = detachedContext(f, output);
      context.state.gates.detachedReviewGateIds = { 1: [REVIEW_GATE.id] };
      await reviewStage(f).execute(context);
      const captured = f.store.getReview('review-session', 'reviewed-node');
      expect(captured?.semanticContext?.target).toEqual({
        kind: 'step_output',
        content: output,
        digest: hashBytes(output),
      });
      expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(output);
      expect(f.store.getSession('review-session')?.state.currentNodeId).toBe('current-node');
    } finally {
      await f.close();
    }
  });

  test('capture-first then verdict-only append keeps the output row and exact failed attempt separately', async () => {
    const f = await reviewFixture();
    try {
      await openReview(f);
      await reviewStage(f).execute(reviewContext(f, REVIEW_OUTPUT));
      const captured = f.store.getReview('review-session', 'reviewed-node');
      if (captured === undefined) throw new Error('Missing captured review');
      expect(captured.semanticContext?.target).toEqual({
        kind: 'step_output',
        content: REVIEW_OUTPUT,
        digest: hashBytes(REVIEW_OUTPUT),
      });
      const verdict = retainedVerdict(captured);
      await reviewStage(f).execute(reviewContext(f, undefined, verdict));
      const records = f.records.queryBySession('review-session', REVIEW_SCOPE);
      expect(records).toHaveLength(2);
      expect(records[0]?.gateVerdicts).toEqual([]);
      expect(records[1]?.gateVerdicts[0]?.evaluation).toEqual(verdict.per_gate?.[0]?.evaluation);
      expect(records[1]?.gateVerdicts[0]?.attempt).toBe(0);
      await f.cold();
      expect(
        f.records.queryBySession('review-session', REVIEW_SCOPE).map((row) => row.gateVerdicts)
      ).toEqual(records.map((row) => row.gateVerdicts));
    } finally {
      await f.close();
    }
  });

  test('actual detached stage appends rich verdict on reviewed node while run stands elsewhere', async () => {
    const f = await reviewFixture();
    try {
      const opened = await openReview(f, 'detached');
      await f.store.markNodeSpawned('review-session', 'reviewed-node');
      await f.store.updateSessionState('review-session', 'reviewed-node', REVIEW_OUTPUT, {
        isPlaceholder: false,
      });
      await f.store.completeStep('review-session', 'reviewed-node');
      await f.store.advanceStep('review-session', 'reviewed-node');
      const verdict = retainedVerdict(opened);
      const context = reviewContext(f, 'HANDOFF RESULT\nnode: reviewed-node', verdict);
      context.parsedCommand = {
        commandType: 'chain',
        promptId: 'draft',
        rawArgs: '',
        format: 'symbolic',
        confidence: 1,
        metadata: {
          originalCommand: '>>draft --> >>next',
          parseStrategy: 'fixture',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        chainId: 'review-chain#1',
        steps: [
          { stepNumber: 1, nodeId: 'reviewed-node', promptId: 'draft', args: {}, await: 'run' },
          { stepNumber: 2, nodeId: 'current-node', promptId: 'next', args: {} },
        ],
        promptArgs: {},
      };
      await reviewStage(f).execute(context);
      const records = f.records.queryBySession('review-session', REVIEW_SCOPE);
      expect(records).toHaveLength(1);
      expect(records[0]?.nodeId).toBe('reviewed-node');
      expect(records[0]?.stepNumber).toBe(1);
      expect(records[0]?.gateVerdicts[0]?.evaluation).toEqual(verdict.per_gate?.[0]?.evaluation);
      expect(f.store.getSession('review-session')?.state.currentNodeId).toBe('current-node');
      await f.cold();
      expect(f.records.queryBySession('review-session', REVIEW_SCOPE)[0]?.gateVerdicts).toEqual(
        records[0]?.gateVerdicts
      );
    } finally {
      await f.close();
    }
  });

  test.each([false, true])(
    'changed output replacement preserves the semantic attempt guard (semantic=%s)',
    async (semantic) => {
      const f = await reviewFixture();
      try {
        const opened = await openReview(f, 'detached');
        const issued = opened.semanticContext;
        if (issued === undefined) throw new Error('Missing issued review');
        const bound = semantic
          ? {
              ...opened,
              semanticContext: bindSemanticReviewTarget(
                createSemanticReviewContext(opened.nodeId, issued.attemptId, [
                  {
                    ...REVIEW_GATE,
                    pass_criteria: [
                      {
                        type: 'semantic_evaluation',
                        id: 'draft',
                        target: { kind: 'step_output' },
                        question: 'Is the captured output complete?',
                        evidence_requirements: { min_items: 1 },
                        result: { kind: 'boolean' },
                        acceptance: { kind: 'equals', value: true },
                      },
                    ],
                  },
                ]),
                REVIEW_OUTPUT
              ),
            }
          : opened;
        await f.store.setReview('review-session', bound);
        await f.store.updateSessionState('review-session', 'reviewed-node', REVIEW_OUTPUT, {
          isPlaceholder: false,
        });
        await f.store.completeStep('review-session', 'reviewed-node');
        const before = f.store.getChainContext('review-session')['step_results']?.[1];
        expect(before).toBe(REVIEW_OUTPUT);
        const context = reviewContext(f, 'replacement');
        const capture = new StepCaptureService(f.store, f.logger, f.records);
        const session = f.store.getSession('review-session');
        if (session === undefined) throw new Error('Missing capture session');
        const replace = () =>
          capture.recordDetachedReport(
            context,
            'review-session',
            session,
            { ordinal: 1, nodeId: 'reviewed-node' },
            'replacement'
          );
        if (semantic) {
          await expect(replace()).rejects.toThrow('fresh semantic review attempt');
          expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(before);
          expect(f.store.getReview('review-session', 'reviewed-node')?.semanticContext).toEqual(
            bound.semanticContext
          );
          expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toEqual([]);
        } else {
          await replace();
          expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(
            'replacement'
          );
          expect(
            f.store.getReview('review-session', 'reviewed-node')?.semanticContext?.target?.content
          ).toBe('replacement');
        }
      } finally {
        await f.close();
      }
    }
  );

  test('target binding persistence failure propagates without a successful capture ledger', async () => {
    const f = await reviewFixture();
    try {
      await openReview(f);
      const persist = jest
        .spyOn(f.store, 'setReview')
        .mockRejectedValueOnce(new Error('binding persistence failed'));
      await expect(reviewStage(f).execute(reviewContext(f, REVIEW_OUTPUT))).rejects.toThrow(
        'binding persistence failed'
      );
      persist.mockRestore();
      expect(
        f.store.getReview('review-session', 'reviewed-node')?.semanticContext?.target
      ).toBeUndefined();
      expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test.each(['updateSessionState', 'completeStep'] as const)(
    'false %s result cannot create ordinary capture authority, success ledger or advancement',
    async (method) => {
      const f = await reviewFixture();
      try {
        await openReview(f);
        const refuse = jest.spyOn(f.store, method).mockResolvedValueOnce(false);
        await expect(reviewStage(f).execute(reviewContext(f, REVIEW_OUTPUT))).rejects.toThrow(
          'refused'
        );
        expect(refuse.mock.calls[0]?.slice(0, 2)).toEqual(['review-session', 'reviewed-node']);
        refuse.mockRestore();
        expect(
          f.store.getReview('review-session', 'reviewed-node')?.semanticContext?.target
        ).toBeUndefined();
        expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toEqual([]);
        expect(f.store.getSession('review-session')?.state.currentNodeId).toBe('reviewed-node');
      } finally {
        await f.close();
      }
    }
  );

  test.each(['updateSessionState', 'completeStep'] as const)(
    'false %s result cannot rebind a detached node while another node is current',
    async (method) => {
      const f = await reviewFixture();
      try {
        const opened = await openReview(f, 'detached');
        await f.store.updateSessionState('review-session', 'reviewed-node', REVIEW_OUTPUT, {
          isPlaceholder: false,
        });
        await f.store.completeStep('review-session', 'reviewed-node');
        await f.store.advanceStep('review-session', 'reviewed-node');
        const refuse = jest.spyOn(f.store, method).mockResolvedValueOnce(false);
        const context = reviewContext(f, 'replacement');
        const session = f.store.getSession('review-session');
        if (session === undefined) throw new Error('Missing detached session');
        await expect(
          new StepCaptureService(f.store, f.logger, f.records).recordDetachedReport(
            context,
            'review-session',
            session,
            { ordinal: 1, nodeId: 'reviewed-node' },
            'replacement'
          )
        ).rejects.toThrow('refused');
        expect(refuse.mock.calls[0]?.slice(0, 2)).toEqual(['review-session', 'reviewed-node']);
        refuse.mockRestore();
        expect(f.store.getReview('review-session', 'reviewed-node')?.semanticContext).toEqual(
          opened.semanticContext
        );
        expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toEqual([]);
        expect(f.store.getSession('review-session')?.state.currentNodeId).toBe('current-node');
        if (method === 'completeStep') {
          // The output write completed before the refused completion. No atomic rollback claim.
          expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(
            'replacement'
          );
        } else {
          expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(
            REVIEW_OUTPUT
          );
        }
      } finally {
        await f.close();
      }
    }
  );
});

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * Build a DatabasePort-conformant adapter over a real :memory: DatabaseSync.
 * Schema mirrors sqlite-engine.ts:405-423 so drift between this test and the
 * production CREATE TABLE will surface as a SQL error.
 */
const createInMemoryDb = (): { db: DatabaseSync; port: DatabasePort } => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE execution_records (
      execution_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      organization_id TEXT,
      workspace_id TEXT,
      session_id TEXT NOT NULL,
      chain_id TEXT,
      step_number INTEGER,
      node_id TEXT,
      prompt_id TEXT,
      status TEXT NOT NULL,
      substate_json TEXT,
      input_required_json TEXT,
      evidence_json TEXT,
      gate_verdicts_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      steps_planned INTEGER,
      gates_fired INTEGER,
      gate_retries INTEGER,
      unknowns_opened INTEGER,
      unknowns_closed INTEGER,
      nodes_inserted INTEGER,
      nodes_skipped INTEGER,
      interrupts_raised INTEGER,
      remainders_accepted INTEGER,
      handoff_evidence TEXT CHECK (
        handoff_evidence IS NULL
        OR handoff_evidence IN ('ok', 'trailer', 'node-line', 'node-mismatch')
      ),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_execution_records_session ON execution_records(session_id);
    CREATE INDEX idx_execution_records_chain ON execution_records(chain_id);
  `);

  const port: DatabasePort = {
    isInitialized: () => true,
    initialize: async () => undefined,
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] => {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...((params ?? []) as never[]));
      return rows as T[];
    },
    queryOne: <T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null => {
      const stmt = db.prepare(sql);
      const row = stmt.get(...((params ?? []) as never[]));
      return (row ?? null) as T | null;
    },
    run: (sql: string, params?: unknown[]): void => {
      const stmt = db.prepare(sql);
      stmt.run(...((params ?? []) as never[]));
    },
    transaction: async <T>(fn: () => T | Promise<T>): Promise<T> => {
      db.exec('BEGIN');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    beginTransaction: () => db.exec('BEGIN'),
    commit: () => db.exec('COMMIT'),
    rollback: () => db.exec('ROLLBACK'),
  };

  return { db, port };
};

describe('ExecutionRecordStore (integration)', () => {
  let db: DatabaseSync;
  let port: DatabasePort;
  let store: ExecutionRecordStore;

  beforeEach(() => {
    const fixture = createInMemoryDb();
    db = fixture.db;
    port = fixture.port;
    store = new ExecutionRecordStore(port, createLogger());
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore close errors on teardown
    }
  });

  test('AC1+AC2: append() persists a step-level record with full field round-trip', () => {
    const renderedAt = Date.now();
    const executionId = store.append({
      sessionId: 'sess-int-1',
      chainId: 'chain-research#1',
      stepNumber: 1,
      promptId: 'analysis_report',
      status: 'working',
      substate: { renderedAt },
      startedAt: renderedAt,
    });

    expect(executionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const records = store.queryBySession('sess-int-1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      executionId,
      sessionId: 'sess-int-1',
      chainId: 'chain-research#1',
      stepNumber: 1,
      promptId: 'analysis_report',
      status: 'working',
      substate: { renderedAt },
      startedAt: renderedAt,
      gateVerdicts: [],
    });
    expect(records[0].completedAt).toBeUndefined();
    expect(records[0].errorMessage).toBeUndefined();
  });

  test('AC1: StepExecutionStage-style per-step + ResponseFormattingStage-style chain-terminal records both persist', () => {
    const t1 = Date.now();
    const t2 = t1 + 10;
    const t3 = t2 + 10;

    // Two step-level records (StepExecutionStage emission shape)
    store.append({
      sessionId: 'sess-multi',
      chainId: 'chain-multi#1',
      stepNumber: 1,
      promptId: 'step-one',
      status: 'working',
      substate: { renderedAt: t1 },
      startedAt: t1,
    });
    store.append({
      sessionId: 'sess-multi',
      chainId: 'chain-multi#1',
      stepNumber: 2,
      promptId: 'step-two',
      status: 'working',
      substate: { renderedAt: t2 },
      startedAt: t2,
    });
    // Chain-terminal record (ResponseFormattingStage emission shape — no stepNumber/promptId)
    store.append({
      sessionId: 'sess-multi',
      chainId: 'chain-multi#1',
      status: 'completed',
      startedAt: t3,
      completedAt: t3,
    });

    const records = store.queryBySession('sess-multi');
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.status)).toEqual(['working', 'working', 'completed']);
    expect(records.map((r) => r.stepNumber)).toEqual([1, 2, undefined]);

    // Chain-terminal has completedAt set, step-level records do not
    expect(records[2].completedAt).toBe(t3);
    expect(records[0].completedAt).toBeUndefined();
    expect(records[1].completedAt).toBeUndefined();
  });

  test('AC3: ULID ordering preserves insertion order via queryBySession', () => {
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      ids.push(
        store.append({
          sessionId: 'sess-order',
          chainId: 'chain-order#1',
          stepNumber: i,
          status: 'working',
          startedAt: Date.now() + i,
        })
      );
    }

    const records = store.queryBySession('sess-order');
    expect(records.map((r) => r.executionId)).toEqual(ids);
    expect(records.map((r) => r.stepNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  // P6.121 / R55: the pipeline tells a run's earlier records from its own call's by this id.
  test('watermark() sorts after every record appended before it and before every one after', () => {
    const append = (stepNumber: number) =>
      store.append({ sessionId: 'sess-mark', stepNumber, status: 'working' });
    const before = [append(1), append(2)];
    const mark = store.watermark();
    const after = [append(3), append(4)];

    const ids = store.queryBySession('sess-mark').map((record) => record.executionId);
    expect(ids.filter((id) => id < mark)).toEqual(before);
    expect(ids.filter((id) => id > mark)).toEqual(after);
    expect(ids).not.toContain(mark);
  });

  test('AC4: queryByChain returns same records as queryBySession via different key', () => {
    store.append({
      sessionId: 'sess-by-chain',
      chainId: 'chain-x#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now(),
    });
    store.append({
      sessionId: 'sess-by-chain',
      chainId: 'chain-x#1',
      status: 'completed',
      startedAt: Date.now() + 1,
      completedAt: Date.now() + 1,
    });

    const bySession = store.queryBySession('sess-by-chain');
    const byChain = store.queryByChain('chain-x#1');

    expect(byChain).toHaveLength(2);
    expect(byChain.map((r) => r.executionId)).toEqual(bySession.map((r) => r.executionId));
  });

  test('AC5: scope (organization_id/workspace_id) round-trips through append + query', () => {
    store.append({
      sessionId: 'sess-scoped',
      chainId: 'chain-scoped#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now(),
      scope: {
        continuityScopeId: 'tenant-acme',
        organizationId: 'org-acme',
        workspaceId: 'workspace-prod',
      },
    });

    const records = store.queryBySession('sess-scoped', {
      continuityScopeId: 'tenant-acme',
    });

    expect(records).toHaveLength(1);
    expect(records[0].organizationId).toBe('org-acme');
    expect(records[0].workspaceId).toBe('workspace-prod');
  });

  test('AC5: queries are tenant-isolated — other tenants do not see this scope’s records', () => {
    store.append({
      sessionId: 'sess-shared-id',
      chainId: 'chain-shared#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now(),
      scope: { continuityScopeId: 'tenant-a' },
    });
    store.append({
      sessionId: 'sess-shared-id',
      chainId: 'chain-shared#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now() + 1,
      scope: { continuityScopeId: 'tenant-b' },
    });

    const tenantA = store.queryBySession('sess-shared-id', { continuityScopeId: 'tenant-a' });
    const tenantB = store.queryBySession('sess-shared-id', { continuityScopeId: 'tenant-b' });

    expect(tenantA).toHaveLength(1);
    expect(tenantB).toHaveLength(1);
    expect(tenantA[0].executionId).not.toBe(tenantB[0].executionId);
  });

  test('append is best-effort — SQL failures log warn but do not throw', () => {
    db.close();
    const warnLogger = createLogger();
    const resilientStore = new ExecutionRecordStore(port, warnLogger);

    // After closing the underlying DB, run() will throw inside the port; the
    // store must absorb the error so emission cannot break pipeline execution.
    expect(() =>
      resilientStore.append({
        sessionId: 'sess-after-close',
        status: 'working',
        startedAt: Date.now(),
      })
    ).not.toThrow();

    expect(warnLogger.warn).toHaveBeenCalled();
  });

  /**
   * Tier 3.1 — the reader half of the ledger. Before this, execution_records had a
   * writer and no caller: queryBySession/queryByChain had zero call sites across
   * src/, hooks/ and cli/.
   */
  describe('queryRecent', () => {
    test('returns records newest-first by ULID order', () => {
      store.append({ sessionId: 'sess-a', status: 'working', startedAt: 1 });
      store.append({ sessionId: 'sess-b', status: 'working', startedAt: 2 });
      store.append({ sessionId: 'sess-c', status: 'completed', startedAt: 3 });

      const recent = store.queryRecent();

      expect(recent).toHaveLength(3);
      expect(recent.map((r) => r.sessionId)).toEqual(['sess-c', 'sess-b', 'sess-a']);
    });

    test('orders by execution_id, so records sharing a timestamp still sort deterministically', () => {
      // All three share startedAt — a timestamp sort could return any permutation.
      // ULIDs are monotonic, which is why queryRecent orders by execution_id instead.
      const sharedTs = 42;
      const ids = [
        store.append({ sessionId: 's1', status: 'working', startedAt: sharedTs }),
        store.append({ sessionId: 's2', status: 'working', startedAt: sharedTs }),
        store.append({ sessionId: 's3', status: 'working', startedAt: sharedTs }),
      ];

      const recent = store.queryRecent();

      expect(recent.map((r) => r.executionId)).toEqual([...ids].reverse());
    });

    test('honours an explicit limit', () => {
      for (let i = 0; i < 10; i += 1) {
        store.append({ sessionId: `sess-${i}`, status: 'working', startedAt: i });
      }

      expect(store.queryRecent(3)).toHaveLength(3);
    });

    test('clamps a limit above the ceiling instead of reading the whole ledger', () => {
      // Seeded past MAX_RECENT_LIMIT (500) deliberately: with fewer rows than the
      // ceiling this assertion would pass whether or not the clamp exists, and a
      // test that cannot fail proves nothing. execution_records has no retention
      // policy, so an unbounded read is a real risk rather than a hypothetical.
      for (let i = 0; i < 520; i += 1) {
        store.append({ sessionId: `sess-${i}`, status: 'working', startedAt: i });
      }

      expect(store.queryRecent(10_000)).toHaveLength(500);
    });

    test('coerces a non-positive or non-finite limit rather than emitting invalid SQL', () => {
      store.append({ sessionId: 'sess-only', status: 'completed', startedAt: 1 });

      expect(store.queryRecent(0)).toHaveLength(1);
      expect(store.queryRecent(-5)).toHaveLength(1);
      expect(store.queryRecent(Number.NaN)).toHaveLength(1);
    });

    test('excludes rows belonging to another scope', () => {
      store.append({
        sessionId: 'sess-mine',
        status: 'working',
        startedAt: 1,
        scope: { continuityScopeId: 'workspace-a' },
      });
      store.append({
        sessionId: 'sess-theirs',
        status: 'working',
        startedAt: 2,
        scope: { continuityScopeId: 'workspace-b' },
      });

      const mine = store.queryRecent(50, { continuityScopeId: 'workspace-a' });

      expect(mine).toHaveLength(1);
      expect(mine[0]?.sessionId).toBe('sess-mine');
    });

    test('returns an empty array when the ledger holds nothing for the scope', () => {
      expect(store.queryRecent()).toEqual([]);
    });
  });
});

/** Only canonical issuer definitions cross the Jest clone boundary; malformed data stays raw. */
describe('issued-review test clone boundary fidelity', () => {
  test.each(['nonplain', 'cycle', 'undefined', 'inconsistent-digest'] as const)(
    '%s authority remains unlaundered and source-rejected',
    (issue) => {
      const issued = createSemanticReviewContext('fidelity-node', 'fidelity-attempt', [
        REVIEW_GATE,
      ]);
      const original = issued.definitions[REVIEW_GATE.id];
      if (original === undefined) throw new Error('Missing fidelity issuer');
      let definition: unknown = original.definition;
      if (issue === 'nonplain') {
        class ForeignDefinition {
          readonly id = REVIEW_GATE.id;
        }
        definition = new ForeignDefinition();
      }
      if (issue === 'cycle') {
        const cyclic: Record<string, unknown> = { id: REVIEW_GATE.id };
        cyclic['self'] = cyclic;
        definition = cyclic;
      }
      if (issue === 'undefined')
        definition = { ...original.definition, pass_criteria: [undefined] };
      const corrupt = {
        ...issued,
        definitions: {
          [REVIEW_GATE.id]: {
            ...original,
            definition,
            definitionDigest:
              issue === 'inconsistent-digest'
                ? hashBytes('wrong issuer digest')
                : original.definitionDigest,
          },
        },
      };
      const shared = { retained: true };
      const value = {
        semanticContext: corrupt,
        map: new Map([['value', 7]]),
        date: new Date(42),
        optional: undefined,
        first: shared,
        second: shared,
      };
      const raw = issuedCloneFixture.nativeClone(value);
      const cloned = structuredClone(value);
      expect(cloned).toEqual(raw);
      expect(cloned.first).toBe(cloned.second);
      expect(cloned.first).not.toBe(shared);
      expect(Object.getPrototypeOf(cloned.map)).toBe(Object.getPrototypeOf(raw.map));
      expect(cloned.map.get('value')).toBe(7);
      expect(cloned.date.getTime()).toBe(42);
      expect(cloned).toHaveProperty('optional', undefined);
      expect(cloned.semanticContext.definitions[REVIEW_GATE.id].definitionDigest).toBe(
        corrupt.definitions[REVIEW_GATE.id].definitionDigest
      );
      expect(() =>
        Reflect.apply(resolveFrozenReviewDefinition, undefined, [
          cloned.semanticContext,
          REVIEW_GATE.id,
        ])
      ).toThrow();
    }
  );
});
