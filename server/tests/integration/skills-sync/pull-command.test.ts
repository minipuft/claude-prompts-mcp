/**
 * Pull Command Integration Tests
 *
 * Tests the section-aware merge behavior of `pullCommand()`:
 * - Export a canonical resource → edit the SKILL.md → pull back
 * - Verifies section-aware diffing preserves Nunjucks conditionals in unedited sections
 * - Verifies edited sections are correctly reverse-compiled
 *
 * Uses real filesystem (temp dirs) with MCP_SERVER_ROOT override.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
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
  return mkdtempSync(path.join(os.tmpdir(), 'skills-pull-'));
}

function silentOutput(): SkillsSyncOutput & { logs: string[]; warns: string[] } {
  const logs: string[] = [];
  const warns: string[] = [];
  return {
    logs,
    warns,
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => warns.push(args.map(String).join(' ')),
    error: () => {},
  };
}

async function writePromptResource(
  serverRoot: string,
  category: string,
  id: string,
  opts: {
    name: string;
    description: string;
    systemMessage?: string;
    userMessage?: string;
    arguments?: Array<{ name: string; type: string; description: string; required?: boolean }>;
  }
): Promise<string> {
  const promptDir = path.join(serverRoot, 'resources', 'prompts', category, id);
  await mkdir(promptDir, { recursive: true });

  const yamlDoc: Record<string, unknown> = {
    id,
    name: opts.name,
    description: opts.description,
    category,
  };

  if (opts.arguments && opts.arguments.length > 0) {
    yamlDoc['arguments'] = opts.arguments;
  }

  if (opts.systemMessage) {
    yamlDoc['systemMessageFile'] = 'system-message.md';
    await writeFile(path.join(promptDir, 'system-message.md'), opts.systemMessage);
  }

  if (opts.userMessage) {
    yamlDoc['userMessageTemplateFile'] = 'user-message.md';
    await writeFile(path.join(promptDir, 'user-message.md'), opts.userMessage);
  }

  await writeFile(path.join(promptDir, 'prompt.yaml'), yaml.dump(yamlDoc, { lineWidth: 120 }));
  return promptDir;
}

async function writeSyncConfig(
  serverRoot: string,
  outputDir: string,
  clientId = 'claude-code'
): Promise<void> {
  const config = {
    registrations: {
      [clientId]: 'all',
    },
    overrides: {
      [clientId]: {
        outputDir: {
          user: outputDir,
          project: outputDir,
        },
      },
    },
  };
  await writeFile(path.join(serverRoot, 'skills-sync.yaml'), yaml.dump(config, { lineWidth: 120 }));
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Pull Command Integration', () => {
  let tmpDir: string;
  let serverRoot: string;
  let outputDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tmpDir = createTempDir();
    serverRoot = path.join(tmpDir, 'server');
    outputDir = path.join(tmpDir, 'output');

    await mkdir(serverRoot, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    // Save and override env
    savedEnv = {
      MCP_SERVER_ROOT: process.env['MCP_SERVER_ROOT'],
      MCP_RESOURCES_PATH: process.env['MCP_RESOURCES_PATH'],
    };
    process.env['MCP_SERVER_ROOT'] = serverRoot;
    delete process.env['MCP_RESOURCES_PATH'];
  });

  afterEach(async () => {
    // Restore env
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function exportAndGetSkillPath(
    promptId: string,
    clientId = 'claude-code'
  ): Promise<string> {
    const out = silentOutput();
    await runSkillsSyncCommand(
      { command: 'export', client: clientId, scope: 'user' } as SkillsSyncOptions,
      out
    );
    return path.join(outputDir, promptId, 'SKILL.md');
  }

  it('preserves Nunjucks conditionals in unedited sections', async () => {
    // Canonical system-message.md contains Nunjucks conditionals
    const systemMsg = [
      'You are an assistant.',
      '',
      '{% if style %}',
      'Use {{style}} formatting.',
      '{% else %}',
      'Use default formatting.',
      '{% endif %}',
      '',
      'Always be concise.',
    ].join('\n');

    const userMsg = 'Analyze the following: {{input}}';

    await writePromptResource(serverRoot, 'test', 'pull-test', {
      name: 'Pull Test',
      description: 'Tests pull section-aware merge',
      systemMessage: systemMsg,
      userMessage: userMsg,
      arguments: [
        { name: 'input', type: 'string', description: 'Input text', required: true },
        { name: 'style', type: 'string', description: 'Output style' },
      ],
    });
    await writeSyncConfig(serverRoot, outputDir);

    // Export the resource
    const skillPath = await exportAndGetSkillPath('pull-test');
    const exported = await readFile(skillPath, 'utf-8');

    // The exported SKILL.md should have compiled away the conditional:
    // {% if style %}...{% endif %} → "Use {style} formatting."
    expect(exported).toContain('Use {style} formatting.');
    expect(exported).not.toContain('{% if');

    // Edit ONLY the user message section (leave Instructions untouched)
    const edited = exported.replace(
      'Analyze the following: {input}',
      'Please analyze this content carefully: {input}'
    );
    await writeFile(skillPath, edited);

    // Pull changes back
    const pullOut = silentOutput();
    await runSkillsSyncCommand(
      { command: 'pull', client: 'claude-code', scope: 'user' } as SkillsSyncOptions,
      pullOut
    );

    // Verify: system-message.md should be UNCHANGED (conditionals preserved)
    const sysContent = await readFile(
      path.join(serverRoot, 'resources', 'prompts', 'test', 'pull-test', 'system-message.md'),
      'utf-8'
    );
    expect(sysContent).toContain('{% if style %}');
    expect(sysContent).toContain('{% else %}');
    expect(sysContent).toContain('{% endif %}');

    // Verify: user-message.md should be updated with reverse-compiled content
    const userContent = await readFile(
      path.join(serverRoot, 'resources', 'prompts', 'test', 'pull-test', 'user-message.md'),
      'utf-8'
    );
    expect(userContent).toContain('Please analyze this content carefully: {{input}}');
  });

  it('detects and merges edits to the Instructions section', async () => {
    const systemMsg = 'You are a code reviewer.\n\nCheck for bugs in {{language}}.';

    await writePromptResource(serverRoot, 'test', 'edit-instructions', {
      name: 'Edit Instructions Test',
      description: 'Tests editing the Instructions section',
      systemMessage: systemMsg,
      arguments: [{ name: 'language', type: 'string', description: 'Language', required: true }],
    });
    await writeSyncConfig(serverRoot, outputDir);

    const skillPath = await exportAndGetSkillPath('edit-instructions');
    const exported = await readFile(skillPath, 'utf-8');

    // Edit the Instructions section
    const edited = exported.replace(
      'Check for bugs in {language}.',
      'Check for bugs and security issues in {language}.'
    );
    await writeFile(skillPath, edited);

    const pullOut = silentOutput();
    await runSkillsSyncCommand(
      { command: 'pull', client: 'claude-code', scope: 'user' } as SkillsSyncOptions,
      pullOut
    );

    // Verify: system-message.md should be updated with reverse-compiled content
    const sysContent = await readFile(
      path.join(
        serverRoot,
        'resources',
        'prompts',
        'test',
        'edit-instructions',
        'system-message.md'
      ),
      'utf-8'
    );
    expect(sysContent).toContain('Check for bugs and security issues in {{language}}.');
  });

  it('merges name and description changes to prompt.yaml', async () => {
    await writePromptResource(serverRoot, 'test', 'meta-edit', {
      name: 'Original Name',
      description: 'Original description',
      systemMessage: 'Be helpful.',
    });
    await writeSyncConfig(serverRoot, outputDir);

    const skillPath = await exportAndGetSkillPath('meta-edit');
    let exported = await readFile(skillPath, 'utf-8');

    // Edit frontmatter name and description
    exported = exported.replace('name: Original Name', 'name: Updated Name');
    exported = exported.replace('description: Original description', 'description: Updated desc');
    await writeFile(skillPath, exported);

    const pullOut = silentOutput();
    await runSkillsSyncCommand(
      { command: 'pull', client: 'claude-code', scope: 'user' } as SkillsSyncOptions,
      pullOut
    );

    // Verify: prompt.yaml should have updated name and description
    const yamlContent = await readFile(
      path.join(serverRoot, 'resources', 'prompts', 'test', 'meta-edit', 'prompt.yaml'),
      'utf-8'
    );
    const doc = yaml.load(yamlContent) as Record<string, unknown>;
    expect(doc['name']).toBe('Updated Name');
    expect(doc['description']).toBe('Updated desc');
  });

  it('reports no changes when SKILL.md matches exported content', async () => {
    await writePromptResource(serverRoot, 'test', 'no-change', {
      name: 'No Change',
      description: 'Should detect no edits',
      systemMessage: 'Be concise.',
    });
    await writeSyncConfig(serverRoot, outputDir);

    // Export but don't edit
    await exportAndGetSkillPath('no-change');

    const pullOut = silentOutput();
    await runSkillsSyncCommand(
      { command: 'pull', client: 'claude-code', scope: 'user' } as SkillsSyncOptions,
      pullOut
    );

    // Should report no changes
    expect(pullOut.logs.some((l) => l.includes('no prose changes'))).toBe(true);
  });

  it('dry-run mode reports changes without writing files', async () => {
    await writePromptResource(serverRoot, 'test', 'dry-run-test', {
      name: 'Dry Run',
      description: 'Dry run test',
      systemMessage: 'Original content.',
    });
    await writeSyncConfig(serverRoot, outputDir);

    const skillPath = await exportAndGetSkillPath('dry-run-test');
    const exported = await readFile(skillPath, 'utf-8');
    const edited = exported.replace('Original content.', 'Modified content.');
    await writeFile(skillPath, edited);

    const pullOut = silentOutput();
    await runSkillsSyncCommand(
      {
        command: 'pull',
        client: 'claude-code',
        scope: 'user',
        dryRun: true,
      } as SkillsSyncOptions,
      pullOut
    );

    // Should report the change
    expect(pullOut.logs.some((l) => l.includes('prose change'))).toBe(true);

    // But file should NOT be modified
    const sysContent = await readFile(
      path.join(serverRoot, 'resources', 'prompts', 'test', 'dry-run-test', 'system-message.md'),
      'utf-8'
    );
    expect(sysContent).toBe('Original content.');
  });

  it('section-aware: refuses to pull over canonical Nunjucks control flow, and says so', async () => {
    const systemMsg = [
      '{% if format %}',
      'Output in {{format}}.',
      '{% endif %}',
      '',
      'Core instructions here.',
    ].join('\n');

    const userMsg = [
      '{% if context %}',
      'Context: {{context}}',
      '{% endif %}',
      '',
      'Process: {{input}}',
    ].join('\n');

    await writePromptResource(serverRoot, 'test', 'mixed-edit', {
      name: 'Mixed Edit',
      description: 'Section-aware merge test',
      systemMessage: systemMsg,
      userMessage: userMsg,
      arguments: [
        { name: 'input', type: 'string', description: 'Input', required: true },
        { name: 'format', type: 'string', description: 'Format' },
        { name: 'context', type: 'string', description: 'Context' },
      ],
    });
    await writeSyncConfig(serverRoot, outputDir);

    const skillPath = await exportAndGetSkillPath('mixed-edit');
    const exported = await readFile(skillPath, 'utf-8');

    // Edit ONLY the Usage section (user message), leave Instructions untouched
    const edited = exported.replace('Process: {input}', 'Analyze deeply: {input}');
    await writeFile(skillPath, edited);

    const pullOut = silentOutput();
    await runSkillsSyncCommand(
      { command: 'pull', client: 'claude-code', scope: 'user' } as SkillsSyncOptions,
      pullOut
    );

    // system-message.md should be UNCHANGED (Nunjucks conditionals preserved)
    const sysContent = await readFile(
      path.join(serverRoot, 'resources', 'prompts', 'test', 'mixed-edit', 'system-message.md'),
      'utf-8'
    );
    expect(sysContent).toContain('{% if format %}');
    expect(sysContent).toContain('{% endif %}');

    // user-message.md is ALSO left unchanged, and that is the point of this case.
    //
    // This test previously asserted the edit was applied and noted "the Nunjucks conditional IS
    // lost ... accepting lossy reverse compilation for that section". Pull no longer works that
    // way: `service.ts` refuses to write any section whose canonical content contains Nunjucks
    // control flow, because reverse-compiling a rendered skill back over a template destroys the
    // template logic. It skips the write and tells the author to edit the canonical file instead.
    const userContent = await readFile(
      path.join(serverRoot, 'resources', 'prompts', 'test', 'mixed-edit', 'user-message.md'),
      'utf-8'
    );
    expect(userContent).toContain('{% if context %}');
    expect(userContent).toContain('Process: {{input}}');
    expect(userContent).not.toContain('Analyze deeply:');

    // The skip must be reported — a silent refusal would leave the author believing the edit landed.
    const skipWarning = pullOut.warns.find((w) => w.includes('SKIPPED'));
    expect(skipWarning).toBeDefined();
    expect(skipWarning).toContain('userMessage');
    expect(skipWarning).toContain('mixed-edit');
  });

  it('preview mode shows diff without writing', async () => {
    await writePromptResource(serverRoot, 'test', 'preview-test', {
      name: 'Preview',
      description: 'Preview test',
      systemMessage: 'Be helpful and accurate.',
    });
    await writeSyncConfig(serverRoot, outputDir);

    const skillPath = await exportAndGetSkillPath('preview-test');
    const exported = await readFile(skillPath, 'utf-8');
    const edited = exported.replace('Be helpful and accurate.', 'Be extremely helpful.');
    await writeFile(skillPath, edited);

    const pullOut = silentOutput();
    await runSkillsSyncCommand(
      {
        command: 'pull',
        client: 'claude-code',
        scope: 'user',
        preview: true,
      } as SkillsSyncOptions,
      pullOut
    );

    // Should show diff output (unified diff format)
    expect(pullOut.logs.some((l) => l.includes('---') || l.includes('+++'))).toBe(true);

    // But canonical file should NOT be modified
    const sysContent = await readFile(
      path.join(serverRoot, 'resources', 'prompts', 'test', 'preview-test', 'system-message.md'),
      'utf-8'
    );
    expect(sysContent).toBe('Be helpful and accurate.');
  });
});
