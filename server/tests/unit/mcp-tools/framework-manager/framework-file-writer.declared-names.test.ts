/**
 * tutorial-rework B.27 — the framework writer writes the file names the framework DECLARES.
 *
 * `framework.yaml` may name its companion files with `phasesFile` / `judgePromptFile`
 * (`framework-schema.ts`; the loader follows them, `runtime-framework-loader.ts`). Before this
 * fix, `FrameworkFileWriter` always wrote `phases.yaml` / `judge-prompt.md` regardless of what a
 * framework declared: an update touching phases or judge_prompt silently rewrote the declaration
 * to the default name (orphaning the declared file with stale content), and an update that never
 * touched either still created a stray default-named file beside the declared one while the
 * declaration — and the loader, which follows it — kept pointing at the original.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FrameworkFileWriter } from '../../../../src/mcp/tools/framework-manager/services/index.js';

import type { ExistingFrameworkData } from '../../../../src/mcp/tools/framework-manager/services/index.js';
import type { ConfigManager, Logger } from '../../../../src/shared/types/index.js';

describe('FrameworkFileWriter honors declared companion file names', () => {
  let workspaceDir: string;
  let logger: Logger;
  let configManager: ConfigManager;
  let service: FrameworkFileWriter;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-declared-names-'));
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    configManager = {
      getServerRoot: () => workspaceDir,
      getFrameworksDirectory: () => join(workspaceDir, 'resources', 'frameworks'),
      getBundledResourceDirectory: () => undefined,
    } as unknown as ConfigManager;
    service = new FrameworkFileWriter({ logger, configManager });
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  /** Hand-authors a framework directory the way a seeded workspace framework would look. */
  function seedFramework(
    id: string,
    opts: { phasesFile?: string; judgePromptFile?: string }
  ): string {
    const dir = join(workspaceDir, 'resources', 'frameworks', id);
    mkdirSync(dir, { recursive: true });
    const lines = [
      `id: ${id}`,
      'name: Declared Names Framework',
      'type: DECLARED_NAMES',
      'version: 1.0.0',
      'enabled: true',
      'systemPromptGuidance: |',
      '  Apply declared-names principles.',
    ];
    if (opts.phasesFile !== undefined) lines.push(`phasesFile: ${opts.phasesFile}`);
    if (opts.judgePromptFile !== undefined) lines.push(`judgePromptFile: ${opts.judgePromptFile}`);
    writeFileSync(join(dir, 'framework.yaml'), lines.join('\n') + '\n');
    writeFileSync(join(dir, 'system-prompt.md'), 'Apply declared-names principles.\n');
    if (opts.phasesFile !== undefined) {
      writeFileSync(
        join(dir, opts.phasesFile),
        ['phases:', '  - id: phase-1', '    name: Phase One', '    description: Original', ''].join(
          '\n'
        )
      );
    }
    if (opts.judgePromptFile !== undefined) {
      writeFileSync(join(dir, opts.judgePromptFile), 'Original judgement.\n');
    }
    return dir;
  }

  it('updates content in the declared files and creates no default-named file', async () => {
    const id = 'custom-names-fw';
    const dir = seedFramework(id, {
      phasesFile: 'custom-phases.yaml',
      judgePromptFile: 'custom-judge.md',
    });

    const existing = await service.loadExistingFramework(id);
    expect(existing).not.toBeNull();

    const result = await service.writeFrameworkFiles(
      {
        id,
        phases: [{ id: 'phase-1', name: 'Phase One', description: 'Updated' }],
        judge_prompt: 'Updated judgement.',
      },
      existing
    );
    expect(result.success).toBe(true);

    // MUTATION KILLED: hardcoding 'phases.yaml'/'judge-prompt.md' back into `planFrameworkFiles`
    // makes these four assertions fail — content lands in the wrong file and the declared ones
    // go stale.
    expect(readFileSync(join(dir, 'custom-phases.yaml'), 'utf8')).toContain('description: Updated');
    expect(readFileSync(join(dir, 'custom-judge.md'), 'utf8')).toBe('Updated judgement.');
    expect(existsSync(join(dir, 'phases.yaml'))).toBe(false);
    expect(existsSync(join(dir, 'judge-prompt.md'))).toBe(false);

    // The declaration itself must survive unchanged — an update touching phases/judge_prompt
    // must not silently rename a framework's companion files to the defaults.
    const frameworkYaml = readFileSync(join(dir, 'framework.yaml'), 'utf8');
    expect(frameworkYaml).toContain('phasesFile: custom-phases.yaml');
    expect(frameworkYaml).toContain('judgePromptFile: custom-judge.md');
  });

  it('leaves declared files untouched and creates no stray default when the update never names phases or judge_prompt', async () => {
    const id = 'custom-names-fw-untouched';
    const dir = seedFramework(id, {
      phasesFile: 'custom-phases.yaml',
      judgePromptFile: 'custom-judge.md',
    });

    const existing = await service.loadExistingFramework(id);
    expect(existing).not.toBeNull();

    const result = await service.writeFrameworkFiles(
      { id, description: 'Description-only change.' },
      existing
    );
    expect(result.success).toBe(true);

    // MUTATION KILLED: writing `phases.yaml`/`judge-prompt.md` unconditionally (rather than the
    // declared name) creates these two files even though this update named neither field.
    expect(existsSync(join(dir, 'phases.yaml'))).toBe(false);
    expect(existsSync(join(dir, 'judge-prompt.md'))).toBe(false);
    // Content lands back in the same declared files (the writer re-serializes the existing
    // in-memory phases/judge data every write), not a copy under the default name.
    expect(readFileSync(join(dir, 'custom-phases.yaml'), 'utf8')).toContain(
      'description: Original'
    );
    expect(readFileSync(join(dir, 'custom-judge.md'), 'utf8')).toBe('Original judgement.\n');
  });

  it('falls back to the canonical default names when a framework declares none', async () => {
    const id = 'no-declared-names-fw';
    const dir = seedFramework(id, {});

    const existing = await service.loadExistingFramework(id);
    expect(existing).not.toBeNull();
    expect(existing?.phasesPath).toBeNull();
    expect(existing?.judgePromptPath).toBeNull();

    const result = await service.writeFrameworkFiles(
      {
        id,
        phases: [{ id: 'phase-1', name: 'Phase One', description: 'First phase' }],
        judge_prompt: 'A judgement.',
      },
      existing
    );
    expect(result.success).toBe(true);

    expect(existsSync(join(dir, 'phases.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'judge-prompt.md'))).toBe(true);
    const frameworkYaml = readFileSync(join(dir, 'framework.yaml'), 'utf8');
    expect(frameworkYaml).toContain('phasesFile: phases.yaml');
    expect(frameworkYaml).toContain('judgePromptFile: judge-prompt.md');
  });

  it('projectFrameworkWrite (preview/diff) names exactly the declared files, not the defaults', async () => {
    const id = 'custom-names-fw-diff';
    seedFramework(id, { phasesFile: 'custom-phases.yaml', judgePromptFile: 'custom-judge.md' });

    const existing = await service.loadExistingFramework(id);
    expect(existing).not.toBeNull();

    const changes = await service.projectFrameworkWrite(
      {
        id,
        phases: [{ id: 'phase-1', name: 'Phase One', description: 'Updated' }],
        judge_prompt: 'Updated judgement.',
      },
      existing
    );

    const paths = changes.map((change) => change.path);
    expect(paths).toContain(`${id}/custom-phases.yaml`);
    expect(paths).toContain(`${id}/custom-judge.md`);
    expect(paths).not.toContain(`${id}/phases.yaml`);
    expect(paths).not.toContain(`${id}/judge-prompt.md`);
  });

  it('refuses a declared file name that escapes the framework folder, writing nothing', async () => {
    const id = 'escaping-declared-name-fw';
    const dir = join(workspaceDir, 'resources', 'frameworks', id);
    mkdirSync(dir, { recursive: true });

    // Built by hand rather than read back through `loadExistingFramework` (which already
    // refuses to LOAD a `framework.yaml` whose declared name escapes, before the writer ever
    // sees it) — this pins the writer's OWN containment check, so a second caller that builds
    // `existingData` some other way — a version-history snapshot restored without going through
    // `loadExistingFramework`, say — cannot reach an unguarded join either.
    const maliciousExisting: ExistingFrameworkData = {
      framework: {
        id,
        name: 'Escaping Declared Name Framework',
        type: 'ESCAPING',
        version: '1.0.0',
        enabled: true,
        phasesFile: '../../escaped-phases.yaml',
      },
      phases: null,
      systemPrompt: null,
      judgePrompt: null,
      frameworkPath: join(dir, 'framework.yaml'),
      phasesPath: null,
      systemPromptPath: join(dir, 'system-prompt.md'),
      judgePromptPath: null,
    };

    await expect(
      service.writeFrameworkFiles(
        { id, phases: [{ id: 'phase-1', name: 'Phase One', description: 'x' }] },
        maliciousExisting
      )
    ).rejects.toThrow(/Refusing to write outside/);

    expect(existsSync(join(workspaceDir, 'resources', 'frameworks', 'escaped-phases.yaml'))).toBe(
      false
    );
    expect(existsSync(join(workspaceDir, 'resources', 'escaped-phases.yaml'))).toBe(false);
    // Nothing was written to the framework's own directory either — the throw happens before the
    // transaction opens.
    expect(existsSync(join(dir, 'framework.yaml'))).toBe(false);
  });
});
