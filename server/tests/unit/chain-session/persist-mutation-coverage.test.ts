// @lifecycle canonical - P6.185: every awaited ChainSessionStore mutator persists through persistMutation.
/**
 * MEASURED 2026-09-27 on `55c4d0fb`: the 23 awaited mutators of `ChainSessionStore` wrote memory and
 * then awaited a persist that throws (R74), so a rejected save left memory ahead of the rows and a
 * retry answered from memory. R87 gives the pattern one owner, `persistMutation`, which restores
 * the mutator's snapshot before rethrowing. This test holds the class: every method that persists
 * does so through `persistMutation`, having taken a snapshot first, and no method but the persist
 * machinery itself calls a raw persist. The planted controls prove the check reports a bypass and
 * a missing snapshot.
 */
import { describe, expect, test } from '@jest/globals';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const MANAGER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/modules/chains/manager.ts'
);

/** Persist entry points below `persistMutation`; only the persist machinery may call them. */
const RAW_PERSISTS = new Set(['saveSessions', 'persistSessions', 'persistSessionsOrThrow']);
const SNAPSHOTS = new Set(['snapshotRun', 'snapshotRunMembership']);
/** The persist machinery, and the two background persists no client waits on (P6.175). */
const MACHINERY = new Set([
  'saveSessions',
  'persistSessions',
  'persistSessionsOrThrow',
  'persistMutation',
  'persistSessionsAsync',
  'cleanup',
]);

/** Every `this.<name>(…)` call in `node`, in source order. */
function thisCalls(node: ts.Node): Array<{ name: string; pos: number }> {
  const calls: Array<{ name: string; pos: number }> = [];
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      child.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      calls.push({ name: child.expression.name.text, pos: child.getStart() });
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return calls;
}

/** The mutators persisting through `persistMutation`, and every method breaking the pattern. */
function auditPersists(source: string): { mutators: string[]; violations: string[] } {
  const file = ts.createSourceFile('manager.ts', source, ts.ScriptTarget.Latest, true);
  const mutators: string[] = [];
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === 'ChainSessionStore') {
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || member.body === undefined) continue;
        const name = member.name.getText(file);
        if (MACHINERY.has(name)) continue;
        const calls = thisCalls(member.body);
        const raw = calls.filter((call) => RAW_PERSISTS.has(call.name));
        if (raw.length > 0) violations.push(`${name}: calls ${raw[0]!.name} directly`);
        const persist = calls.find((call) => call.name === 'persistMutation');
        if (persist === undefined) continue;
        mutators.push(name);
        const snapshot = calls.find((call) => SNAPSHOTS.has(call.name));
        if (snapshot === undefined || snapshot.pos > persist.pos) {
          violations.push(`${name}: persists with no snapshot taken before it`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { mutators: mutators.sort(), violations };
}

const source = readFileSync(MANAGER, 'utf8');

describe('P6.185: every awaited mutator persists through persistMutation', () => {
  test('no method bypasses it, and each takes a snapshot first', () => {
    expect(auditPersists(source).violations).toEqual([]);
  });

  test('the awaited mutators, as one list', () => {
    expect(auditPersists(source).mutators).toEqual([
      'advanceStep',
      'applyUnknownObservations',
      'cancelChain',
      'claimHandoff',
      'clearPendingGateReview',
      'clearPendingShellVerification',
      'clearReview',
      'clearSession',
      'clearSessionsForChain',
      'completeStep',
      'createSession',
      'insertNodeAfter',
      'markNodeSkipped',
      'markNodeSpawned',
      'mintHandoffToken',
      'recordGateReviewOutcome',
      'remapRunGates',
      'replaceRemainder',
      'setPendingShellVerification',
      'setReview',
      'transitionRunStatus',
      'transitionStepState',
      'updateSessionState',
    ]);
  });

  const plant = (method: string): string =>
    source.replace(
      /export class ChainSessionStore[^{]*\{/,
      (opening) => `${opening}\n  ${method}\n`
    );

  test('planted control: a mutator calling a raw persist is reported', () => {
    const planted = plant('async plantedBypass(): Promise<void> { await this.saveSessions(); }');
    expect(planted).not.toBe(source);
    expect(auditPersists(planted).violations).toEqual([
      'plantedBypass: calls saveSessions directly',
    ]);
  });

  test('planted control: a mutator persisting with no snapshot is reported', () => {
    const planted = plant(
      'async plantedBlind(s: any): Promise<void> { await this.persistMutation(s); }'
    );
    expect(auditPersists(planted).violations).toEqual([
      'plantedBlind: persists with no snapshot taken before it',
    ]);
  });
});
