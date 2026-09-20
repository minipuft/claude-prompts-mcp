/**
 * Row B.53: every mutator on a scoped state store must take a scope.
 *
 * `state.db` is shared across projects and `kv_state` rows are keyed by continuity scope, so
 * one process serving several workspaces over HTTP writes one row per workspace. A mutator
 * that takes no scope writes the launch workspace's row whoever called it — measured on
 * `FrameworkStateStore.enableFrameworkSystem`, where the caller's scope stayed disabled and an
 * unrelated project's flipped.
 *
 * This walks the prototypes rather than reading the source, so a mutator added tomorrow is
 * enumerated automatically. A mutator that genuinely spans every scope declares itself here
 * with a reason; an undeclared one fails.
 *
 * Classification: Unit (reflection over two classes, no I/O).
 */

import { describe, expect, test } from '@jest/globals';

import { FrameworkStateStore } from '../../../src/engine/frameworks/framework-state-store.js';
import { GateStateStore } from '../../../src/engine/gates/gate-state-store.js';

/** Verb prefixes that name a state mutation rather than a read. */
const MUTATOR = /^(enable|disable|set|reset|switch|record|clear|toggle|adopt)/;

/** Mutators that operate on every scope on purpose, with the reason they may. */
const SPANS_EVERY_SCOPE: Record<string, string> = {
  'FrameworkStateStore.selectDefaultForRemovedFrameworks':
    'moves every scope off a framework the manager no longer has; a single scope would leave the others naming a missing framework',
  'GateStateStore.adoptLegacyGlobalState':
    'a startup migration of the pre-isolation `default` row into the launch scope; it has no caller to take a scope from',
};

function parameterNames(method: (...args: never[]) => unknown): string[] {
  const source = method.toString();
  const open = source.indexOf('(');
  // Balanced scan: a default value or an object type can itself contain parentheses.
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  return source
    .slice(open + 1, close)
    .split(',')
    .map((part) => part.trim().split(/[:=\s]/)[0] ?? '')
    .filter(Boolean);
}

function mutatorsOf(target: object): string[] {
  return Object.getOwnPropertyNames(target).filter((name) => {
    if (name === 'constructor' || !MUTATOR.test(name)) return false;
    return typeof (target as Record<string, unknown>)[name] === 'function';
  });
}

describe.each([
  ['FrameworkStateStore', FrameworkStateStore.prototype],
  ['GateStateStore', GateStateStore.prototype],
])('%s mutators are scoped', (className, prototype) => {
  const mutators = mutatorsOf(prototype);

  // Positive control: the walk found methods at all. Without it an empty enumeration —
  // a renamed class, a changed prototype shape — would read as a clean pass.
  test('the prototype walk finds mutators', () => {
    expect(mutators.length).toBeGreaterThan(0);
  });

  test.each(mutators)('%s takes a scope', (methodName) => {
    const declared = SPANS_EVERY_SCOPE[`${className}.${methodName}`];
    if (declared) {
      expect(declared).toBeTruthy();
      return;
    }

    const params = parameterNames(
      (prototype as unknown as Record<string, (...args: never[]) => unknown>)[methodName]!
    );
    expect(params).toContain('scope');
  });
});
