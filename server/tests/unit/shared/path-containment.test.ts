import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { assertPathInside, isPathInside } from '../../../src/shared/utils/path-containment.js';

const ROOT = path.resolve('/srv/resources');

describe('isPathInside', () => {
  it('accepts a direct child', () => {
    expect(isPathInside(ROOT, path.join(ROOT, 'prompts'))).toBe(true);
  });

  it('accepts a deeply nested descendant', () => {
    expect(isPathInside(ROOT, path.join(ROOT, 'prompts', 'category', 'id', 'prompt.yaml'))).toBe(
      true
    );
  });

  it('accepts the root itself', () => {
    expect(isPathInside(ROOT, ROOT)).toBe(true);
  });

  it('rejects a parent directory', () => {
    expect(isPathInside(ROOT, path.resolve('/srv'))).toBe(false);
  });

  it('rejects an escape via ..', () => {
    // The reproduced vector: a category of "../../../tmp/x" joined onto the root.
    expect(isPathInside(ROOT, path.join(ROOT, '..', '..', 'tmp', 'x'))).toBe(false);
  });

  it('rejects an escape that dips back in and out again', () => {
    expect(isPathInside(ROOT, path.join(ROOT, 'prompts', '..', '..', '..', 'etc'))).toBe(false);
  });

  it('rejects a sibling whose name merely extends the root', () => {
    // A `startsWith` implementation would wrongly accept this, which is why the
    // check is built on path.relative rather than string prefixes.
    expect(isPathInside(ROOT, path.resolve('/srv/resources-evil/x'))).toBe(false);
  });

  it('rejects an unrelated absolute path', () => {
    expect(isPathInside(ROOT, path.resolve('/tmp/elsewhere'))).toBe(false);
  });

  it('normalises a redundant but contained path', () => {
    expect(isPathInside(ROOT, path.join(ROOT, 'a', '..', 'b'))).toBe(true);
  });
});

describe('assertPathInside', () => {
  it('returns silently for a contained path', () => {
    expect(() =>
      assertPathInside(ROOT, path.join(ROOT, 'gates', 'my-gate'), 'gate id')
    ).not.toThrow();
  });

  it('throws for an escaping path and names the offending field', () => {
    expect(() =>
      assertPathInside(ROOT, path.join(ROOT, '..', '..', 'tmp', 'pwned'), 'gate id')
    ).toThrow(/gate id/);
  });

  it('names the resource root it is protecting', () => {
    expect(() => assertPathInside(ROOT, path.resolve('/tmp/pwned'), 'category')).toThrow(
      new RegExp(ROOT.replace(/[\\/]/g, '.'))
    );
  });

  it('does not echo the supplied value back into the message', () => {
    // The pre-fix gate writer printed the traversal string into a copy-pasteable
    // .gitignore suggestion, which turns a refusal into an instruction.
    let message = '';
    try {
      assertPathInside(ROOT, path.resolve('/tmp/attacker-controlled-marker'), 'gate id');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain('attacker-controlled-marker');
  });
});
