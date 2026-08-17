import { describe, expect, it } from '@jest/globals';

import {
  resolveHookCommandPath,
  type SkillPlacement,
} from '../../../src/modules/skills-sync/service.js';

/**
 * Path resolution only — the one piece of hook emission that is genuinely pure.
 *
 * Whether the hook is wired into frontmatter, whether the script it names exists, and
 * whether it actually blocks a stop are all boundary concerns and live in
 * tests/integration/skills-sync/export-command.test.ts. Asserting them here against
 * generated source text passed while the wiring was deleted (mutation M4, 2026-08-16).
 */
describe('gate-review hook command path', () => {
  const userPlacement: SkillPlacement = {
    baseDir: '/home/dev/.claude/skills',
    scope: 'user',
    projectRelativeDir: '.claude/skills',
  };

  it('resolves an absolute path for user scope', () => {
    expect(resolveHookCommandPath(userPlacement, 'strategicImplement')).toBe(
      '/home/dev/.claude/skills/strategicImplement/hooks/gate-review.py'
    );
  });

  it('never emits a cwd-relative command', () => {
    // A hook command runs in the session's current directory and gets no
    // ${CLAUDE_SKILL_DIR} substitution, so a relative path resolves against
    // whatever directory the user happened to be in.
    const command = resolveHookCommandPath(userPlacement, 'strategicImplement');
    expect(command.startsWith('/')).toBe(true);
    expect(command).not.toMatch(/^\.{1,2}\//);
  });

  it('uses ${CLAUDE_PROJECT_DIR} for project scope so a shared checkout stays portable', () => {
    const command = resolveHookCommandPath(
      {
        baseDir: '/machine/specific/path/resolved/at/export',
        scope: 'project',
        projectRelativeDir: '.claude/skills',
      },
      'strategicImplement'
    );
    expect(command).toBe(
      '${CLAUDE_PROJECT_DIR}/.claude/skills/strategicImplement/hooks/gate-review.py'
    );
    // The exporting machine's absolute path must not leak into a committed skill.
    expect(command).not.toContain('/machine/specific/path');
  });
});
