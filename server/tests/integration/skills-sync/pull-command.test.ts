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
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

import {
  runSkillsSyncCommand,
  type SkillsSyncOptions,
  type SkillsSyncOutput,
} from '../../../src/modules/skills-sync/service.js';
import { resolveSkillsSyncPaths } from '../../../src/runtime/skills-sync-paths.js';

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
      out,
      resolveSkillsSyncPaths()
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

    // The exported SKILL.md compiles the conditional away, keeping the ELSE branch:
    // an argument is never substituted in a skill, so the if-branch would emit a
    // placeholder that cannot bind while discarding the fallback (F18).
    expect(exported).toContain('Use default formatting.');
    expect(exported).not.toContain('Use {style} formatting.');
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
      pullOut,
      resolveSkillsSyncPaths()
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
      pullOut,
      resolveSkillsSyncPaths()
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
      pullOut,
      resolveSkillsSyncPaths()
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

  /**
   * P6.245 (R132). A pull writes prose only — `name`, `description`, the message and guidance
   * files — so it runs no post-write verification: it cannot introduce an inline gate definition
   * the loader would drop. Pinned driven: a pull over a prompt that already carries one succeeds,
   * writes the edit, and leaves the definition byte-identical. MEASURED 2026-09-28 on `a3fe7159d`.
   */
  it('P6.245 a pull over a prompt carrying a droppable inline definition leaves it byte-identical', async () => {
    const promptDir = await writePromptResource(serverRoot, 'test', 'gated-pull', {
      name: 'Gated Pull',
      description: 'Original description',
      systemMessage: 'Be helpful.',
    });
    const yamlPath = path.join(promptDir, 'prompt.yaml');
    const doc = yaml.load(await readFile(yamlPath, 'utf-8')) as Record<string, unknown>;
    // No `scope`: the loader drops this gate on every load.
    doc['gateConfiguration'] = {
      inline_gate_definitions: [
        {
          name: 'Cites Sources',
          type: 'validation',
          description: 'Every claim names its source.',
          guidance: 'Check each claim for a named source.',
        },
      ],
    };
    await writeFile(yamlPath, yaml.dump(doc, { lineWidth: 120 }));
    const before = await readFile(yamlPath, 'utf-8');
    const definitionBlock = (text: string) => text.slice(text.indexOf('gateConfiguration:'));
    expect(definitionBlock(before)).toContain('inline_gate_definitions:');
    await writeSyncConfig(serverRoot, outputDir);

    const skillPath = await exportAndGetSkillPath('gated-pull');
    const exported = await readFile(skillPath, 'utf-8');
    expect(exported).toContain('description: Original description');
    await writeFile(
      skillPath,
      exported.replace('description: Original description', 'description: Updated desc')
    );

    const pullOut = silentOutput();
    const report = await runSkillsSyncCommand(
      { command: 'pull', client: 'claude-code', scope: 'user' } as SkillsSyncOptions,
      pullOut,
      resolveSkillsSyncPaths()
    );

    expect(report.failures).toEqual([]);
    const after = await readFile(yamlPath, 'utf-8');
    // Control: the write happened.
    expect((yaml.load(after) as Record<string, unknown>)['description']).toBe('Updated desc');
    expect(definitionBlock(after)).toBe(definitionBlock(before));
  });

  /**
   * P6.256 (R140). A pull writes `name`/`description` into `prompt.yaml` through the
   * source-preserving serializer, not a whole-document dump, so a file a person wrote keeps its
   * comments, key order and flow-style lists. The fixture is HAND-AUTHORED: a writer-seeded file
   * would only prove idempotence. MEASURED 2026-09-28 on `6f31b733d`: the dump dropped both
   * comments and re-rendered every line.
   */
  describe('P6.256 a pull edits only the field it pulled', () => {
    const HAND_AUTHORED = [
      '# Operator note: hand-maintained, keep this comment.',
      'description: Original description # why this wording',
      'category: test',
      'id: commented-pull',
      'name: Commented Pull',
      'systemMessageFile: system-message.md',
      'gateConfiguration:',
      '  exclude: [alpha-gate, beta-gate]',
      '# trailing comment, last line of the file',
      '',
    ].join('\n');

    async function seedHandAuthored(): Promise<string> {
      const promptDir = path.join(serverRoot, 'resources', 'prompts', 'test', 'commented-pull');
      await mkdir(promptDir, { recursive: true });
      await writeFile(path.join(promptDir, 'system-message.md'), 'Be helpful.');
      const yamlPath = path.join(promptDir, 'prompt.yaml');
      await writeFile(yamlPath, HAND_AUTHORED);
      await writeSyncConfig(serverRoot, outputDir);
      return yamlPath;
    }

    async function pull(): Promise<ReturnType<typeof silentOutput>> {
      const pullOut = silentOutput();
      const report = await runSkillsSyncCommand(
        { command: 'pull', client: 'claude-code', scope: 'user' } as SkillsSyncOptions,
        pullOut,
        resolveSkillsSyncPaths()
      );
      expect(report.failures).toEqual([]);
      return pullOut;
    }

    it('(a) after a description pull the file differs from the fixture on that line only', async () => {
      const yamlPath = await seedHandAuthored();
      const skillPath = await exportAndGetSkillPath('commented-pull');
      const exported = await readFile(skillPath, 'utf-8');
      expect(exported).toContain('description: Original description');
      await writeFile(
        skillPath,
        exported.replace('description: Original description', 'description: Updated desc')
      );

      const pullOut = await pull();

      expect(pullOut.logs.some((line) => line.includes('wrote description'))).toBe(true);
      const after = await readFile(yamlPath, 'utf-8');
      const beforeLines = HAND_AUTHORED.split('\n');
      const afterLines = after.split('\n');
      expect(afterLines.length).toBe(beforeLines.length);
      const changed = beforeLines
        .map((line, index) => ({ before: line, after: afterLines[index] }))
        .filter((pair) => pair.before !== pair.after);
      expect(changed).toEqual([
        {
          before: 'description: Original description # why this wording',
          after: 'description: Updated desc # why this wording',
        },
      ]);
    });

    it('(b) control: a pull that changes nothing leaves the file byte-identical', async () => {
      const yamlPath = await seedHandAuthored();
      await exportAndGetSkillPath('commented-pull');

      const pullOut = await pull();

      expect(pullOut.logs.some((line) => line.includes('no prose changes'))).toBe(true);
      expect(await readFile(yamlPath, 'utf-8')).toBe(HAND_AUTHORED);
    });
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
      pullOut,
      resolveSkillsSyncPaths()
    );

    // Should report no changes
    expect(pullOut.logs.some((l) => l.includes('no prose changes'))).toBe(true);
  });

  it('preview mode reports changes without writing files', async () => {
    await writePromptResource(serverRoot, 'test', 'preview-test', {
      name: 'Preview',
      description: 'Preview test',
      systemMessage: 'Original content.',
    });
    await writeSyncConfig(serverRoot, outputDir);

    const skillPath = await exportAndGetSkillPath('preview-test');
    const exported = await readFile(skillPath, 'utf-8');
    const edited = exported.replace('Original content.', 'Modified content.');
    await writeFile(skillPath, edited);

    const pullOut = silentOutput();
    await runSkillsSyncCommand(
      {
        command: 'pull',
        client: 'claude-code',
        scope: 'user',
        preview: true,
      } as SkillsSyncOptions,
      pullOut,
      resolveSkillsSyncPaths()
    );

    // Should report the change
    expect(pullOut.logs.some((l) => l.includes('prose change'))).toBe(true);

    // But file should NOT be modified
    const sysContent = await readFile(
      path.join(serverRoot, 'resources', 'prompts', 'test', 'preview-test', 'system-message.md'),
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
      pullOut,
      resolveSkillsSyncPaths()
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
        // The depth is what produces a unified diff. Plain `preview` reports the planned change
        // and stops, which is the behaviour the old `--dry-run` had.
        previewDetail: 'diff',
      } as SkillsSyncOptions,
      pullOut,
      resolveSkillsSyncPaths()
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
  // ─── Branch coverage tier (row 0C3.6): agent-skills clients, non-prompt guidance, skips ────────

  /** A `gate.yaml` + `guidance.md` pair under `resources/gates/<id>/`. */
  async function writeGateResource(id: string, guidance: string): Promise<string> {
    const gateDir = path.join(serverRoot, 'resources', 'gates', id);
    await mkdir(gateDir, { recursive: true });
    await writeFile(
      path.join(gateDir, 'gate.yaml'),
      yaml.dump({ id, name: `Gate ${id}`, description: `The ${id} gate`, type: 'guidance' })
    );
    await writeFile(path.join(gateDir, 'guidance.md'), guidance);
    return gateDir;
  }

  /** A `style.yaml` + `guidance.md` pair under `resources/styles/<id>/`. */
  async function writeStyleResource(id: string, guidance: string): Promise<string> {
    const styleDir = path.join(serverRoot, 'resources', 'styles', id);
    await mkdir(styleDir, { recursive: true });
    await writeFile(
      path.join(styleDir, 'style.yaml'),
      yaml.dump({ id, name: `Style ${id}`, description: `The ${id} style` })
    );
    await writeFile(path.join(styleDir, 'guidance.md'), guidance);
    return styleDir;
  }

  async function pullFor(
    clientId: string,
    out = silentOutput()
  ): Promise<{
    out: ReturnType<typeof silentOutput>;
    report: Awaited<ReturnType<typeof runSkillsSyncCommand>>;
  }> {
    const report = await runSkillsSyncCommand(
      { command: 'pull', client: clientId, scope: 'user' } as SkillsSyncOptions,
      out,
      resolveSkillsSyncPaths()
    );
    return { out, report };
  }

  function listTree(root: string): string[] {
    return readdirSync(root, { recursive: true }).map(String).sort();
  }

  it('pulls a codex (agent-skills) edit back with plain {arg} placeholders reverse-compiled', async () => {
    await writePromptResource(serverRoot, 'test', 'codex-pull', {
      name: 'Codex Pull',
      description: 'Pulled through an agent-skills client',
      systemMessage: 'Review {{language}} code.',
      userMessage: 'Check: {{input}}',
      arguments: [
        { name: 'language', type: 'string', description: 'Language', required: true },
        { name: 'input', type: 'string', description: 'Input', required: true },
      ],
    });
    await writeSyncConfig(serverRoot, outputDir, 'codex');

    const skillPath = await exportAndGetSkillPath('codex-pull', 'codex');
    const exported = await readFile(skillPath, 'utf-8');
    // Precondition: this is the agent-skills adapter's file, and it carries the sections to edit.
    expect(exported).toContain('compatibility:');
    expect(exported).toContain('Review {language} code.');
    expect(exported).toContain('Check: {input}');
    const edited = exported
      .replace('Review {language} code.', 'Audit {language} code thoroughly.')
      .replace('Check: {input}', 'Inspect: {input}');
    expect(edited).not.toBe(exported);
    await writeFile(skillPath, edited);

    const promptDir = path.join(serverRoot, 'resources', 'prompts', 'test', 'codex-pull');
    expect(await readFile(path.join(promptDir, 'system-message.md'), 'utf-8')).toBe(
      'Review {{language}} code.'
    );

    const { report } = await pullFor('codex');

    expect(report.failures).toEqual([]);
    expect(await readFile(path.join(promptDir, 'system-message.md'), 'utf-8')).toBe(
      'Audit {{language}} code thoroughly.'
    );
    expect(await readFile(path.join(promptDir, 'user-message.md'), 'utf-8')).toBe(
      'Inspect: {{input}}'
    );
    expect(report.written).toBe(2);
  });

  describe.each(['claude-code', 'codex'])(
    "a %s guidance pull writes into the resource's own directory",
    (clientId) => {
      it('lands a gate and a style edit beside gate.yaml and style.yaml, never in the prompts root', async () => {
        await writePromptResource(serverRoot, 'test', 'decoy', {
          name: 'Decoy',
          description: 'A prompt that must stay untouched',
          systemMessage: 'Stay put.',
        });
        const gateDir = await writeGateResource('tone-gate', 'Keep the tone neutral.');
        const styleDir = await writeStyleResource('terse-style', 'Answer in short lines.');
        await writeSyncConfig(serverRoot, outputDir, clientId);
        await runSkillsSyncCommand(
          { command: 'export', client: clientId, scope: 'user' } as SkillsSyncOptions,
          silentOutput(),
          resolveSkillsSyncPaths()
        );

        const gateSkill = path.join(outputDir, 'gates-tone-gate', 'SKILL.md');
        const styleSkill = path.join(outputDir, 'styles-terse-style', 'SKILL.md');
        const gateExported = await readFile(gateSkill, 'utf-8');
        const styleExported = await readFile(styleSkill, 'utf-8');
        // Precondition: each SKILL.md carries the guidance, and the edit makes it differ.
        expect(gateExported).toContain('Keep the tone neutral.');
        expect(styleExported).toContain('Answer in short lines.');
        await writeFile(
          gateSkill,
          gateExported.replace('Keep the tone neutral.', 'Keep the tone warm.')
        );
        await writeFile(
          styleSkill,
          styleExported.replace('Answer in short lines.', 'Answer in one line.')
        );
        const gateYamlBefore = await readFile(path.join(gateDir, 'gate.yaml'), 'utf-8');
        const styleYamlBefore = await readFile(path.join(styleDir, 'style.yaml'), 'utf-8');
        const promptsBefore = listTree(path.join(serverRoot, 'resources', 'prompts'));

        const { out, report } = await pullFor(clientId);

        expect(report.failures).toEqual([]);
        expect(await readFile(path.join(gateDir, 'guidance.md'), 'utf-8')).toBe(
          'Keep the tone warm.'
        );
        expect(await readFile(path.join(styleDir, 'guidance.md'), 'utf-8')).toBe(
          'Answer in one line.'
        );
        // Only the guidance file moved: the YAML beside it is byte-identical.
        expect(await readFile(path.join(gateDir, 'gate.yaml'), 'utf-8')).toBe(gateYamlBefore);
        expect(await readFile(path.join(styleDir, 'style.yaml'), 'utf-8')).toBe(styleYamlBefore);
        // Control: nothing leaked into the prompts root, and the log names the typed directories.
        expect(listTree(path.join(serverRoot, 'resources', 'prompts'))).toEqual(promptsBefore);
        expect(
          out.logs.some((l) => l.includes(path.join('gates', 'tone-gate', 'guidance.md')))
        ).toBe(true);
        expect(
          out.logs.some((l) => l.includes(path.join('styles', 'terse-style', 'guidance.md')))
        ).toBe(true);
        expect(report.written).toBe(2);
      });

      it('writes a gate description edit into gate.yaml and leaves its guidance alone', async () => {
        const gateDir = await writeGateResource('tone-gate', 'Keep the tone neutral.');
        await writeSyncConfig(serverRoot, outputDir, clientId);
        await runSkillsSyncCommand(
          { command: 'export', client: clientId, scope: 'user' } as SkillsSyncOptions,
          silentOutput(),
          resolveSkillsSyncPaths()
        );
        const gateSkill = path.join(outputDir, 'gates-tone-gate', 'SKILL.md');
        const exported = await readFile(gateSkill, 'utf-8');
        expect(exported).toContain('description: The tone-gate gate');
        await writeFile(
          gateSkill,
          exported.replace('description: The tone-gate gate', 'description: A reworded gate')
        );

        const { report } = await pullFor(clientId);

        expect(report.failures).toEqual([]);
        const gateDoc = yaml.load(
          await readFile(path.join(gateDir, 'gate.yaml'), 'utf-8')
        ) as Record<string, unknown>;
        expect(gateDoc['description']).toBe('A reworded gate');
        expect(await readFile(path.join(gateDir, 'guidance.md'), 'utf-8')).toBe(
          'Keep the tone neutral.'
        );
        expect(report.written).toBe(1);
      });
    }
  );

  it('writes nothing for a resource whose SKILL.md is absent or identical to its export', async () => {
    for (const id of ['absent-skill', 'identical-skill', 'edited-skill']) {
      await writePromptResource(serverRoot, 'test', id, {
        name: id,
        description: `The ${id} prompt`,
        systemMessage: `Original ${id}.`,
        userMessage: `Usage of ${id}.`,
      });
    }
    await writeSyncConfig(serverRoot, outputDir);
    await exportAndGetSkillPath('absent-skill');
    const absentPath = path.join(outputDir, 'absent-skill', 'SKILL.md');
    const editedPath = path.join(outputDir, 'edited-skill', 'SKILL.md');
    const identicalPath = path.join(outputDir, 'identical-skill', 'SKILL.md');
    // Precondition: all three exist after the export; then one is removed and one is edited.
    expect(existsSync(absentPath) && existsSync(editedPath) && existsSync(identicalPath)).toBe(
      true
    );
    const identicalExported = await readFile(identicalPath, 'utf-8');
    await rm(absentPath);
    await writeFile(
      editedPath,
      (await readFile(editedPath, 'utf-8')).replace('Original edited-skill.', 'Rewritten.')
    );
    const promptsRoot = path.join(serverRoot, 'resources', 'prompts', 'test');
    const sysPath = (id: string) => path.join(promptsRoot, id, 'system-message.md');

    const { out, report } = await pullFor('claude-code');

    expect(report.failures).toEqual([]);
    expect(await readFile(sysPath('edited-skill'), 'utf-8')).toBe('Rewritten.');
    // Only the section that was edited is rewritten: the usage beside it is as it was.
    expect(await readFile(path.join(promptsRoot, 'edited-skill', 'user-message.md'), 'utf-8')).toBe(
      'Usage of edited-skill.'
    );
    expect(await readFile(sysPath('absent-skill'), 'utf-8')).toBe('Original absent-skill.');
    expect(await readFile(sysPath('identical-skill'), 'utf-8')).toBe('Original identical-skill.');
    // The pull neither recreated the missing file nor touched the identical one, and counted one.
    expect(existsSync(absentPath)).toBe(false);
    expect(await readFile(identicalPath, 'utf-8')).toBe(identicalExported);
    expect(out.logs.some((l) => l.includes('pulled 1 resource(s)'))).toBe(true);
    expect(report.written).toBe(1);
  });

  it('writes nothing when the prompt.yaml has emptied between loading and writing', async () => {
    const promptDir = await writePromptResource(serverRoot, 'test', 'emptied-yaml', {
      name: 'Emptied Yaml',
      description: 'Original description',
      systemMessage: 'Be helpful.',
    });
    const yamlPath = path.join(promptDir, 'prompt.yaml');
    await writeSyncConfig(serverRoot, outputDir);
    const skillPath = await exportAndGetSkillPath('emptied-yaml');
    const exported = await readFile(skillPath, 'utf-8');
    await writeFile(
      skillPath,
      exported.replace('description: Original description', 'description: Updated desc')
    );
    // Precondition: the file the pull is about to write into holds a document.
    expect((await readFile(yamlPath, 'utf-8')).length).toBeGreaterThan(0);

    // The pull announces the change after it loaded the resource and before it writes: emptying the
    // file at that line is the one way a loaded resource reaches the write with a blank YAML.
    const out = silentOutput();
    const log = out.log;
    out.log = (...args: unknown[]) => {
      log(...args);
      if (args.map(String).join(' ').includes('[description] → prompt.yaml')) {
        writeFileSync(yamlPath, '');
      }
    };

    const { report } = await pullFor('claude-code', out);

    expect(await readFile(yamlPath, 'utf-8')).toBe('');
    expect(report.failures).toEqual([]);
    expect(report.written).toBe(0);
    expect(out.logs.some((l) => l.includes('no prose changes to pull'))).toBe(true);
  });

  /**
   * Row 0C3.10. A pull writes the edit to the location the type's loader reads. Each case
   * re-exports after the pull: the export reloads the resource, so an edit written anywhere the
   * loader does not read reverts to the old text in the regenerated SKILL.md.
   */
  describe('0C3.10 a guidance pull lands where the loader reads it', () => {
    async function exportFor(clientId: string): Promise<void> {
      await runSkillsSyncCommand(
        { command: 'export', client: clientId, scope: 'user' } as SkillsSyncOptions,
        silentOutput(),
        resolveSkillsSyncPaths()
      );
    }

    /** Export, replace `from` with `to` in `<skillDir>/SKILL.md`, and return the pull's result. */
    async function editAndPull(skillDir: string, from: string, to: string) {
      await exportFor('claude-code');
      const skillPath = path.join(outputDir, skillDir, 'SKILL.md');
      const exported = await readFile(skillPath, 'utf-8');
      // Precondition: the text being edited is in the file, so the edit changes it.
      expect(exported).toContain(from);
      await writeFile(skillPath, exported.replace(from, to));
      return pullFor('claude-code');
    }

    it('writes a framework guidance edit into systemPromptGuidance, the one field the loader reads', async () => {
      const fwDir = path.join(serverRoot, 'resources', 'frameworks', 'tonefw');
      await mkdir(fwDir, { recursive: true });
      await writeFile(
        path.join(fwDir, 'framework.yaml'),
        yaml.dump({
          id: 'tonefw',
          name: 'Tone Framework',
          type: 'TONE',
          version: '1.0.0',
          enabled: true,
          systemPromptGuidance: 'Apply the tone method.',
        })
      );
      await writeSyncConfig(serverRoot, outputDir);

      const { out, report } = await editAndPull(
        'frameworks-tonefw',
        'Apply the tone method.',
        'Apply the revised tone method.'
      );

      expect(report.failures).toEqual([]);
      expect(out.logs.join('\n')).toContain('pulled 1 resource(s)');
      const doc = yaml.load(await readFile(path.join(fwDir, 'framework.yaml'), 'utf-8')) as Record<
        string,
        unknown
      >;
      expect(doc['systemPromptGuidance']).toBe('Apply the revised tone method.');
      // The other fields survive, and no file nobody reads appears beside the YAML.
      expect(doc['name']).toBe('Tone Framework');
      expect(existsSync(path.join(fwDir, 'guidance.md'))).toBe(false);
      // The loader serves the edit: a re-export carries it.
      await exportFor('claude-code');
      expect(
        await readFile(path.join(outputDir, 'frameworks-tonefw', 'SKILL.md'), 'utf-8')
      ).toContain('Apply the revised tone method.');
    });

    it.each([
      ['gate', 'gates', 'gate.yaml', 'gates-tone-gate', 'tone-gate'],
      ['style', 'styles', 'style.yaml', 'styles-terse-style', 'terse-style'],
    ])(
      'writes a %s guidance edit to the file guidanceFile names, not a new guidance.md',
      async (type, dirName, yamlName, skillDir, id) => {
        const dir = path.join(serverRoot, 'resources', dirName, id);
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, yamlName),
          yaml.dump({
            id,
            name: `${type} ${id}`,
            description: `The ${id} ${type}`,
            ...(type === 'gate' ? { type: 'guidance' } : {}),
            guidanceFile: 'custom.md',
          })
        );
        await writeFile(path.join(dir, 'custom.md'), 'Original custom guidance.');
        await writeSyncConfig(serverRoot, outputDir);

        const { report } = await editAndPull(
          skillDir,
          'Original custom guidance.',
          'Edited custom guidance.'
        );

        expect(report.failures).toEqual([]);
        expect(await readFile(path.join(dir, 'custom.md'), 'utf-8')).toBe(
          'Edited custom guidance.'
        );
        expect(existsSync(path.join(dir, 'guidance.md'))).toBe(false);
        await exportFor('claude-code');
        expect(await readFile(path.join(outputDir, skillDir, 'SKILL.md'), 'utf-8')).toContain(
          'Edited custom guidance.'
        );
      }
    );
  });

  describe('a pull that would edit the bundled package tree', () => {
    it('is refused naming the resources directory when no workspace is set, and a library prompt still pulls', async () => {
      // `MCP_RESOURCES_PATH` moves the write root without setting a workspace; the bundled tree
      // (`<serverRoot>/resources`) stays loaded underneath.
      const libraryParent = path.join(tmpDir, 'library');
      const libraryResources = path.join(libraryParent, 'resources');
      await mkdir(path.join(libraryResources, 'prompts'), { recursive: true });
      process.env['MCP_RESOURCES_PATH'] = libraryResources;
      const writeRoot = path.join(libraryResources, 'prompts');

      const bundledDir = await writePromptResource(serverRoot, 'test', 'bundled-one', {
        name: 'Bundled One',
        description: 'Lives in the package tree',
        systemMessage: 'Bundled original.',
      });
      const libraryDir = await writePromptResource(libraryParent, 'test', 'library-one', {
        name: 'Library One',
        description: 'Lives in the operator library',
        systemMessage: 'Library original.',
      });
      await writeSyncConfig(serverRoot, outputDir);
      await runSkillsSyncCommand(
        { command: 'export', client: 'claude-code', scope: 'user' } as SkillsSyncOptions,
        silentOutput(),
        resolveSkillsSyncPaths()
      );
      for (const [id, from, to] of [
        ['bundled-one', 'Bundled original.', 'Bundled edited.'],
        ['library-one', 'Library original.', 'Library edited.'],
      ] as const) {
        const skillPath = path.join(outputDir, id, 'SKILL.md');
        const exported = await readFile(skillPath, 'utf-8');
        // Precondition: the section being edited is in the file.
        expect(exported).toContain(from);
        await writeFile(skillPath, exported.replace(from, to));
      }
      const bundledSys = path.join(bundledDir, 'system-message.md');
      const librarySys = path.join(libraryDir, 'system-message.md');

      const { out, report } = await pullFor('claude-code');

      const refusal = out.warns.find((w) => w.includes('Refusing to pull prompt bundled-one'));
      expect(refusal).toBeDefined();
      expect(refusal).toContain(`${bundledSys} is in the bundled package tree`);
      expect(refusal).toContain(`while the resources directory ${writeRoot} is configured`);
      expect(refusal).toContain(`Copy the prompt into ${writeRoot} and pull again.`);
      expect(refusal).not.toContain('the workspace');
      expect(report.failures).toEqual([{ id: 'bundled-one', reason: refusal }]);
      expect(await readFile(bundledSys, 'utf-8')).toBe('Bundled original.');
      // The prompt that lives in the write root is not bundled, so it is not refused.
      expect(await readFile(librarySys, 'utf-8')).toBe('Library edited.');

      // Control: with no resources override the write root IS the bundled tree, and the same
      // edited SKILL.md pulls.
      delete process.env['MCP_RESOURCES_PATH'];
      const second = await pullFor('claude-code');
      expect(second.report.failures).toEqual([]);
      expect(await readFile(bundledSys, 'utf-8')).toBe('Bundled edited.');
    });
  });
});
