/**
 * `resolveContainedPath` is the guard behind every resource write whose destination is built from
 * a tool payload. Its failure mode is silent and severe — a traversing segment aims a write, or a
 * recursive delete, outside the resources root — so both directions are asserted here: it must
 * refuse what escapes AND admit what does not.
 *
 * The escaping cases are the exact payloads that were measured escaping on 2026-08-30.
 */
import { describe, expect, it } from '@jest/globals';
import path from 'node:path';

import {
  isPathInside,
  PathEscapeError,
  resolveContainedPath,
} from '../../../src/shared/utils/contained-path.js';

const ROOT = path.resolve('/srv/resources/prompts');

describe('resolveContainedPath', () => {
  describe('refuses what escapes the root', () => {
    // Each of these was measured writing outside the root before the guard existed.
    it.each([
      ['prompt category traversal', ['../../ESCAPED', 'trav_a']],
      ['gate id traversal', ['../../ESCAPED_GATE']],
      ['framework id traversal', ['../../escaped_fw']],
      ['single level up', ['..']],
      ['traversal buried mid-path', ['ok', '..', '..', 'escaped']],
      ['traversal inside one segment', ['a/../../b']],
    ])('%s', (_label, segments) => {
      expect(() => resolveContainedPath(ROOT, ...segments)).toThrow(PathEscapeError);
    });

    it('names the root, the attempted destination and the offending segments', () => {
      let caught: PathEscapeError | undefined;
      try {
        resolveContainedPath(ROOT, '../../ESCAPED', 'trav_a');
      } catch (error) {
        caught = error as PathEscapeError;
      }

      expect(caught).toBeInstanceOf(PathEscapeError);
      // A refusal a caller cannot act on is a worse refusal. All three facts are in the message.
      expect(caught?.message).toContain(ROOT);
      expect(caught?.message).toContain('../../ESCAPED');
      expect(caught?.message).toContain('Nothing was written');
      expect(caught?.root).toBe(ROOT);
    });
  });

  describe('admits what stays inside', () => {
    it.each([
      ['a plain category and id', ['development', 'my_prompt']],
      ['a hyphenated category', ['knowledge-capture', 'my_prompt']],
      ['a nested chain step id', ['planning', 'implementation_plan/discovery']],
      ['a deep but contained path', ['a', 'b', 'c', 'd']],
      ['the root itself', []],
      // `..` that resolves back INSIDE the root is not an escape. Rejecting it would be a
      // false positive, and false positives are how a guard gets removed later.
      ['a `..` that stays inside', ['a', '..', 'b']],
    ])('%s', (_label, segments) => {
      const resolved = resolveContainedPath(ROOT, ...segments);
      expect(isPathInside(ROOT, resolved)).toBe(true);
    });

    it('returns the same path `path.join` would, for a benign input', () => {
      expect(resolveContainedPath(ROOT, 'development', 'my_prompt')).toBe(
        path.join(ROOT, 'development', 'my_prompt')
      );
    });
  });

  describe('isPathInside', () => {
    it('treats a sibling whose NAME begins with dots as outside, not as traversal', () => {
      // `path.relative` yields `../prompts..backup` here. A `startsWith('..')` prefix test would
      // reach the right verdict for the wrong reason; the segment-wise test is why it is correct.
      expect(isPathInside(ROOT, path.resolve('/srv/resources/prompts..backup'))).toBe(false);
    });

    it('treats a child whose name begins with dots as inside', () => {
      expect(isPathInside(ROOT, path.join(ROOT, '..hidden'))).toBe(true);
    });

    it('treats the root as inside itself', () => {
      expect(isPathInside(ROOT, ROOT)).toBe(true);
    });

    it('treats an unrelated absolute path as outside', () => {
      expect(isPathInside(ROOT, path.resolve('/etc/passwd'))).toBe(false);
    });
  });
});
