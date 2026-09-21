#!/usr/bin/env node

/**
 * Flags an event a consumer can register for that nothing in the codebase ever emits.
 *
 * THE DECLARED-BUT-NEVER-CONSUMED FAMILY, layer 1c: EVENT. The charter and the full layer
 * ordering live in `validate-state-field-writers.js`; this member owns the layer between
 * METHOD and FIELD, and it exists because no other member could see its motivating instance.
 *
 * WHY `validate:unreached-methods` does not cover it. Two reasons, and the second is the one
 * that matters:
 *
 *   1. It carries a baseline of accepted debt, and `HookRegistry.emitStepComplete`,
 *      `emitChainComplete`, `emitChainFailed` plus three `McpNotificationEmitter.emit*` methods
 *      sat in it with no recorded reason (measured on `8c991b16`).
 *   2. Its reachability question is "is this called from anywhere", and for a fan-out point the
 *      answer is yes from inside itself. `HookRegistry.emitChainComplete` reads
 *      `hooks.onChainComplete` in its own body, so the CONSUMER side looks reached; and a
 *      consumer registered through `registerChainHooks` looks wired because registration is a
 *      real call. Registered read as wired for months while no client received a single chain
 *      notification.
 *
 * THE PREDICATE, which is deliberately narrower than "has a caller": an emission must have a
 * PRODUCER — a call site in a layer that owns a fact worth announcing, which means anywhere
 * outside `src/infra/`. A call from inside the fan-out point's own layer is the fan-out talking
 * to itself and proves nothing about whether the event ever fires. `tests/` is excluded for the
 * same reason `validate:state-field-writers` excludes it: a call that only a fixture makes is
 * exactly the condition being detected.
 *
 * EDGES, NOT NAMES. `validate-registry-coherence.js` records that name-keyed checks in this repo
 * were wrong 3/3, so nothing here matches `onX` against `emitX` by string. The emission set is
 * read off the declarations themselves and every call site is resolved through the type checker,
 * so a same-named method on an unrelated class is not a producer. The self-test plants exactly
 * that decoy.
 *
 * ITS BLIND SPOT, stated rather than implied: this asks whether an emission has a producer, not
 * whether that producer RUNS. Deleting the call to the private announcer while leaving the
 * announcer's body intact passes here — measured, not assumed, while wiring this up. That is the
 * runtime-reachability class the charter assigns to the `reached` pre-flight probe, and it is
 * covered for these six emissions by
 * `tests/integration/hooks/chain-lifecycle-emission.integration.test.ts`, which observes each
 * event arriving after a real chain is driven. Both gates are needed; neither subsumes the other.
 *
 * Usage:
 *   node scripts/validate-hook-producers.js
 *   node scripts/validate-hook-producers.js --json
 *   node scripts/validate-hook-producers.js --self-test
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');

/**
 * The fan-out surfaces whose emissions need producers.
 *
 * Each names the concrete class and the port interface that declares the same surface. Both are
 * scanned because a call site may hold either type: `engine/` holds these values as the port,
 * while `runtime/` holds the concrete class.
 */
const WATCHED = [
  {
    label: 'HookRegistry',
    classFile: 'src/infra/hooks/hook-registry.ts',
    className: 'HookRegistry',
    portFile: 'src/shared/types/index.ts',
    portName: 'HookRegistryPort',
  },
  {
    label: 'McpNotificationEmitter',
    classFile: 'src/infra/observability/notifications/mcp-notification-emitter.ts',
    className: 'McpNotificationEmitter',
    portFile: 'src/shared/types/index.ts',
    portName: 'McpNotificationEmitterPort',
  },
];

/** The layer a fan-out point lives in; a call from inside it is not a producer. */
const FAN_OUT_LAYER = `${path.sep}src${path.sep}infra${path.sep}`;

const isEmission = (name) => /^emit[A-Z]/.test(name);

/**
 * True when this reference node is the callee of a call expression.
 *
 * A bare mention — passing the method as a value, or naming it in a type position — is not a
 * producer: it does not make the event fire.
 */
function isCallPosition(node) {
  const parent = node.getParent();
  if (parent === undefined) return false;

  const kind = parent.getKind();
  if (kind === SyntaxKind.PropertyAccessExpression || kind === SyntaxKind.ElementAccessExpression) {
    const call = parent.getParent();
    if (call?.getKind() === SyntaxKind.CallExpression) {
      return call.getExpression() === parent;
    }
    // `hooks?.emitX(...)` parses the optional call as a CallExpression whose expression is the
    // property access, so the branch above already covers it; a non-null assertion wraps it.
    if (call?.getKind() === SyntaxKind.NonNullExpression) {
      const outer = call.getParent();
      return outer?.getKind() === SyntaxKind.CallExpression && outer.getExpression() === call;
    }
  }
  return false;
}

/** The producer call sites of one emission, as repo-relative paths. */
function producersOf(declarations, rootDir) {
  const producers = new Set();

  for (const declaration of declarations) {
    for (const reference of declaration.findReferencesAsNodes()) {
      const filePath = reference.getSourceFile().getFilePath();
      if (filePath.includes(`${path.sep}tests${path.sep}`)) continue;
      if (filePath.includes(FAN_OUT_LAYER)) continue;
      if (!isCallPosition(reference)) continue;
      producers.add(path.relative(rootDir, filePath));
    }
  }

  return [...producers].sort();
}

/**
 * Pair each emission on a watched surface with its declarations (class method + port member).
 */
function collectEmissions(project, watched, rootDir, allowMissing) {
  const classSource = project.getSourceFile(path.join(rootDir, watched.classFile));
  const portSource = project.getSourceFile(path.join(rootDir, watched.portFile));

  if (classSource === undefined || portSource === undefined) {
    if (allowMissing) return null;
    throw new Error(`[hook-producers] Watched file missing for ${watched.label}`);
  }

  const classDeclaration = classSource.getClass(watched.className);
  const portDeclaration = portSource.getInterface(watched.portName);

  if (classDeclaration === undefined || portDeclaration === undefined) {
    if (allowMissing) return null;
    throw new Error(
      `[hook-producers] Watched declaration missing: ${watched.className}/${watched.portName}`
    );
  }

  const emissions = new Map();

  for (const method of classDeclaration.getMethods()) {
    const name = method.getName();
    if (!isEmission(name)) continue;
    emissions.set(name, [method]);
  }
  for (const member of portDeclaration.getMethods()) {
    const name = member.getName();
    if (!isEmission(name)) continue;
    emissions.set(name, [...(emissions.get(name) ?? []), member]);
  }

  return emissions;
}

function runSelfTest() {
  const project = new Project({ useInMemoryFileSystem: true });

  // The fan-out point and its port, both under `src/infra/`-shaped paths.
  project.createSourceFile(
    '/src/shared/types/index.ts',
    `export interface FanOutPort {
       emitWired(value: string): void;
       emitOrphan(value: string): void;
     }`
  );
  project.createSourceFile(
    '/src/infra/hooks/fan-out.ts',
    `import type { FanOutPort } from '../../shared/types/index.js';
     export class FanOut implements FanOutPort {
       emitWired(value: string): void { void value; }
       emitOrphan(value: string): void { void value; }
       selfCall(): void { this.emitOrphan('from inside the fan-out layer'); }
     }`
  );
  // A real producer, outside the fan-out layer.
  project.createSourceFile(
    '/src/engine/producer.ts',
    `import type { FanOutPort } from '../shared/types/index.js';
     export function announce(port: FanOutPort): void { port.emitWired('real'); }`
  );
  // The decoy: a same-named method on an unrelated class, called from outside the fan-out
  // layer. Name matching would read this as a producer for FanOut.emitOrphan.
  project.createSourceFile(
    '/src/engine/decoy.ts',
    `export class Unrelated { emitOrphan(value: string): void { void value; } }
     export function useDecoy(u: Unrelated): void { u.emitOrphan('not the watched surface'); }`
  );
  // A test-only caller, which must not rescue the orphan either.
  project.createSourceFile(
    '/tests/fan-out.test.ts',
    `import { FanOut } from '../src/infra/hooks/fan-out.js';
     export const drive = (f: FanOut): void => f.emitOrphan('fixture only');`
  );

  const emissions = collectEmissions(
    project,
    {
      label: 'FanOut',
      classFile: 'src/infra/hooks/fan-out.ts',
      className: 'FanOut',
      portFile: 'src/shared/types/index.ts',
      portName: 'FanOutPort',
    },
    '/',
    false
  );

  const flagged = [...emissions.entries()]
    .filter(([, declarations]) => producersOf(declarations, '/').length === 0)
    .map(([name]) => name)
    .sort();

  const failures = [];
  if (JSON.stringify(flagged) !== JSON.stringify(['emitOrphan'])) {
    failures.push(`expected ["emitOrphan"], flagged ${JSON.stringify(flagged)}`);
  }
  if (emissions.size !== 2) {
    failures.push(`expected 2 emissions collected, got ${emissions.size}`);
  }

  if (failures.length > 0) {
    console.error('[hook-producers] SELF-TEST FAILED:');
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    'validate:hook-producers self-test OK — flags an emission whose only callers are the ' +
      'fan-out layer itself and a test fixture, is not rescued by a same-named method on an ' +
      'unrelated class, and passes one with a real producer.'
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const jsonOutput = args.includes('--json');
  const allowMissing = args.includes('--allow-missing');

  const project = new Project({
    tsConfigFilePath: path.join(serverDir, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  const findings = [];
  const scanned = [];

  for (const watched of WATCHED) {
    const emissions = collectEmissions(project, watched, serverDir, allowMissing);
    if (emissions === null) continue;

    scanned.push({ surface: watched.label, emissions: emissions.size });

    for (const [name, declarations] of emissions) {
      const producers = producersOf(declarations, serverDir);
      if (producers.length === 0) {
        findings.push({ surface: watched.label, emission: name });
      }
    }
  }

  // A green run must not be a run that scanned nothing.
  if (scanned.length === 0 || scanned.some((entry) => entry.emissions === 0)) {
    console.error('[hook-producers] Scanned no emissions — the watched surfaces moved or renamed.');
    process.exitCode = 1;
    return;
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ scanned, findings }, null, 2));
    process.exitCode = findings.length > 0 ? 1 : 0;
    return;
  }

  if (findings.length > 0) {
    console.error('[hook-producers] Emissions with a consumer and no producer:');
    for (const finding of findings) {
      console.error(`  - ${finding.surface}.${finding.emission}`);
    }
    console.error(
      '\nA consumer can register for these events and nothing will ever fire them. Emit each ' +
        'one where the owning service decides the fact, or delete the emission and every ' +
        'consumer key that pairs with it.'
    );
    process.exitCode = 1;
    return;
  }

  const total = scanned.reduce((sum, entry) => sum + entry.emissions, 0);
  console.log(
    `✅ validate:hook-producers — ${total} emissions across ${scanned.length} surfaces, each ` +
      'with at least one producer outside the fan-out layer.'
  );
}

main();
