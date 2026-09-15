import { describe, expect, it } from '@jest/globals';

import {
  buildSyncPrunePlan,
  collectManifestManagedSkillDirs,
  injectManagedSkillMarker,
  parseManagedSkillMarker,
} from '../../../src/modules/skills-sync/sync-engine.js';

describe('skills-sync sync-engine', () => {
  it('parses managed marker metadata from SKILL frontmatter', () => {
    const marker = parseManagedSkillMarker(`---
name: Triage
description: Test
managed-by: claude-prompts-skills-sync
managed-client: claude-code
managed-scope: user
managed-resource-key: prompt:workflow/triage
---

## Instructions
Test
`);

    expect(marker).toEqual({
      managedBy: 'claude-prompts-skills-sync',
      clientId: 'claude-code',
      scope: 'user',
      resourceKey: 'prompt:workflow/triage',
    });
  });

  it('collects managed skill directories from manifest output files', () => {
    const map = collectManifestManagedSkillDirs(
      new Map([
        ['prompt:workflow/triage', { outputFiles: ['triage/SKILL.md', 'triage/tools/tool.json'] }],
        ['prompt:analysis/deep_analysis', { outputFiles: ['analysis-deep_analysis/SKILL.md'] }],
      ])
    );

    expect([...(map.get('prompt:workflow/triage') ?? [])]).toEqual(['triage']);
    expect([...(map.get('prompt:analysis/deep_analysis') ?? [])]).toEqual([
      'analysis-deep_analysis',
    ]);
  });

  it('computes prune set as managed minus desired', () => {
    const plan = buildSyncPrunePlan({
      desiredResourceKeys: new Set(['prompt:workflow/triage']),
      manifestManagedSkillDirs: new Map([
        ['prompt:workflow/triage', new Set(['triage'])],
        ['prompt:analysis/deep_analysis', new Set(['analysis-deep_analysis'])],
      ]),
      markerManagedSkillDirs: new Map([
        ['prompt:examples/deep_analysis', new Set(['examples-deep_analysis'])],
      ]),
    });

    expect(plan.managedResourceKeys).toEqual([
      'prompt:analysis/deep_analysis',
      'prompt:examples/deep_analysis',
      'prompt:workflow/triage',
    ]);
    expect(plan.pruneResourceKeys).toEqual([
      'prompt:analysis/deep_analysis',
      'prompt:examples/deep_analysis',
    ]);
    expect(plan.pruneSkillDirs).toEqual(['analysis-deep_analysis', 'examples-deep_analysis']);
  });

  it('returns null instead of throwing when frontmatter is not valid YAML', () => {
    // Hand-written frontmatter this tool never wrote is a fact to skip, not a reason to abort —
    // measured against a real skills tree where a `description:` held an unquoted colon.
    const badFrontmatter = `---
name: Bad Skill
description: a thing: with a colon
---

## Instructions
Test
`;
    expect(() => parseManagedSkillMarker(badFrontmatter)).not.toThrow();
    expect(parseManagedSkillMarker(badFrontmatter)).toBeNull();
  });

  it('leaves frontmatter unchanged instead of throwing when it is not valid YAML', () => {
    const badFrontmatter = `---
name: Bad Skill
description: a thing: with a colon
---

## Instructions
Test
`;
    const inject = () =>
      injectManagedSkillMarker(badFrontmatter, {
        clientId: 'claude-code',
        scope: 'user',
        resourceKey: 'prompt:workflow/triage',
      });

    expect(inject).not.toThrow();
    expect(inject()).toBe(badFrontmatter);
  });

  it('injects managed marker fields into SKILL frontmatter', () => {
    const updated = injectManagedSkillMarker(
      `---
name: Triage
description: Test
---

## Instructions
Test
`,
      {
        clientId: 'claude-code',
        scope: 'project',
        resourceKey: 'prompt:workflow/triage',
      }
    );

    expect(updated).toContain('managed-by: claude-prompts-skills-sync');
    expect(updated).toContain('managed-client: claude-code');
    expect(updated).toContain('managed-scope: project');
    expect(updated).toContain('managed-resource-key: prompt:workflow/triage');
  });
});
