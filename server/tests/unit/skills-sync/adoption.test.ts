// @lifecycle test - Structural adoption of pre-marker export directories (F10).
/**
 * F10: every installation that exported before managed markers existed has skill
 * directories that no command can reach -- marker-based prune cannot see them and
 * they have no manifest row either.
 *
 * The adoption test is STRUCTURAL and keys on the leading `## Instructions`
 * heading (owner ruling Q9, tightened 2026-08-18): it asks "did we emit this?"
 * rather than the proxy "does a resource share this name?".
 */
import { describe, expect, it } from '@jest/globals';

import {
  injectManagedSkillMarker,
  isAdoptableSkillMarkdown,
} from '../../../src/modules/skills-sync/sync-engine.js';

/** Frontmatter + body, matching what a pre-marker export left on disk. */
function skillMd(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n\n${body}`;
}

const REAL_ORPHAN_FM = 'name: Deep Analysis\ndescription: Expand on a previous analysis.';
// Mirrors the real orphan: leads with Instructions, then headings from the
// prompt's own body that this emitter has no vocabulary for.
const REAL_ORPHAN_BODY =
  '## Instructions\n\nYou are an expert analyst.\n\n## Usage\n\nDo it.\n\n## Deep Analysis Framework\n\nSteps.';

describe('isAdoptableSkillMarkdown (F10)', () => {
  it('adopts a pre-marker export that leads with the emitted Instructions section', () => {
    expect(isAdoptableSkillMarkdown(skillMd(REAL_ORPHAN_FM, REAL_ORPHAN_BODY))).toBe(true);
  });

  it('adopts despite later headings this emitter never writes', () => {
    // The measured reason the test keys on the LEAD heading rather than on all of
    // them: real skills carry prompt-authored headings further down, so an
    // "every heading is known" rule would reject the case F10 exists for.
    expect(REAL_ORPHAN_BODY).toContain('## Deep Analysis Framework');
    expect(isAdoptableSkillMarkdown(skillMd(REAL_ORPHAN_FM, REAL_ORPHAN_BODY))).toBe(true);
  });

  it('refuses a hand-written skill that leads with any other section', () => {
    const handWritten = skillMd(
      'name: My Notes\ndescription: Personal helper.',
      '## Overview\n\nMine.\n\n## Instructions\n\nLater on.'
    );
    // `## Instructions` IS present -- just not first. Adoption must still refuse,
    // or a hand-written skill gets claimed and later pruned.
    expect(handWritten).toContain('## Instructions');
    expect(isAdoptableSkillMarkdown(handWritten)).toBe(false);
  });

  it('refuses a directory that is already marked as ours', () => {
    const marked = injectManagedSkillMarker(skillMd(REAL_ORPHAN_FM, REAL_ORPHAN_BODY), {
      clientId: 'claude-code',
      scope: 'user',
      resourceKey: 'prompt:analysis/deep_analysis',
    });
    expect(isAdoptableSkillMarkdown(marked)).toBe(false);
  });

  it('refuses a skill with no frontmatter at all', () => {
    expect(isAdoptableSkillMarkdown(REAL_ORPHAN_BODY)).toBe(false);
  });

  it('refuses frontmatter missing name or description', () => {
    expect(isAdoptableSkillMarkdown(skillMd('name: Only Name', REAL_ORPHAN_BODY))).toBe(false);
    expect(
      isAdoptableSkillMarkdown(skillMd('description: Only description', REAL_ORPHAN_BODY))
    ).toBe(false);
  });

  it('refuses a body with no section headings', () => {
    expect(isAdoptableSkillMarkdown(skillMd(REAL_ORPHAN_FM, 'Just prose, no headings.'))).toBe(
      false
    );
  });
});
