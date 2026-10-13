/**
 * Clone Command Integration Tests
 *
 * Tests that `cloneCommand()` correctly scaffolds canonical YAML resources
 * from arbitrary SKILL.md files. Uses real filesystem operations in temp dirs.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

import {
  runSkillsSyncCommand,
  type SkillsSyncOptions,
  type SkillsSyncOutput,
} from '../../../src/modules/skills-sync/service.js';
import { ResourceVerificationService } from '../../../src/modules/resources/services/resource-verification-service.js';
import { resolveSkillsSyncPaths } from '../../../src/runtime/skills-sync-paths.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'skills-clone-'));
}

function silentOutput(): SkillsSyncOutput & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    warn: () => {},
    error: () => {},
  };
}

function buildSkillMd(opts: {
  name: string;
  description: string;
  instructions?: string;
  usage?: string;
  arguments?: Array<{ name: string; required: boolean; description: string }>;
  format?: 'claude-code' | 'agent-skills';
}): string {
  const fm: Record<string, unknown> = {
    name: opts.name,
    description: opts.description,
  };
  if (opts.arguments && opts.arguments.length > 0) {
    fm['argument-hint'] = opts.arguments
      .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
      .join(' ');
  }

  // Agent-skills format adds compatibility block
  if (opts.format === 'agent-skills') {
    fm['compatibility'] = { 'agent-skills': true };
  }

  let body = `---\n${yaml.dump(fm, { lineWidth: 120 }).trim()}\n---\n\n`;

  if (opts.instructions) {
    body += `## Instructions\n\n${opts.instructions}\n\n`;
  }

  if (opts.arguments && opts.arguments.length > 0) {
    body += `## Arguments\n\n`;
    for (const [i, a] of opts.arguments.entries()) {
      if (opts.format === 'agent-skills') {
        body += `- **${a.name}**${a.required ? ' (required)' : ''}: ${a.description}\n`;
      } else {
        body += `- \`$${i}\` — **${a.name}**${a.required ? ' (required)' : ''}: ${a.description}\n`;
      }
    }
    body += '\n';
  }

  if (opts.usage) {
    body += `## Usage\n\n${opts.usage}\n`;
  }

  return body;
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Clone Command Integration', () => {
  let tmpDir: string;
  let serverRoot: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tmpDir = createTempDir();
    serverRoot = path.join(tmpDir, 'server');

    // Create minimal server structure with resources dir
    await mkdir(path.join(serverRoot, 'resources', 'prompts'), { recursive: true });
    await mkdir(path.join(serverRoot, 'resources', 'gates'), { recursive: true });

    savedEnv = {
      MCP_SERVER_ROOT: process.env['MCP_SERVER_ROOT'],
      MCP_RESOURCES_PATH: process.env['MCP_RESOURCES_PATH'],
    };
    process.env['MCP_SERVER_ROOT'] = serverRoot;
    delete process.env['MCP_RESOURCES_PATH'];
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates canonical prompt from basic SKILL.md', async () => {
    const skillDir = path.join(tmpDir, 'source', 'my-skill');
    await mkdir(skillDir, { recursive: true });

    const skillContent = buildSkillMd({
      name: 'My Test Skill',
      description: 'A skill for testing clone',
      instructions: 'You are a helpful code reviewer.',
      usage: 'Review the code below.',
    });
    await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    const out = silentOutput();
    await runSkillsSyncCommand(
      {
        command: 'clone',
        file: path.join(skillDir, 'SKILL.md'),
        id: 'my-skill',
        category: 'testing',
      } as SkillsSyncOptions,
      out,
      resolveSkillsSyncPaths()
    );

    // Verify canonical structure was created
    const targetDir = path.join(serverRoot, 'resources', 'prompts', 'testing', 'my-skill');
    expect(existsSync(targetDir)).toBe(true);

    // Verify prompt.yaml
    const yamlContent = await readFile(path.join(targetDir, 'prompt.yaml'), 'utf-8');
    const doc = yaml.load(yamlContent) as Record<string, unknown>;
    expect(doc['id']).toBe('my-skill');
    expect(doc['name']).toBe('My Test Skill');
    expect(doc['description']).toBe('A skill for testing clone');
    expect(doc['category']).toBe('testing');
    expect(doc['systemMessageFile']).toBe('system-message.md');
    expect(doc['userMessageTemplateFile']).toBe('user-message.md');

    // Verify prose files
    const sysContent = await readFile(path.join(targetDir, 'system-message.md'), 'utf-8');
    expect(sysContent).toContain('You are a helpful code reviewer.');

    const userContent = await readFile(path.join(targetDir, 'user-message.md'), 'utf-8');
    expect(userContent).toContain('Review the code below.');
  });

  it('infers arguments from SKILL.md and writes them to prompt.yaml', async () => {
    const skillDir = path.join(tmpDir, 'source', 'arg-skill');
    await mkdir(skillDir, { recursive: true });

    const skillContent = buildSkillMd({
      name: 'Arg Skill',
      description: 'Tests argument inference',
      instructions: 'Process {input} with {format}.',
      arguments: [
        { name: 'input', required: true, description: 'The input to process' },
        { name: 'format', required: false, description: 'Output format' },
      ],
    });
    await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    const out = silentOutput();
    await runSkillsSyncCommand(
      {
        command: 'clone',
        file: path.join(skillDir, 'SKILL.md'),
        id: 'arg-skill',
        category: 'testing',
      } as SkillsSyncOptions,
      out,
      resolveSkillsSyncPaths()
    );

    const yamlContent = await readFile(
      path.join(serverRoot, 'resources', 'prompts', 'testing', 'arg-skill', 'prompt.yaml'),
      'utf-8'
    );
    const doc = yaml.load(yamlContent) as Record<string, unknown>;
    const args = doc['arguments'] as Array<Record<string, unknown>>;
    expect(args).toHaveLength(2);
    expect(args[0]).toEqual(
      expect.objectContaining({ name: 'input', type: 'string', required: true })
    );
    expect(args[1]).toEqual(expect.objectContaining({ name: 'format', type: 'string' }));
    // Non-required arg should NOT have required: true
    expect(args[1]!['required']).toBeUndefined();
  });

  it('reverse-compiles {arg} placeholders back to {{arg}} in prose files', async () => {
    const skillDir = path.join(tmpDir, 'source', 'reverse-skill');
    await mkdir(skillDir, { recursive: true });

    const skillContent = buildSkillMd({
      name: 'Reverse Skill',
      description: 'Tests reverse compilation',
      instructions: 'Analyze {input} for {target}.',
      usage: 'Provide {input} as the first argument.',
      arguments: [
        { name: 'input', required: true, description: 'Input text' },
        { name: 'target', required: true, description: 'Analysis target' },
      ],
    });
    await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    const out = silentOutput();
    await runSkillsSyncCommand(
      {
        command: 'clone',
        file: path.join(skillDir, 'SKILL.md'),
        id: 'reverse-skill',
        category: 'testing',
      } as SkillsSyncOptions,
      out,
      resolveSkillsSyncPaths()
    );

    const targetDir = path.join(serverRoot, 'resources', 'prompts', 'testing', 'reverse-skill');

    // Prose files should have {{arg}} (Nunjucks) not {arg} (Claude Code)
    const sysContent = await readFile(path.join(targetDir, 'system-message.md'), 'utf-8');
    expect(sysContent).toContain('{{input}}');
    expect(sysContent).toContain('{{target}}');
    expect(sysContent).not.toMatch(/(?<!\{)\{input\}(?!\})/); // No single-brace {input}

    const userContent = await readFile(path.join(targetDir, 'user-message.md'), 'utf-8');
    expect(userContent).toContain('{{input}}');
  });

  it('fails when target directory exists without --force', async () => {
    const skillDir = path.join(tmpDir, 'source', 'exists-skill');
    await mkdir(skillDir, { recursive: true });

    const skillContent = buildSkillMd({
      name: 'Exists Skill',
      description: 'Tests overwrite protection',
      instructions: 'Do something.',
    });
    await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    // Pre-create the target directory
    const targetDir = path.join(serverRoot, 'resources', 'prompts', 'testing', 'exists-skill');
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, 'prompt.yaml'), 'id: exists-skill\nname: Old\n');

    const out = silentOutput();
    await expect(
      runSkillsSyncCommand(
        {
          command: 'clone',
          file: path.join(skillDir, 'SKILL.md'),
          id: 'exists-skill',
          category: 'testing',
        } as SkillsSyncOptions,
        out,
        resolveSkillsSyncPaths()
      )
    ).rejects.toThrow(/exists.*force/i);
  });

  it('overwrites existing directory with --force', async () => {
    const skillDir = path.join(tmpDir, 'source', 'force-skill');
    await mkdir(skillDir, { recursive: true });

    const skillContent = buildSkillMd({
      name: 'Force Skill',
      description: 'Tests force overwrite',
      instructions: 'New instructions.',
    });
    await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    // Pre-create with old content
    const targetDir = path.join(serverRoot, 'resources', 'prompts', 'testing', 'force-skill');
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, 'prompt.yaml'), 'id: force-skill\nname: Old\n');

    const out = silentOutput();
    await runSkillsSyncCommand(
      {
        command: 'clone',
        file: path.join(skillDir, 'SKILL.md'),
        id: 'force-skill',
        category: 'testing',
        force: true,
      } as SkillsSyncOptions,
      out,
      resolveSkillsSyncPaths()
    );

    // Verify overwritten
    const yamlContent = await readFile(path.join(targetDir, 'prompt.yaml'), 'utf-8');
    const doc = yaml.load(yamlContent) as Record<string, unknown>;
    expect(doc['name']).toBe('Force Skill');
  });

  it('infers resource ID from parent directory name when --id not provided', async () => {
    const skillDir = path.join(tmpDir, 'source', 'inferred-id');
    await mkdir(skillDir, { recursive: true });

    const skillContent = buildSkillMd({
      name: 'Inferred ID Skill',
      description: 'Tests ID inference',
      instructions: 'Do work.',
    });
    await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    const out = silentOutput();
    await runSkillsSyncCommand(
      {
        command: 'clone',
        file: path.join(skillDir, 'SKILL.md'),
        // No --id, should infer from dir name "inferred-id"
        category: 'testing',
      } as SkillsSyncOptions,
      out,
      resolveSkillsSyncPaths()
    );

    const targetDir = path.join(serverRoot, 'resources', 'prompts', 'testing', 'inferred-id');
    expect(existsSync(targetDir)).toBe(true);

    const yamlContent = await readFile(path.join(targetDir, 'prompt.yaml'), 'utf-8');
    const doc = yaml.load(yamlContent) as Record<string, unknown>;
    expect(doc['id']).toBe('inferred-id');
  });

  it('preview mode reports what would be created without writing', async () => {
    const skillDir = path.join(tmpDir, 'source', 'preview-clone');
    await mkdir(skillDir, { recursive: true });

    const skillContent = buildSkillMd({
      name: 'Preview Clone',
      description: 'Tests preview mode',
      instructions: 'Be helpful.',
      arguments: [{ name: 'query', required: true, description: 'Search query' }],
    });
    await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    const out = silentOutput();
    await runSkillsSyncCommand(
      {
        command: 'clone',
        file: path.join(skillDir, 'SKILL.md'),
        id: 'preview-clone',
        category: 'testing',
        preview: true,
      } as SkillsSyncOptions,
      out,
      resolveSkillsSyncPaths()
    );

    // Should report what would happen
    expect(out.logs.some((l) => l.includes('[preview]'))).toBe(true);
    expect(out.logs.some((l) => l.includes('preview-clone'))).toBe(true);
    expect(out.logs.some((l) => l.includes('query'))).toBe(true);

    // But directory should NOT exist
    const targetDir = path.join(serverRoot, 'resources', 'prompts', 'testing', 'preview-clone');
    expect(existsSync(targetDir)).toBe(false);
  });

  it('clones companion gate directories', async () => {
    const skillDir = path.join(tmpDir, 'source', 'gated-skill');
    await mkdir(skillDir, { recursive: true });

    const skillContent = buildSkillMd({
      name: 'Gated Skill',
      description: 'Tests companion gate clone',
      instructions: 'Follow quality standards.',
    });
    await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    // Create companion gates directory
    const gateDir = path.join(skillDir, 'gates', 'test-quality');
    await mkdir(gateDir, { recursive: true });
    await writeFile(
      path.join(gateDir, 'gate.yaml'),
      yaml.dump({
        id: 'test-quality',
        name: 'Test Quality Gate',
        description: 'Ensures test quality',
        type: 'validation',
        pass_criteria: [{ type: 'inline_guidance', items: ['Tests pass'] }],
      })
    );
    await writeFile(path.join(gateDir, 'guidance.md'), 'Ensure all tests pass before merging.');

    const out = silentOutput();
    await runSkillsSyncCommand(
      {
        command: 'clone',
        file: path.join(skillDir, 'SKILL.md'),
        id: 'gated-skill',
        category: 'testing',
      } as SkillsSyncOptions,
      out,
      resolveSkillsSyncPaths()
    );

    // Verify gate was copied to canonical gates directory
    const canonicalGateDir = path.join(serverRoot, 'resources', 'gates', 'test-quality');
    expect(existsSync(canonicalGateDir)).toBe(true);

    const gateYaml = await readFile(path.join(canonicalGateDir, 'gate.yaml'), 'utf-8');
    const gateDoc = yaml.load(gateYaml) as Record<string, unknown>;
    expect(gateDoc['id']).toBe('test-quality');

    const guidanceContent = await readFile(path.join(canonicalGateDir, 'guidance.md'), 'utf-8');
    expect(guidanceContent).toContain('Ensure all tests pass');

    // Verify prompt.yaml includes gateConfiguration
    const promptYaml = await readFile(
      path.join(serverRoot, 'resources', 'prompts', 'testing', 'gated-skill', 'prompt.yaml'),
      'utf-8'
    );
    const promptDoc = yaml.load(promptYaml) as Record<string, unknown>;
    const gateConfig = promptDoc['gateConfiguration'] as Record<string, unknown>;
    expect(gateConfig['include']).toEqual(['test-quality']);
  });

  it('clones companion step directories, skipping the ones the loader skips', async () => {
    // Each step becomes a directory INSIDE the new prompt, where `tools/` is reserved for script
    // tools and `_`-prefixed entries are never served (P4.48). Each skipped step has a twin that
    // differs only in that name.
    const skillDir = path.join(tmpDir, 'source', 'stepped-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      buildSkillMd({ name: 'Stepped Skill', description: 'Has companion steps' })
    );
    for (const stepId of ['toolbox', 'tools', 'drafts', '_drafts']) {
      const stepDir = path.join(skillDir, 'resources', stepId);
      await mkdir(stepDir, { recursive: true });
      await writeFile(
        path.join(stepDir, 'prompt.yaml'),
        yaml.dump({
          id: stepId,
          name: stepId,
          description: `${stepId} step`,
          userMessageTemplate: 'Do the step.',
        })
      );
    }

    await runSkillsSyncCommand(
      {
        command: 'clone',
        file: path.join(skillDir, 'SKILL.md'),
        id: 'stepped-skill',
        category: 'testing',
      } as SkillsSyncOptions,
      silentOutput(),
      resolveSkillsSyncPaths()
    );

    const targetDir = path.join(serverRoot, 'resources', 'prompts', 'testing', 'stepped-skill');
    const cloned = ['toolbox', 'tools', 'drafts', '_drafts'].filter((stepId) =>
      existsSync(path.join(targetDir, stepId, 'prompt.yaml'))
    );
    expect(cloned).toEqual(['toolbox', 'drafts']);
    const promptDoc = yaml.load(
      await readFile(path.join(targetDir, 'prompt.yaml'), 'utf-8')
    ) as Record<string, unknown>;
    expect(promptDoc['chainSteps']).toHaveLength(2);
  });

  /**
   * P6.239 (R117, third amendment). MEASURED 2026-09-28 on `46b4568a`: a companion step whose
   * `prompt.yaml` carried an inline gate definition with no `scope` imported as valid, while the
   * loader drops that gate on every load. The import now opts into the check, differential
   * against the file it overwrites: a definition the import brings is refused naming the field,
   * one the overwritten file already carried is a warning.
   */
  describe('P6.239: an imported step whose inline gate the loader drops', () => {
    const DROPPED_DEFINITION = {
      name: 'Cites Sources',
      type: 'validation',
      description: 'Every claim names its source.',
      guidance: 'Check each claim for a named source.',
    };
    const stepDoc = (withDropped: boolean) =>
      yaml.dump({
        id: 'draft',
        name: 'draft',
        description: 'draft step',
        userMessageTemplate: 'Do the step.',
        ...(withDropped
          ? { gateConfiguration: { inline_gate_definitions: [DROPPED_DEFINITION] } }
          : {}),
      });
    const writeSkill = async (withDropped: boolean) => {
      const skillDir = path.join(tmpDir, 'source', 'gated-skill');
      await mkdir(path.join(skillDir, 'resources', 'draft'), { recursive: true });
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        buildSkillMd({ name: 'Gated Skill', description: 'Has a gated step' })
      );
      await writeFile(
        path.join(skillDir, 'resources', 'draft', 'prompt.yaml'),
        stepDoc(withDropped)
      );
      return path.join(skillDir, 'SKILL.md');
    };
    const targetDir = () => path.join(serverRoot, 'resources', 'prompts', 'testing', 'gated-skill');
    const clone = (file: string, out: SkillsSyncOutput, force = false) =>
      runSkillsSyncCommand(
        {
          command: 'clone',
          file,
          id: 'gated-skill',
          category: 'testing',
          force,
        } as SkillsSyncOptions,
        out,
        resolveSkillsSyncPaths()
      );
    const warningsOf = () => {
      const warnings: string[] = [];
      return {
        warnings,
        out: {
          ...silentOutput(),
          warn: (...args: unknown[]) => warnings.push(args.map(String).join(' ')),
        },
      };
    };

    it('P6.239 (a) a fresh import carrying one is refused, naming the field', async () => {
      const file = await writeSkill(true);

      await expect(clone(file, silentOutput())).rejects.toThrow(
        /Clone validation failed[\s\S]*inline_gate_definitions\[0\][\s\S]*scope \(must be one of/
      );
      expect(existsSync(path.join(targetDir(), 'draft', 'prompt.yaml'))).toBe(false);
    });

    it('P6.239 (b) an update keeping one the overwritten step already carried warns and lands', async () => {
      const draftFile = path.join(targetDir(), 'draft', 'prompt.yaml');
      await mkdir(path.dirname(draftFile), { recursive: true });
      await writeFile(path.join(targetDir(), 'prompt.yaml'), 'id: gated-skill\nname: Old\n');
      await writeFile(draftFile, stepDoc(true));
      const file = await writeSkill(true);
      const { warnings, out } = warningsOf();

      await clone(file, out, true);

      expect(await readFile(draftFile, 'utf-8')).toBe(stepDoc(true));
      expect(warnings.filter((line) => line.includes('inline_gate_definitions'))).toEqual([
        expect.stringMatching(/inline_gate_definitions\[0\]: .*scope \(must be one of/),
      ]);
    });

    it('P6.239 (c) control: a clean import lands with no inline-gate warning', async () => {
      const file = await writeSkill(false);
      const { warnings, out } = warningsOf();

      await clone(file, out);

      expect(existsSync(path.join(targetDir(), 'draft', 'prompt.yaml'))).toBe(true);
      expect(warnings.filter((line) => line.includes('inline_gate_definitions'))).toEqual([]);
    });
  });

  /**
   * P6.244 (R130). MEASURED 2026-09-28 on `2a267d189`: the clone validated its primary file twice
   * after the write — once from `localValidationTargets` and again as the `validate` step's return
   * value — so a primary warning would print twice. The primary as the clone writes it is built
   * from a fresh document that never carries an inline definition, so no warning can reach it;
   * the property is measured as validation calls per written file instead, on the real service.
   */
  describe('P6.244: each cloned file is validated once', () => {
    const cloneWithStep = async (force: boolean) => {
      const skillDir = path.join(tmpDir, 'source', 'counted-skill');
      await mkdir(path.join(skillDir, 'resources', 'draft'), { recursive: true });
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        buildSkillMd({ name: 'Counted Skill', description: 'Has one step' })
      );
      await writeFile(
        path.join(skillDir, 'resources', 'draft', 'prompt.yaml'),
        yaml.dump({ id: 'draft', name: 'draft', description: 'd', userMessageTemplate: 'Do it.' })
      );
      const spy = jest.spyOn(ResourceVerificationService.prototype, 'validateFile');
      try {
        await runSkillsSyncCommand(
          {
            command: 'clone',
            file: path.join(skillDir, 'SKILL.md'),
            id: 'counted-skill',
            category: 'testing',
            force,
          } as SkillsSyncOptions,
          silentOutput(),
          resolveSkillsSyncPaths()
        );
        return spy.mock.calls.map((call) => call[2]);
      } finally {
        spy.mockRestore();
      }
    };
    const targetDir = () =>
      path.join(serverRoot, 'resources', 'prompts', 'testing', 'counted-skill');
    const count = (paths: string[], file: string) => paths.filter((p) => p === file).length;

    it('P6.244 (a) a fresh clone validates the primary and the step once each', async () => {
      const validated = await cloneWithStep(false);

      expect(count(validated, path.join(targetDir(), 'prompt.yaml'))).toBe(1);
      expect(count(validated, path.join(targetDir(), 'draft', 'prompt.yaml'))).toBe(1);
    });

    it('P6.244 (b) a forced clone adds only the pre-write verdict of each file it replaces', async () => {
      await cloneWithStep(false);
      const validated = await cloneWithStep(true);

      expect(count(validated, path.join(targetDir(), 'prompt.yaml'))).toBe(2);
      expect(count(validated, path.join(targetDir(), 'draft', 'prompt.yaml'))).toBe(2);
    });
  });

  // ─── Branch coverage tier (row 0C3.6): typed resources, existing targets, companion files ─────

  const cloneOptions = (overrides: Partial<SkillsSyncOptions>): SkillsSyncOptions =>
    ({ command: 'clone', ...overrides }) as SkillsSyncOptions;
  const listTree = (root: string): string[] =>
    readdirSync(root, { recursive: true }).map(String).sort();

  async function writeSkillFile(dirName: string, content: string): Promise<string> {
    const skillDir = path.join(tmpDir, 'source', dirName);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), content);
    return path.join(skillDir, 'SKILL.md');
  }

  const GUIDANCE_SKILL =
    '---\nname: Thing\ndescription: A thing\n---\n\n## Guidance\n\nAnswer in short lines for {audience}.\n';

  describe('a cloned non-prompt resource lands under its own type root', () => {
    it('clones a style into resources/styles with its guidance beside it, not into prompts', async () => {
      const file = await writeSkillFile('terse-style', GUIDANCE_SKILL);
      const resourcesRoot = path.join(serverRoot, 'resources');
      const styleDir = path.join(resourcesRoot, 'styles', 'terse-style');
      // Precondition: no styles root yet, and nothing under prompts to be confused with.
      expect(existsSync(path.join(resourcesRoot, 'styles'))).toBe(false);
      const promptsBefore = listTree(path.join(resourcesRoot, 'prompts'));

      const report = await runSkillsSyncCommand(
        cloneOptions({ file, id: 'terse-style', resourceType: 'style', category: 'ignored' }),
        silentOutput(),
        resolveSkillsSyncPaths()
      );

      const styleDoc = yaml.load(
        await readFile(path.join(styleDir, 'style.yaml'), 'utf-8')
      ) as Record<string, unknown>;
      expect(styleDoc).toEqual({ id: 'terse-style', name: 'Thing', description: 'A thing' });
      expect(await readFile(path.join(styleDir, 'guidance.md'), 'utf-8')).toBe(
        'Answer in short lines for {{audience}}.'
      );
      // Control: the category is a prompt-only coordinate, and no prompt directory appeared.
      expect(listTree(path.join(resourcesRoot, 'prompts'))).toEqual(promptsBefore);
      expect(report.written).toBe(2);
    });

    it.each([
      {
        type: 'gate' as const,
        verified: 'gates',
        entry: 'gate.yaml',
        reason: "type: Gate type must be 'validation' or 'guidance'",
      },
      {
        type: 'framework' as const,
        verified: 'frameworks',
        entry: 'framework.yaml',
        reason: 'version: Invalid input: expected string, received undefined',
      },
    ])(
      'verifies a cloned $type as $verified at its own root, then rolls the directory back',
      async ({ type, verified, entry, reason }) => {
        const file = await writeSkillFile(`${type}-skill`, GUIDANCE_SKILL);
        const typeRoot = path.join(serverRoot, 'resources', `${verified}`);
        const promptsBefore = listTree(path.join(serverRoot, 'resources', 'prompts'));

        const error = await runSkillsSyncCommand(
          cloneOptions({ file, id: `my-${type}`, resourceType: type }),
          silentOutput(),
          resolveSkillsSyncPaths()
        ).then(
          () => undefined,
          (caught: unknown) => caught as Error
        );

        // A SKILL.md carries no `type`/`version` for these schemas, so the verifier refuses the
        // scaffold. What this pins is WHERE the clone wrote and WHICH verifier read it.
        expect(error).toBeDefined();
        expect(error?.message).toContain('Clone validation failed');
        expect(error?.message).toContain(`resourceType: ${verified}`);
        expect(error?.message).toContain(`filePath: ${path.join(typeRoot, `my-${type}`, entry)}`);
        expect(error?.message).toContain('rolledBack: true');
        expect(error?.message).toContain(reason);
        expect(error?.message).not.toContain('resourceType: prompts');
        // Rolled back: the type root holds no directory for it, and prompts is untouched.
        expect(existsSync(path.join(typeRoot, `my-${type}`))).toBe(false);
        expect(listTree(path.join(serverRoot, 'resources', 'prompts'))).toEqual(promptsBefore);
      }
    );
  });

  describe('--file SKILL.md without --id', () => {
    it('refuses when the id cannot be inferred from a bare file name', async () => {
      const bareDir = path.join(tmpDir, 'bare');
      await mkdir(bareDir, { recursive: true });
      await writeFile(
        path.join(bareDir, 'SKILL.md'),
        buildSkillMd({ name: 'Bare', description: 'd', instructions: 'Work.' })
      );
      const originalCwd = process.cwd();
      process.chdir(bareDir);
      try {
        // dirname('SKILL.md') is '.', so there is no directory name to take an id from.
        await expect(
          runSkillsSyncCommand(
            cloneOptions({ file: 'SKILL.md', category: 'testing' }),
            silentOutput(),
            resolveSkillsSyncPaths()
          )
        ).rejects.toThrow(/Could not infer resource ID\. Use --id <name>/);
        expect(listTree(path.join(serverRoot, 'resources', 'prompts'))).toEqual([]);

        // Control: the same relative file clones once --id names it.
        await runSkillsSyncCommand(
          cloneOptions({ file: 'SKILL.md', id: 'bare-skill', category: 'testing' }),
          silentOutput(),
          resolveSkillsSyncPaths()
        );
        expect(
          existsSync(
            path.join(serverRoot, 'resources', 'prompts', 'testing', 'bare-skill', 'prompt.yaml')
          )
        ).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('a companion gate that already exists', () => {
    const OLD_GATE_YAML = yaml.dump({
      id: 'test-quality',
      name: 'Old Quality Gate',
      description: 'The gate already installed',
      type: 'validation',
      pass_criteria: [{ type: 'inline_guidance', items: ['Old criterion'] }],
    });
    const NEW_GATE_YAML = yaml.dump({
      id: 'test-quality',
      name: 'New Quality Gate',
      description: 'The gate the skill ships',
      type: 'validation',
      pass_criteria: [{ type: 'inline_guidance', items: ['New criterion'] }],
    });
    const gateTarget = () => path.join(serverRoot, 'resources', 'gates', 'test-quality');

    async function seedSkillAndInstalledGate(): Promise<string> {
      const file = await writeSkillFile(
        'gated-clone',
        buildSkillMd({ name: 'Gated Clone', description: 'Ships a gate', instructions: 'Work.' }) +
          '\n## Quality Gates\n\n### Inline Criteria\n\n- Cite sources\n'
      );
      const shipped = path.join(path.dirname(file), 'gates', 'test-quality');
      await mkdir(shipped, { recursive: true });
      await writeFile(path.join(shipped, 'gate.yaml'), NEW_GATE_YAML);
      await writeFile(path.join(shipped, 'guidance.md'), 'New guidance.');
      await mkdir(gateTarget(), { recursive: true });
      await writeFile(path.join(gateTarget(), 'gate.yaml'), OLD_GATE_YAML);
      await writeFile(path.join(gateTarget(), 'guidance.md'), 'Old guidance.');
      return file;
    }

    const promptConfig = async () =>
      (
        yaml.load(
          await readFile(
            path.join(serverRoot, 'resources', 'prompts', 'testing', 'gated-clone', 'prompt.yaml'),
            'utf-8'
          )
        ) as Record<string, Record<string, unknown>>
      )['gateConfiguration'];

    it('is skipped without --force: the installed gate is kept and still referenced', async () => {
      const file = await seedSkillAndInstalledGate();
      expect(await readFile(path.join(gateTarget(), 'guidance.md'), 'utf-8')).toBe('Old guidance.');
      const out = silentOutput();

      await runSkillsSyncCommand(
        cloneOptions({ file, id: 'gated-clone', category: 'testing' }),
        out,
        resolveSkillsSyncPaths()
      );

      expect(out.logs).toContain('  skip gate test-quality (exists, use --force)');
      expect(await readFile(path.join(gateTarget(), 'gate.yaml'), 'utf-8')).toBe(OLD_GATE_YAML);
      expect(await readFile(path.join(gateTarget(), 'guidance.md'), 'utf-8')).toBe('Old guidance.');
      expect(await promptConfig()).toEqual({ include: ['test-quality'], inline: ['Cite sources'] });
    });

    it('is overwritten with --force by the gate the skill ships', async () => {
      const file = await seedSkillAndInstalledGate();
      expect(await readFile(path.join(gateTarget(), 'gate.yaml'), 'utf-8')).toBe(OLD_GATE_YAML);
      const out = silentOutput();

      await runSkillsSyncCommand(
        cloneOptions({ file, id: 'gated-clone', category: 'testing', force: true }),
        out,
        resolveSkillsSyncPaths()
      );

      expect(out.logs).not.toContain('  skip gate test-quality (exists, use --force)');
      expect(out.logs).toContain('  wrote gates/test-quality/gate.yaml');
      expect(await readFile(path.join(gateTarget(), 'gate.yaml'), 'utf-8')).toBe(NEW_GATE_YAML);
      expect(await readFile(path.join(gateTarget(), 'guidance.md'), 'utf-8')).toBe('New guidance.');
    });
  });

  describe('companion step files', () => {
    const stepYaml = (id: string, name: string) =>
      yaml.dump({
        id,
        name,
        description: `${name} step`,
        systemMessageFile: 'system-message.md',
        userMessageTemplateFile: 'user-message.md',
      });
    async function seedStepSkill(): Promise<string> {
      const file = await writeSkillFile(
        'chained',
        buildSkillMd({ name: 'Chained', description: 'Has steps', instructions: 'Run.' })
      );
      const stepDir = path.join(path.dirname(file), 'resources', 'analyze');
      await mkdir(stepDir, { recursive: true });
      await writeFile(path.join(stepDir, 'prompt.yaml'), stepYaml('analyze', 'Analyze Step'));
      await writeFile(path.join(stepDir, 'system-message.md'), 'Analyze {{input}} carefully.');
      await writeFile(path.join(stepDir, 'user-message.md'), 'Report on {{input}}.');
      return file;
    }
    const target = () => path.join(serverRoot, 'resources', 'prompts', 'testing', 'chained');

    it("writes each step's prompt, system and user message under the new prompt and chains it", async () => {
      const file = await seedStepSkill();
      expect(existsSync(target())).toBe(false);
      const out = silentOutput();

      await runSkillsSyncCommand(
        cloneOptions({ file, id: 'chained', category: 'testing' }),
        out,
        resolveSkillsSyncPaths()
      );

      const stepTarget = path.join(target(), 'analyze');
      expect(await readFile(path.join(stepTarget, 'prompt.yaml'), 'utf-8')).toBe(
        stepYaml('analyze', 'Analyze Step')
      );
      expect(await readFile(path.join(stepTarget, 'system-message.md'), 'utf-8')).toBe(
        'Analyze {{input}} carefully.'
      );
      expect(await readFile(path.join(stepTarget, 'user-message.md'), 'utf-8')).toBe(
        'Report on {{input}}.'
      );
      expect(out.logs).toEqual(
        expect.arrayContaining([
          '  wrote resources/analyze/prompt.yaml',
          '  wrote resources/analyze/system-message.md',
          '  wrote resources/analyze/user-message.md',
          '  updated prompt.yaml with chainSteps',
        ])
      );
      const promptDoc = yaml.load(
        await readFile(path.join(target(), 'prompt.yaml'), 'utf-8')
      ) as Record<string, unknown>;
      expect(promptDoc['chainSteps']).toEqual([
        { promptId: 'testing/chained/analyze', stepName: 'Analyze Step' },
      ]);
    });

    it('refuses a step whose prompt.yaml names neither id nor name, rolling the new prompt back', async () => {
      const file = await seedStepSkill();
      const plainDir = path.join(path.dirname(file), 'resources', 'plain');
      await mkdir(plainDir, { recursive: true });
      await writeFile(
        path.join(plainDir, 'prompt.yaml'),
        yaml.dump({ description: 'Plain step', userMessageTemplate: 'Wrap up.' })
      );

      const error = await runSkillsSyncCommand(
        cloneOptions({ file, id: 'chained', category: 'testing' }),
        silentOutput(),
        resolveSkillsSyncPaths()
      ).then(
        () => undefined,
        (caught: unknown) => caught as Error
      );

      expect(error?.message).toContain('Clone validation failed');
      expect(error?.message).toContain('resourceId: plain');
      expect(error?.message).toContain('id: Invalid input: expected string, received undefined');
      expect(error?.message).toContain('name: Invalid input: expected string, received undefined');
      // The analyze step was valid and written first, yet nothing of the clone remains.
      expect(existsSync(target())).toBe(false);
    });

    it('replaces an existing step directory under --force, and refuses before touching it without', async () => {
      const file = await seedStepSkill();
      const stepTarget = path.join(target(), 'analyze');
      await mkdir(stepTarget, { recursive: true });
      await writeFile(path.join(target(), 'prompt.yaml'), 'id: chained\nname: Old\n');
      await writeFile(path.join(stepTarget, 'prompt.yaml'), stepYaml('analyze', 'Old Step'));
      await writeFile(path.join(stepTarget, 'system-message.md'), 'Old step system.');
      expect(await readFile(path.join(stepTarget, 'system-message.md'), 'utf-8')).toBe(
        'Old step system.'
      );

      // Without --force the clone stops at the prompt directory, so the step is never reached.
      await expect(
        runSkillsSyncCommand(
          cloneOptions({ file, id: 'chained', category: 'testing' }),
          silentOutput(),
          resolveSkillsSyncPaths()
        )
      ).rejects.toThrow(/exists.*force/i);
      expect(await readFile(path.join(stepTarget, 'system-message.md'), 'utf-8')).toBe(
        'Old step system.'
      );

      const out = silentOutput();
      await runSkillsSyncCommand(
        cloneOptions({ file, id: 'chained', category: 'testing', force: true }),
        out,
        resolveSkillsSyncPaths()
      );

      expect(out.logs.some((l) => l.includes('skip resource'))).toBe(false);
      expect(await readFile(path.join(stepTarget, 'system-message.md'), 'utf-8')).toBe(
        'Analyze {{input}} carefully.'
      );
      expect(await readFile(path.join(stepTarget, 'prompt.yaml'), 'utf-8')).toBe(
        stepYaml('analyze', 'Analyze Step')
      );
    });
  });

  it('infers arguments from an agent-skills SKILL.md and reverse-compiles its placeholders', async () => {
    const content = buildSkillMd({
      name: 'Agent Skill',
      description: 'Authored for an agent-skills client',
      instructions: 'Process {input} as {mode}.',
      usage: 'Start with {input}.',
      arguments: [
        { name: 'input', required: true, description: 'What to process' },
        { name: 'mode', required: false, description: 'How to process it' },
      ],
      format: 'agent-skills',
    });
    // Precondition: this really is the agent-skills shape, not the claude-code one.
    expect(content).toContain('compatibility:');
    expect(content).toContain('- **input** (required): What to process');
    const file = await writeSkillFile('agent-skill', content);

    await runSkillsSyncCommand(
      cloneOptions({ file, id: 'agent-skill', category: 'testing' }),
      silentOutput(),
      resolveSkillsSyncPaths()
    );

    const targetDir = path.join(serverRoot, 'resources', 'prompts', 'testing', 'agent-skill');
    const doc = yaml.load(await readFile(path.join(targetDir, 'prompt.yaml'), 'utf-8')) as Record<
      string,
      unknown
    >;
    expect(doc['arguments']).toEqual([
      { name: 'input', type: 'string', description: 'What to process', required: true },
      { name: 'mode', type: 'string', description: 'How to process it' },
    ]);
    expect(await readFile(path.join(targetDir, 'system-message.md'), 'utf-8')).toBe(
      'Process {{input}} as {{mode}}.'
    );
    expect(await readFile(path.join(targetDir, 'user-message.md'), 'utf-8')).toBe(
      'Start with {{input}}.'
    );
  });

  it('surfaces a write failure that is not a verification failure, and restores the replaced files', async () => {
    const file = await writeSkillFile(
      'unwritable',
      buildSkillMd({ name: 'Unwritable', description: 'd', instructions: 'Work.' })
    );
    // An installed prompt whose system-message.md is a DIRECTORY: --force reaches it after
    // rewriting prompt.yaml, and writing a file over a directory fails.
    const targetDir = path.join(serverRoot, 'resources', 'prompts', 'testing', 'unwritable');
    await mkdir(path.join(targetDir, 'system-message.md'), { recursive: true });
    await writeFile(path.join(targetDir, 'prompt.yaml'), 'id: unwritable\nname: Old\n');
    expect(existsSync(path.join(targetDir, 'system-message.md'))).toBe(true);

    const error = await runSkillsSyncCommand(
      cloneOptions({ file, id: 'unwritable', category: 'testing', force: true }),
      silentOutput(),
      resolveSkillsSyncPaths()
    ).then(
      () => undefined,
      (caught: unknown) => caught as Error
    );

    expect(error?.message).toMatch(/EISDIR/);
    expect(error?.message).not.toContain('Clone validation failed');
    // Rolled back: prompt.yaml, rewritten before the failing write, is the installed one again.
    expect(await readFile(path.join(targetDir, 'prompt.yaml'), 'utf-8')).toBe(
      'id: unwritable\nname: Old\n'
    );

    // Control: with the directory gone the same forced clone lands.
    await rm(path.join(targetDir, 'system-message.md'), { recursive: true });
    await runSkillsSyncCommand(
      cloneOptions({ file, id: 'unwritable', category: 'testing', force: true }),
      silentOutput(),
      resolveSkillsSyncPaths()
    );
    expect(await readFile(path.join(targetDir, 'system-message.md'), 'utf-8')).toBe('Work.');
  });

  it('names the resource after its id and describes it by its file when the SKILL.md carries neither', async () => {
    const file = await writeSkillFile('anonymous', '## Instructions\n\nJust do the work.\n');
    // Precondition: the file has no frontmatter to take a name or description from.
    expect(await readFile(file, 'utf-8')).not.toContain('---');

    await runSkillsSyncCommand(
      cloneOptions({ file, id: 'anonymous-prompt', category: 'testing' }),
      silentOutput(),
      resolveSkillsSyncPaths()
    );

    const doc = yaml.load(
      await readFile(
        path.join(serverRoot, 'resources', 'prompts', 'testing', 'anonymous-prompt', 'prompt.yaml'),
        'utf-8'
      )
    ) as Record<string, unknown>;
    expect(doc['name']).toBe('anonymous-prompt');
    expect(doc['description']).toBe('Imported from SKILL.md');
  });

  it('copies a companion gate that ships gate.yaml without a guidance file', async () => {
    const file = await writeSkillFile(
      'yaml-only-gate',
      buildSkillMd({ name: 'Yaml Only', description: 'd', instructions: 'Work.' })
    );
    const shipped = path.join(path.dirname(file), 'gates', 'bare-gate');
    await mkdir(shipped, { recursive: true });
    const gateYaml = yaml.dump({
      id: 'bare-gate',
      name: 'Bare Gate',
      description: 'No guidance file',
      type: 'validation',
      pass_criteria: [{ type: 'inline_guidance', items: ['Holds'] }],
    });
    await writeFile(path.join(shipped, 'gate.yaml'), gateYaml);
    expect(existsSync(path.join(shipped, 'guidance.md'))).toBe(false);

    await runSkillsSyncCommand(
      cloneOptions({ file, id: 'yaml-only-gate', category: 'testing' }),
      silentOutput(),
      resolveSkillsSyncPaths()
    );

    const installed = path.join(serverRoot, 'resources', 'gates', 'bare-gate');
    expect(await readFile(path.join(installed, 'gate.yaml'), 'utf-8')).toBe(gateYaml);
    expect(listTree(installed)).toEqual(['gate.yaml']);
  });

  it('previews a SKILL.md with no arguments without an arguments line', async () => {
    const file = await writeSkillFile(
      'plain-preview',
      buildSkillMd({ name: 'Plain', description: 'd', instructions: 'Work.' })
    );
    const out = silentOutput();

    await runSkillsSyncCommand(
      cloneOptions({ file, id: 'plain-preview', category: 'testing', preview: true }),
      out,
      resolveSkillsSyncPaths()
    );

    expect(out.logs.some((l) => l.includes('[preview] Would create prompt "plain-preview"'))).toBe(
      true
    );
    expect(out.logs.some((l) => l.includes('arguments:'))).toBe(false);
  });

  it('fails gracefully when --file is not provided', async () => {
    const out = silentOutput();
    await expect(
      runSkillsSyncCommand({ command: 'clone' } as SkillsSyncOptions, out, resolveSkillsSyncPaths())
    ).rejects.toThrow(/--file/i);
  });

  it('fails when file does not exist', async () => {
    const out = silentOutput();
    await expect(
      runSkillsSyncCommand(
        {
          command: 'clone',
          file: path.join(tmpDir, 'nonexistent', 'SKILL.md'),
          id: 'nope',
          category: 'testing',
        } as SkillsSyncOptions,
        out,
        resolveSkillsSyncPaths()
      )
    ).rejects.toThrow(/not found/i);
  });
});
