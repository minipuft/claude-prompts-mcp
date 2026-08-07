/**
 * The shared definition of "an accepted exception must still be true".
 *
 * Imported rather than spawned: unlike the guards, this module is pure — no `process.exit()`, no
 * scan, no child process — so the established spawn pattern would only make the assertions harder
 * to write. The gates that consume it are still exercised by their own `--self-test` scripts.
 *
 * The load-bearing case in this file is `unreachable`. Three of the five verdicts say "delete the
 * entry" and one says the opposite; a harness that collapsed them into a single "stale" would tell
 * a reader to delete an exemption that is inert only because the scan never reached its file, and
 * the finding would silently come back the moment the scan widened. That happened on this repo
 * (plan row 0.7), which is why it is asserted rather than assumed.
 */

import { describe, expect, it, jest } from '@jest/globals';

import {
  VERDICT,
  auditExceptions,
  reportExceptionAudit,
} from '../../../scripts/lib/exception-hygiene.js';

interface Entry {
  readonly id: string;
  readonly closedBy?: string;
}

const CLOSED_BY = 'when the tier lands';

describe('exception hygiene — verdicts', () => {
  it('reports nothing for a load-bearing entry', () => {
    const result = auditExceptions<Entry>({
      gate: 'test-gate',
      entries: [{ id: 'alpha', closedBy: CLOSED_BY }],
      describe: (entry) => entry.id,
      closedBy: (entry) => entry.closedBy,
      classify: () => ({ verdict: VERDICT.LOAD_BEARING }),
    });

    expect(result.problems).toEqual([]);
    expect(result.counts[VERDICT.LOAD_BEARING]).toBe(1);
  });

  it.each([
    [VERDICT.SATISFIED, 'delete the entry'],
    [VERDICT.SUBJECT_MISSING, 'delete the entry'],
    [VERDICT.REDUNDANT, 'delete the entry'],
  ])('reports %s and tells the reader to delete', (verdict, remedy) => {
    const result = auditExceptions<Entry>({
      gate: 'test-gate',
      entries: [{ id: 'alpha', closedBy: CLOSED_BY }],
      describe: (entry) => entry.id,
      closedBy: (entry) => entry.closedBy,
      classify: () => ({ verdict }),
    });

    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.message).toContain(verdict);
    expect(result.problems[0]?.message).toContain(remedy);
  });

  it('reports unreachable as a problem whose remedy is NOT deletion', () => {
    const result = auditExceptions<Entry>({
      gate: 'test-gate',
      entries: [{ id: 'alpha', closedBy: CLOSED_BY }],
      describe: (entry) => entry.id,
      closedBy: (entry) => entry.closedBy,
      classify: () => ({ verdict: VERDICT.UNREACHABLE, detail: 'gitignored' }),
    });

    expect(result.problems).toHaveLength(1);
    const message = result.problems[0]?.message ?? '';
    expect(message).toContain('unreachable');
    expect(message).toContain('widen the scan');
    // The distinction 0.7 paid for: an entry inert because nothing reached it must not be
    // dispatched with the same instruction as one that is genuinely satisfied.
    expect(message).toContain('do NOT delete');
  });

  it('carries the classifier detail into the message', () => {
    const result = auditExceptions<Entry>({
      gate: 'test-gate',
      entries: [{ id: 'alpha', closedBy: CLOSED_BY }],
      describe: (entry) => entry.id,
      closedBy: (entry) => entry.closedBy,
      classify: () => ({ verdict: VERDICT.SATISFIED, detail: 'no line matches' }),
    });

    expect(result.problems[0]?.message).toContain('no line matches');
  });
});

describe('exception hygiene — closedBy is independent of truth', () => {
  it('reports a missing closedBy even when the entry is load-bearing', () => {
    const result = auditExceptions<Entry>({
      gate: 'test-gate',
      entries: [{ id: 'alpha', closedBy: '   ' }],
      describe: (entry) => entry.id,
      closedBy: (entry) => entry.closedBy,
      classify: () => ({ verdict: VERDICT.LOAD_BEARING }),
    });

    // Form and truth are separate failures. An entry can name its exit impeccably and still be
    // excusing something that stopped happening, and vice versa.
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.message).toContain('no closedBy');
  });

  it('skips the closedBy check entirely for shapes that do not carry one', () => {
    const result = auditExceptions<Entry>({
      gate: 'test-gate',
      entries: [{ id: 'alpha' }],
      describe: (entry) => entry.id,
      classify: () => ({ verdict: VERDICT.LOAD_BEARING }),
    });

    expect(result.problems).toEqual([]);
  });
});

describe('exception hygiene — reporting', () => {
  const silence = () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    return () => {
      log.mockRestore();
      error.mockRestore();
    };
  };

  it('returns 0 when every entry is load-bearing', () => {
    const restore = silence();
    try {
      const clean = auditExceptions<Entry>({
        gate: 'test-gate',
        entries: [{ id: 'alpha', closedBy: CLOSED_BY }],
        describe: (entry) => entry.id,
        classify: () => ({ verdict: VERDICT.LOAD_BEARING }),
      });
      expect(reportExceptionAudit('test-gate', clean)).toBe(0);
    } finally {
      restore();
    }
  });

  it('returns the problem count so a gate can fold it into its own exit code', () => {
    const restore = silence();
    try {
      const dirty = auditExceptions<Entry>({
        gate: 'test-gate',
        entries: [
          { id: 'alpha', closedBy: CLOSED_BY },
          { id: 'beta', closedBy: CLOSED_BY },
        ],
        describe: (entry) => entry.id,
        classify: () => ({ verdict: VERDICT.SATISFIED }),
      });
      expect(reportExceptionAudit('test-gate', dirty)).toBe(2);
    } finally {
      restore();
    }
  });
});
