// @lifecycle canonical - Pins which state store events reach a subscriber (row B.97).
/**
 * State Store Events Have Subscribers
 *
 * `health-changed` had nine emit sites across `FrameworkStateStore` and `GateStateStore` and no
 * subscriber anywhere — not in `server/src`, `cli/src`, `server/tests` or `hooks`. One of those
 * sites sat inside a 30-second `setInterval` that recomputed gate health on the default scope
 * forever so it could notify nobody. The row it came from asked for the event to be made
 * per-scope; scoping it would have polished an event that reaches no one, so it was deleted
 * instead, timer and all.
 *
 * The deletion is only half of it. An emit with no listener costs nothing at the moment it is
 * written and reads as a wired feature ever after, so the next one is added the same way. This
 * file makes the orphan set an explicit, expiring value.
 *
 * PREDICATE: every `this.emit('<literal>')` in the two state store sources, matched against a
 * `.on` / `.once` / `.addListener` / `.prependListener` of the same literal anywhere in
 * `server/src`, `cli/src`, `server/tests` or `hooks`. The found orphan set is compared as ONE
 * sorted value against {@link PINNED_ORPHANS}, so all three directions fail:
 *
 *   - a new orphan event (or `health-changed` returning) is not in the pinned set
 *   - a pinned orphan that GAINS a subscriber is a satisfied exception, and drops out
 *   - a store that stops emitting a pinned event fails too, which is what keeps the reasons
 *     below from outliving the code they describe
 *
 * The three pinned entries differ from `health-changed` in cost, not in wiring: none of them
 * runs anything on a timer, and each fires once per operator action. They are recorded rather
 * than deleted because removing a store's whole published event surface is a wider call than
 * this row makes. Their reasons are the expiry conditions.
 *
 * Classification: Unit (source text scan, no I/O beyond reads).
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../../..');
const SERVER_SRC = path.join(REPO_ROOT, 'server', 'src');

const STATE_STORES = [
  path.join(SERVER_SRC, 'engine', 'frameworks', 'framework-state-store.ts'),
  path.join(SERVER_SRC, 'engine', 'gates', 'gate-state-store.ts'),
];

/** Everywhere a subscriber could plausibly live. */
const SUBSCRIBER_ROOTS = [
  SERVER_SRC,
  path.join(REPO_ROOT, 'cli', 'src'),
  path.join(REPO_ROOT, 'server', 'tests'),
  path.join(REPO_ROOT, 'hooks'),
];

/**
 * Emitted by a state store and heard by nobody, with the reason each is recorded rather than
 * deleted. An entry whose event gains a subscriber, or stops being emitted, fails this file.
 */
const PINNED_ORPHANS: Record<string, string> = {
  'system-enabled':
    'GateStateStore fires it once per operator enable; no timer, no recomputation, nothing runs when it is unheard',
  'system-disabled': 'the disable half of `system-enabled`, same cost',
  'validation-completed':
    'emitted only by `recordValidation`, which has had no caller since its own was deleted in 2026-08 — it is unreachable before it is unheard',
};

function everyFileUnder(root: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;
      out.push(...everyFileUnder(full));
    } else if (/\.(ts|mts|cts|js|mjs|py)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function emittedLiterals(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found = new Set<string>();
  for (const match of source.matchAll(/\.emit\(\s*['"`]([^'"`]+)['"`]/g)) {
    const literal = match[1];
    if (literal !== undefined) found.add(literal);
  }
  return [...found];
}

function hasSubscriber(event: string, corpus: string): boolean {
  const escaped = event.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\.(on|once|addListener|prependListener)\\(\\s*['"\`]${escaped}['"\`]`).test(
    corpus
  );
}

describe('state store events', () => {
  const corpus = SUBSCRIBER_ROOTS.flatMap(everyFileUnder)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  const emitted = [...new Set(STATE_STORES.flatMap(emittedLiterals))].sort();

  test('the scan finds the events it claims to (positive control)', () => {
    // Without this, a renamed file or a changed emit spelling would empty the enumeration and
    // read as a clean pass.
    expect(emitted).toContain('framework-switched');
    expect(emitted.length).toBeGreaterThanOrEqual(5);
  });

  test('the subscriber search fires on an event that HAS one (positive control)', () => {
    // `tool-description-loader` subscribes to these two on a real `FrameworkStateStore`.
    expect(hasSubscriber('framework-switched', corpus)).toBe(true);
    expect(hasSubscriber('framework-system-toggled', corpus)).toBe(true);
    // ...and does not invent one for an event nobody emits or hears.
    expect(hasSubscriber('no-such-event-anywhere', corpus)).toBe(false);
  });

  test('health-changed is neither emitted nor declared by either store', () => {
    expect(emitted).not.toContain('health-changed');

    // The event-map entry is checked separately: a declaration with no emit is the same
    // orphan one step earlier, and the scan above only reads emits. Prose naming the event
    // is deliberately permitted — the docblocks explaining the deletion contain it.
    for (const file of STATE_STORES) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/^\s*'health-changed'\s*:/m);
    }
  });

  test('the orphan set is exactly the pinned one', () => {
    const orphans = emitted.filter((event) => !hasSubscriber(event, corpus)).sort();

    expect(orphans).toEqual(Object.keys(PINNED_ORPHANS).sort());
  });

  test('every pinned orphan is still emitted (satisfied-exception check)', () => {
    for (const event of Object.keys(PINNED_ORPHANS)) {
      expect(emitted).toContain(event);
    }
  });
});
