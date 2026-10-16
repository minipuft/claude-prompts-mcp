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

/**
 * P6.190 (R93). Side effects a snapshot cannot undo: a callback that fired, history or a step
 * result written to another store, a hook or notification sent. A persisting method may reach one
 * only AFTER its `persistMutation`, or a rejected save leaves the effect behind a rolled-back run.
 * Named by channel, and closed over `this.<method>` calls, so a helper that reaches one counts.
 */
const IRREVERSIBLE_METHODS = new Set(['notifyRunEnded', 'notifySessionCleared']);
const IRREVERSIBLE_CHANNELS: Record<string, ReadonlySet<string> | 'any'> = {
  textReferenceStore: new Set(['storeChainStepResult', 'clearChainStepResults']),
  argumentHistoryTracker: new Set(['trackExecution', 'clearSession']),
  hookRegistry: 'any',
  notificationEmitter: 'any',
};

/** `this.<channel>.<name>(…)` calls in `node` that reach an irreversible channel. */
function effectCalls(node: ts.Node): Array<{ name: string; pos: number }> {
  const calls: Array<{ name: string; pos: number }> = [];
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      ts.isPropertyAccessExpression(child.expression.expression) &&
      child.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const channel = child.expression.expression.name.text;
      const method = child.expression.name.text;
      const allowed = IRREVERSIBLE_CHANNELS[channel];
      if (allowed === 'any' || allowed?.has(method) === true) {
        calls.push({ name: `${channel}.${method}`, pos: child.getStart() });
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return calls;
}

/** Every persisting method reaching an irreversible effect before its persist. */
function auditEffectOrder(source: string): string[] {
  const file = ts.createSourceFile('manager.ts', source, ts.ScriptTarget.Latest, true);
  const bodies = new Map<string, ts.Node>();
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === 'ChainSessionStore') {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.body !== undefined) {
          bodies.set(member.name.getText(file), member.body);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  const irreversible = new Set(IRREVERSIBLE_METHODS);
  for (const [name, body] of bodies) if (effectCalls(body).length > 0) irreversible.add(name);
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, body] of bodies) {
      if (irreversible.has(name)) continue;
      if (thisCalls(body).some((call) => irreversible.has(call.name))) {
        irreversible.add(name);
        grew = true;
      }
    }
  }

  const violations: string[] = [];
  for (const [name, body] of bodies) {
    const persist = thisCalls(body).find((call) => call.name === 'persistMutation');
    if (persist === undefined) continue;
    const early = [
      ...thisCalls(body).filter((call) => irreversible.has(call.name)),
      ...effectCalls(body),
    ].filter((call) => call.pos < persist.pos);
    for (const call of early) violations.push(`${name}: ${call.name} runs before the persist`);
  }
  return violations.sort();
}

/**
 * T1.4a. A persisting method calls `this.admitWork` before its `persistMutation` with no `await`
 * between, or a pause arriving at the await slips in. Methods that do not admit are named here.
 */
const ADMISSION_EXEMPT: Record<string, string> = {
  cancelChain: 'abort is whole-run control, never refused by admission; its persist counts as work',
  claimHandoff: 'a claim loads a run minted elsewhere; a paused claim is stored as held, unedited',
  clearSession: 'removing a run must succeed whether or not it is paused',
  clearSessionsForChain: 'removing a run must succeed whether or not it is paused',
  createSession: 'creates a run that no pause or control can hold yet',
};

/** Whether an `await` other than the persist's own starts between `from` and `to` in `node`. */
function awaitBetween(node: ts.Node, from: number, to: number): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    const own =
      ts.isAwaitExpression(child) && child.expression.getText().includes('persistMutation(');
    if (ts.isAwaitExpression(child) && !own && child.getStart() > from && child.getStart() < to) {
      found = true;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** Every persisting method that admits no work, or lets an `await` stand between admit and persist. */
function auditAdmission(source: string): string[] {
  const file = ts.createSourceFile('manager.ts', source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === 'ChainSessionStore') {
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || member.body === undefined) continue;
        const name = member.name.getText(file);
        const calls = thisCalls(member.body);
        const persist = calls.find((call) => call.name === 'persistMutation');
        if (persist === undefined || name in ADMISSION_EXEMPT) continue;
        const admit = calls.find((call) => call.name === 'admitWork');
        if (admit === undefined || admit.pos > persist.pos) {
          violations.push(`${name}: persists with no admitWork before it`);
        } else if (awaitBetween(member.body, admit.pos, persist.pos)) {
          violations.push(`${name}: an await stands between admitWork and persistMutation`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations.sort();
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

describe('P6.190: nothing a snapshot cannot undo runs before the persist', () => {
  const plant = (method: string): string =>
    source.replace(
      /export class ChainSessionStore[^{]*\{/,
      (opening) => `${opening}\n  ${method}\n`
    );

  test('every persisting method releases, notifies and records only after its persist', () => {
    expect(auditEffectOrder(source)).toEqual([]);
  });

  test('planted control: a callback fired before the persist is reported', () => {
    const planted = plant(
      "async plantedEarly(s: any): Promise<void> { this.notifyRunEnded('x'); const snap = this.snapshotRunMembership(); await this.persistMutation(snap); }"
    );
    expect(auditEffectOrder(planted)).toEqual([
      'plantedEarly: notifyRunEnded runs before the persist',
    ]);
  });

  test('planted control: an effect reached through a helper is reported', () => {
    const planted = plant(
      "private plantedHelper(): void { this.textReferenceStore.clearChainStepResults('c'); }\n  async plantedIndirect(): Promise<void> { const snap = this.snapshotRunMembership(); this.plantedHelper(); await this.persistMutation(snap); }"
    );
    expect(auditEffectOrder(planted)).toEqual([
      'plantedIndirect: plantedHelper runs before the persist',
    ]);
  });
});

describe('T1.4a: work is admitted in the same synchronous step as its persist', () => {
  const plant = (method: string): string =>
    source.replace(/export class ChainSessionStore[^{]*\{/, (open) => `${open}\n  ${method}\n`);

  test('every persisting method admits before it persists, with no await between', () => {
    expect(auditAdmission(source)).toEqual([]);
    const mutators = auditPersists(source).mutators;
    expect(Object.keys(ADMISSION_EXEMPT).filter((name) => !mutators.includes(name))).toEqual([]);
  });

  test('planted control: a mutator persisting with no admission is reported', () => {
    const planted = plant(
      'async plantedOpen(): Promise<void> { const snap = this.snapshotRunMembership(); await this.persistMutation(snap); }'
    );
    expect(auditAdmission(planted)).toEqual(['plantedOpen: persists with no admitWork before it']);
  });

  test('planted control: an await between admit and persist is reported', () => {
    const planted = plant(
      'async plantedGap(s: any): Promise<void> { this.admitWork(s); await Promise.resolve(); const snap = this.snapshotRunMembership(); await this.persistMutation(snap); }'
    );
    expect(auditAdmission(planted)).toEqual([
      'plantedGap: an await stands between admitWork and persistMutation',
    ]);
  });
});
