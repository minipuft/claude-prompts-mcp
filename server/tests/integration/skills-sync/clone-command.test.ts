/**
 * Clone Command Integration Tests
 *
 * Tests that `cloneCommand()` correctly scaffolds canonical YAML resources
 * from arbitrary SKILL.md files. Uses real filesystem operations in temp dirs.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';

import {
  runSkillsSyncCommand,
  type SkillsSyncOptions,
  type SkillsSyncOutput,
} from '../../../src/modules/skills-sync/service.js';

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
      out
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
      out
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
      out
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
        out
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
      out
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
      out
    );

    const targetDir = path.join(serverRoot, 'resources', 'prompts', 'testing', 'inferred-id');
    expect(existsSync(targetDir)).toBe(true);

    const yamlContent = await readFile(path.join(targetDir, 'prompt.yaml'), 'utf-8');
    const doc = yaml.load(yamlContent) as Record<string, unknown>;
    expect(doc['id']).toBe('inferred-id');
  });

  it('dry-run mode reports what would be created without writing', async () => {
    const skillDir = path.join(tmpDir, 'source', 'dry-run-clone');
    await mkdir(skillDir, { recursive: true });

    const skillContent = buildSkillMd({
      name: 'Dry Run Clone',
      description: 'Tests dry run',
      instructions: 'Be helpful.',
      arguments: [{ name: 'query', required: true, description: 'Search query' }],
    });
    await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    const out = silentOutput();
    await runSkillsSyncCommand(
      {
        command: 'clone',
        file: path.join(skillDir, 'SKILL.md'),
        id: 'dry-run-clone',
        category: 'testing',
        dryRun: true,
      } as SkillsSyncOptions,
      out
    );

    // Should report what would happen
    expect(out.logs.some((l) => l.includes('dry-run'))).toBe(true);
    expect(out.logs.some((l) => l.includes('dry-run-clone'))).toBe(true);
    expect(out.logs.some((l) => l.includes('query'))).toBe(true);

    // But directory should NOT exist
    const targetDir = path.join(serverRoot, 'resources', 'prompts', 'testing', 'dry-run-clone');
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
      out
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

  it('fails gracefully when --file is not provided', async () => {
    const out = silentOutput();
    await expect(
      runSkillsSyncCommand({ command: 'clone' } as SkillsSyncOptions, out)
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
        out
      )
    ).rejects.toThrow(/not found/i);
  });
});
