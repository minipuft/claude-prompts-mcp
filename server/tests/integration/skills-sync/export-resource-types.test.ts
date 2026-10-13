/**
 * Export Resource-Type Coverage
 *
 * `export-command.test.ts` pins the prompt-and-gate path. This file pins what that one never
 * reached: frameworks and styles, the `--resource-type` / `--id` filters, a prompt's `docs/` and
 * chain step directories, delegation, the gate shapes an author can leave half-filled, same-id
 * prompts across categories, and a preview over a managed skill — plus the three places an export
 * used to log a skipped or degraded resource without recording it in the report.
 *
 * Real loader, real gate resolver, real adapters, real filesystem in a temp dir; only the I/O
 * location is redirected, via MCP_SERVER_ROOT (which must contain `resources/`, or the resolver
 * falls back to the real `server/`) and an output-dir override.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

import {
  emitGateFiles,
  runSkillsSyncCommand,
  type SkillsSyncOptions,
  type SkillsSyncOutput,
} from '../../../src/modules/skills-sync/service.js';
import { resolveSkillsSyncPaths } from '../../../src/runtime/skills-sync-paths.js';

function silentOutput(): SkillsSyncOutput & { logs: string[]; warns: string[]; errors: string[] } {
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    warns,
    errors,
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => warns.push(args.map(String).join(' ')),
    error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** A YAML document the parser refuses: an unclosed flow sequence. */
const MALFORMED_YAML = 'id: broken\nname: [unclosed\n';

describe('Export resource types', () => {
  let tmpDir: string;
  let serverRoot: string;
  let outputDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'skills-export-types-'));
    serverRoot = path.join(tmpDir, 'server');
    outputDir = path.join(tmpDir, 'output');
    // `resources/` must exist: an MCP_SERVER_ROOT without it silently falls back to the real tree.
    await mkdir(path.join(serverRoot, 'resources'), { recursive: true });
    await mkdir(outputDir, { recursive: true });

    savedEnv = {
      MCP_SERVER_ROOT: process.env['MCP_SERVER_ROOT'],
      MCP_RESOURCES_PATH: process.env['MCP_RESOURCES_PATH'],
      MCP_WORKSPACE: process.env['MCP_WORKSPACE'],
    };
    process.env['MCP_SERVER_ROOT'] = serverRoot;
    delete process.env['MCP_RESOURCES_PATH'];
    delete process.env['MCP_WORKSPACE'];
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ─── Fixtures ──────────────────────────────────────────────────────────────

  async function writeConfig(clientId = 'claude-code'): Promise<void> {
    await writeFile(
      path.join(serverRoot, 'skills-sync.yaml'),
      yaml.dump({
        registrations: { [clientId]: 'all' },
        overrides: { [clientId]: { outputDir: { user: outputDir, project: outputDir } } },
      })
    );
  }

  /** Writes a gate directory; `dirName` differs from `id` when a test needs that. */
  async function writeGate(
    id: string,
    extra: Record<string, unknown> = {},
    opts: { dirName?: string; guidance?: string | null } = {}
  ): Promise<string> {
    const gateDir = path.join(serverRoot, 'resources', 'gates', opts.dirName ?? id);
    await mkdir(gateDir, { recursive: true });
    await writeFile(
      path.join(gateDir, 'gate.yaml'),
      yaml.dump({ id, name: id, type: 'validation', description: `${id} gate`, ...extra })
    );
    if (opts.guidance !== null) {
      await writeFile(path.join(gateDir, 'guidance.md'), opts.guidance ?? `Guidance for ${id}.`);
    }
    return gateDir;
  }

  async function writePrompt(
    category: string,
    id: string,
    extra: Record<string, unknown> = {}
  ): Promise<string> {
    const dir = path.join(serverRoot, 'resources', 'prompts', category, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'user-message.md'), 'Do the thing.');
    await writeFile(
      path.join(dir, 'prompt.yaml'),
      yaml.dump({
        id,
        name: id,
        description: `${id} description`,
        category,
        userMessageTemplateFile: 'user-message.md',
        ...extra,
      })
    );
    return dir;
  }

  async function writeFramework(id: string, phases: unknown[] = []): Promise<string> {
    const dir = path.join(serverRoot, 'resources', 'frameworks', id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'framework.yaml'),
      yaml.dump({
        id,
        name: `${id} Framework`,
        type: id.toUpperCase(),
        version: '2.3.4',
        enabled: true,
        systemPromptGuidance: `Apply the ${id} method step by step.`,
      })
    );
    if (phases.length > 0) await writeFile(path.join(dir, 'phases.yaml'), yaml.dump(phases));
    return dir;
  }

  async function writeStyle(id: string, extra: Record<string, unknown> = {}): Promise<string> {
    const dir = path.join(serverRoot, 'resources', 'styles', id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'style.yaml'),
      yaml.dump({
        id,
        name: `${id} Style`,
        description: `${id} style description`,
        guidanceFile: 'guidance.md',
        priority: 7,
        enabled: true,
        enhancementMode: 'append',
        ...extra,
      })
    );
    await writeFile(path.join(dir, 'guidance.md'), `Write in the ${id} voice.`);
    return dir;
  }

  async function run(
    overrides: Partial<SkillsSyncOptions> = {},
    clientId = 'claude-code'
  ): Promise<{
    out: ReturnType<typeof silentOutput>;
    report: Awaited<ReturnType<typeof runSkillsSyncCommand>>;
  }> {
    const out = silentOutput();
    const report = await runSkillsSyncCommand(
      { command: 'export', client: clientId, scope: 'user', ...overrides } as SkillsSyncOptions,
      out,
      resolveSkillsSyncPaths()
    );
    return { out, report };
  }

  const read = (...segments: string[]): Promise<string> =>
    readFile(path.join(outputDir, ...segments), 'utf-8');

  // ─── A resource that fails to load is recorded, not only logged ─────────────

  describe('a resource whose yaml cannot be loaded is recorded in the run report', () => {
    // The prompt catch has always pushed to `report.failures`; the gate, framework and style
    // catches only logged, so a run reported success (and `--json` showed `failures: []`) while a
    // resource was skipped.
    const kinds = [
      {
        kind: 'gate' as const,
        file: 'gate.yaml',
        dir: (): string => path.join(serverRoot, 'resources', 'gates', 'broken-gate'),
        writeGood: (): Promise<unknown> => writeGate('good-gate'),
        goodSkill: 'gates-good-gate',
      },
      {
        kind: 'framework' as const,
        file: 'framework.yaml',
        dir: (): string => path.join(serverRoot, 'resources', 'frameworks', 'broken-fw'),
        writeGood: (): Promise<unknown> => writeFramework('goodfw'),
        goodSkill: 'frameworks-goodfw',
      },
      {
        kind: 'style' as const,
        file: 'style.yaml',
        dir: (): string => path.join(serverRoot, 'resources', 'styles', 'broken-style'),
        writeGood: (): Promise<unknown> => writeStyle('goodstyle'),
        goodSkill: 'styles-goodstyle',
      },
    ];

    it.each(kinds)(
      'a malformed $file is a report failure, and the sibling $kind still exports',
      async ({ kind, file, dir, writeGood, goodSkill }) => {
        await writeConfig();
        await writeGood();
        await mkdir(dir(), { recursive: true });
        await writeFile(path.join(dir(), file), MALFORMED_YAML);

        const { out, report } = await run({ resourceType: kind });

        const recorded = report.failures.filter((f) => f.id.includes(path.basename(dir())));
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.reason).toContain(`${kind} skipped`);
        // The log line stays: the report is an addition, not a replacement.
        expect(out.errors.some((l) => l.includes(`skip ${kind} ${path.basename(dir())}`))).toBe(
          true
        );
        // The rest of the run is untouched.
        expect(await exists(path.join(outputDir, goodSkill, 'SKILL.md'))).toBe(true);
      }
    );

    it('the --json report carries the failure', async () => {
      await writeConfig();
      await writeStyle('goodstyle');
      const broken = path.join(serverRoot, 'resources', 'styles', 'broken-style');
      await mkdir(broken, { recursive: true });
      await writeFile(path.join(broken, 'style.yaml'), MALFORMED_YAML);

      const { out } = await run({ resourceType: 'style', json: true });

      const parsed = JSON.parse(out.logs[0] as string) as {
        failures: Array<{ id: string; reason: string }>;
      };
      expect(parsed.failures.some((f) => f.id.includes('broken-style'))).toBe(true);
    });

    it('a clean run records no failure for the same resource type (control)', async () => {
      await writeConfig();
      await writeStyle('goodstyle');

      const { report } = await run({ resourceType: 'style' });

      expect(report.failures.filter((f) => f.reason.includes('skipped'))).toEqual([]);
    });
  });

  // ─── A gate registered under an id that is not its directory name ───────────

  describe('a gate whose declared id differs from its directory name', () => {
    it('is resolved by id: the exported skill carries its criteria', async () => {
      // `gatesById` is keyed by the declared id while `gateDirs` is keyed by directory name, so
      // this gate was registered and then silently dropped at the directory lookup.
      await writeGate(
        'my-gate',
        { pass_criteria: [{ type: 'shell_verify', shell_command: ['npm', 'run', 'idcheck'] }] },
        { dirName: 'my-gate-dir' }
      );
      await writePrompt('general', 'uses_gate', {
        gateConfiguration: { include: ['my-gate'] },
      });
      await writeConfig();

      await run({ resourceType: 'prompt' });

      const skill = await read('uses_gate', 'SKILL.md');
      expect(skill).toContain('npm run idcheck');
      expect(await exists(path.join(outputDir, 'uses_gate', 'gates', 'my-gate', 'gate.yaml'))).toBe(
        true
      );
    });

    it('a gate whose id equals its directory name still resolves (control)', async () => {
      await writeGate('same-name', {
        pass_criteria: [{ type: 'shell_verify', shell_command: ['npm', 'run', 'samecheck'] }],
      });
      await writePrompt('general', 'uses_same', {
        gateConfiguration: { include: ['same-name'] },
      });
      await writeConfig();

      await run({ resourceType: 'prompt' });

      expect(await read('uses_same', 'SKILL.md')).toContain('npm run samecheck');
    });
  });

  // ─── A registered gate whose yaml cannot be parsed says so ──────────────────

  describe('an unparsable registered gate.yaml', () => {
    it('emitGateFiles warns naming the gate, and still ships the file and a manifest entry', () => {
      const out = silentOutput();
      const files = emitGateFiles(
        [
          {
            id: 'garbled',
            source: 'registered',
            gateYamlContent: MALFORMED_YAML,
            guidanceContent: null,
          },
        ],
        'skill',
        'skill',
        out
      );

      expect(out.warns).toHaveLength(1);
      expect(out.warns[0]).toContain('garbled');
      expect(out.warns[0]).toContain('gate.yaml');
      expect(files.map((f) => f.relativePath)).toContain('skill/gates/garbled/gate.yaml');
      const manifest = JSON.parse(
        files.find((f) => f.relativePath === 'skill/gates/index.json')?.content ?? '{}'
      ) as { gates: Array<{ id: string }> };
      expect(manifest.gates.map((g) => g.id)).toEqual(['garbled']);
    });

    it('emitGateFiles stays silent for a parsable gate (control)', () => {
      const out = silentOutput();
      emitGateFiles(
        [
          {
            id: 'fine',
            source: 'registered',
            gateYamlContent: yaml.dump({ id: 'fine', name: 'fine' }),
            guidanceContent: null,
          },
        ],
        'skill',
        'skill',
        out
      );

      expect(out.warns).toEqual([]);
    });
  });

  // ─── A tool-index read that throws keeps its cause ──────────────────────────

  describe('a tool index that cannot be read', () => {
    function throwingIndex(message: string) {
      return {
        isInitialized: () => true,
        query: () => {
          throw new Error(message);
        },
        run: () => undefined,
        transaction: (fn: () => void) => fn(),
      };
    }

    it('names the database error in the warning, not only "Tools not found"', async () => {
      await writePrompt('general', 'plain');
      await writeConfig();
      const out = silentOutput();

      await runSkillsSyncCommand(
        {
          command: 'export',
          client: 'claude-code',
          scope: 'user',
          dbManager: throwingIndex('disk I/O error at page 7') as never,
        } as SkillsSyncOptions,
        out,
        resolveSkillsSyncPaths()
      );

      const warning = out.warns.find((w) => w.includes('Tools not found in resource index'));
      expect(warning).toBeDefined();
      expect(warning).toContain('disk I/O error at page 7');
    });

    it('an index with no tools and no error carries no cause text (control)', async () => {
      await writePrompt('general', 'plain');
      await writeConfig();
      const out = silentOutput();

      await runSkillsSyncCommand(
        {
          command: 'export',
          client: 'claude-code',
          scope: 'user',
          dbManager: { ...throwingIndex('unused'), query: () => [] } as never,
        } as SkillsSyncOptions,
        out,
        resolveSkillsSyncPaths()
      );

      const warning = out.warns.find((w) => w.includes('Tools not found in resource index'));
      expect(warning).toBeDefined();
      expect(warning).not.toContain('read failed');
    });
  });

  // ─── Frameworks and styles ──────────────────────────────────────────────────

  describe('framework and style directories', () => {
    it('exports a framework with its guidance, version-bearing description and phases', async () => {
      await writeFramework('riskfw', [
        { id: 'p1', name: 'Identify', description: 'Find the risks.' },
        { id: 'p2', name: 'Mitigate', description: 'Reduce them.' },
      ]);
      await writeConfig();

      await run();

      const skill = await read('frameworks-riskfw', 'SKILL.md');
      expect(skill).toContain('name: riskfw Framework');
      expect(skill).toContain('(RISKFW)');
      expect(skill).toContain('## Guidance');
      expect(skill).toContain('Apply the riskfw method step by step.');
      expect(skill).toContain('## Phases');
      expect(skill).toContain('### Identify');
      expect(skill).toContain('Find the risks.');
      expect(skill).toContain('### Mitigate');
    });

    it('exports a style with its guidance and configuration block', async () => {
      await writeStyle('terse', { compatibleFrameworks: ['CAGEERF', '5W1H'] });
      await writeConfig();

      await run();

      const skill = await read('styles-terse', 'SKILL.md');
      expect(skill).toContain('## Guidance');
      expect(skill).toContain('Write in the terse voice.');
      expect(skill).toContain('## Style Configuration');
      expect(skill).toContain('- **Priority**: 7');
      expect(skill).toContain('- **Enhancement Mode**: append');
      expect(skill).toContain('- **Compatible Frameworks**: CAGEERF, 5W1H');
    });

    it('a disabled framework and a disabled style are skipped, logged, and not written', async () => {
      await writeFramework('offfw');
      await writeStyle('offstyle', { enabled: false });
      const fwYamlPath = path.join(
        serverRoot,
        'resources',
        'frameworks',
        'offfw',
        'framework.yaml'
      );
      await writeFile(
        fwYamlPath,
        yaml.dump({ id: 'offfw', name: 'Off', type: 'OFF', enabled: false })
      );
      await writeConfig();

      const { out } = await run();

      expect(await exists(path.join(outputDir, 'frameworks-offfw'))).toBe(false);
      expect(await exists(path.join(outputDir, 'styles-offstyle'))).toBe(false);
      expect(out.logs.some((l) => l.includes('skip disabled: framework/offfw'))).toBe(true);
      expect(out.logs.some((l) => l.includes('skip disabled: style/offstyle'))).toBe(true);
    });
  });

  describe('--resource-type and --id filters', () => {
    beforeEach(async () => {
      await writePrompt('general', 'a_prompt');
      await writeGate('a-gate');
      await writeFramework('fwone');
      await writeFramework('fwtwo');
      await writeStyle('styleone');
      await writeConfig();
    });

    async function exportedDirs(): Promise<string[]> {
      const { readdir } = await import('node:fs/promises');
      return (await readdir(outputDir)).sort();
    }

    it('--resource-type framework exports every framework and nothing else', async () => {
      await run({ resourceType: 'framework' });
      expect(await exportedDirs()).toEqual(['frameworks-fwone', 'frameworks-fwtwo']);
    });

    it('--resource-type style exports every style and nothing else', async () => {
      await run({ resourceType: 'style' });
      expect(await exportedDirs()).toEqual(['styles-styleone']);
    });

    it('--resource-type framework --id exports only the named framework', async () => {
      await run({ resourceType: 'framework', id: 'fwtwo' });
      expect(await exportedDirs()).toEqual(['frameworks-fwtwo']);
    });

    it('--id alone selects by directory name across non-prompt types', async () => {
      await run({ id: 'styleone' });
      expect(await exportedDirs()).toEqual(['styles-styleone']);
    });

    it('--id naming nothing exports nothing (control)', async () => {
      const { report } = await run({ resourceType: 'framework', id: 'nope' });
      expect(await exportedDirs()).toEqual([]);
      expect(report.resources).toBe(0);
    });

    it('no filter exports all four resource types (control)', async () => {
      await run();
      expect(await exportedDirs()).toEqual([
        'a_prompt',
        'frameworks-fwone',
        'frameworks-fwtwo',
        'gates-a-gate',
        'styles-styleone',
      ]);
    });
  });

  // ─── Prompt side files ──────────────────────────────────────────────────────

  describe('a prompt with a docs/ directory', () => {
    it('emits nested .md docs under docs/ and ignores other files', async () => {
      const dir = await writePrompt('general', 'with_docs');
      await mkdir(path.join(dir, 'docs', 'sub'), { recursive: true });
      await writeFile(path.join(dir, 'docs', 'a.md'), '# A doc');
      await writeFile(path.join(dir, 'docs', 'sub', 'b.md'), '# B doc');
      await writeFile(path.join(dir, 'docs', 'skipped.txt'), 'not markdown');
      await writeConfig();

      await run();

      expect(await read('with_docs', 'docs', 'a.md')).toBe('# A doc');
      expect(await read('with_docs', 'docs', 'sub', 'b.md')).toBe('# B doc');
      expect(await exists(path.join(outputDir, 'with_docs', 'docs', 'skipped.txt'))).toBe(false);
    });
  });

  describe('a chain prompt with step directories', () => {
    it('emits each step directory under resources/ and links it from the chain table', async () => {
      const dir = await writePrompt('general', 'stepped', {
        chainSteps: [
          { id: 's1', stepName: 'First', promptId: 'step_one' },
          { id: 's2', stepName: 'Second', promptId: 'general/step_two' },
          { id: 's3', stepName: 'Third', promptId: 'step_missing' },
        ],
      });
      await mkdir(path.join(dir, 'step_one'), { recursive: true });
      await writeFile(path.join(dir, 'step_one', 'prompt.yaml'), 'id: step_one\nname: One\n');
      await writeFile(path.join(dir, 'step_one', 'system-message.md'), 'Step one system.');
      await writeFile(path.join(dir, 'step_one', 'user-message.md'), 'Step one user.');
      await mkdir(path.join(dir, 'step_two'), { recursive: true });
      await writeFile(path.join(dir, 'step_two', 'prompt.yaml'), 'id: step_two\nname: Two\n');
      await writeConfig();

      await run();

      expect(await read('stepped', 'resources', 'step_one', 'prompt.yaml')).toContain(
        'id: step_one'
      );
      expect(await read('stepped', 'resources', 'step_one', 'system-message.md')).toBe(
        'Step one system.'
      );
      expect(await read('stepped', 'resources', 'step_one', 'user-message.md')).toBe(
        'Step one user.'
      );
      // A step whose directory holds only prompt.yaml ships only that file; the slash form of a
      // promptId resolves to its last segment.
      expect(
        await exists(path.join(outputDir, 'stepped', 'resources', 'step_two', 'prompt.yaml'))
      ).toBe(true);
      expect(
        await exists(path.join(outputDir, 'stepped', 'resources', 'step_two', 'system-message.md'))
      ).toBe(false);
      // A step with no directory emits nothing and shows no link.
      expect(await exists(path.join(outputDir, 'stepped', 'resources', 'step_missing'))).toBe(
        false
      );
      const skill = await read('stepped', 'SKILL.md');
      expect(skill).toContain('[`resources/step_one/`](resources/step_one/)');
      expect(skill).toContain('[`resources/step_two/`](resources/step_two/)');
      expect(skill).not.toContain('resources/step_missing/');
    });
  });

  describe('delegation on a chain', () => {
    const steps = [
      { id: 's1', stepName: 'Plan', promptId: 'inline', agentType: 'planner', delegation: true },
      { id: 's2', stepName: 'Build', promptId: 'inline' },
    ];

    it('prompt-level delegation names the default agent; a step agentType overrides it', async () => {
      await writePrompt('general', 'delegating', {
        delegation: true,
        delegationAgent: 'reviewer',
        chainSteps: steps,
      });
      await writeConfig();

      await run();

      const skill = await read('delegating', 'SKILL.md');
      expect(skill).toContain('> All steps delegate to sub-agents by default (agent: `reviewer`).');
      expect(skill).toMatch(/\| 1 \| Plan[^\n]*\| Sub-agent: `planner` \|/);
      expect(skill).toMatch(/\| 2 \| Build[^\n]*\| Sub-agent: `reviewer` \|/);
    });

    it('prompt-level delegation without an agent says "client default"', async () => {
      await writePrompt('general', 'default_agent', {
        delegation: true,
        chainSteps: [{ id: 's1', stepName: 'Only', promptId: 'inline' }],
      });
      await writeConfig();

      await run();

      const skill = await read('default_agent', 'SKILL.md');
      expect(skill).toContain(
        "> All steps delegate to sub-agents by default (the client's default agent)."
      );
      expect(skill).toContain('Sub-agent (client default)');
    });

    it('step-level delegation alone marks only that step; the other stays Inline', async () => {
      await writePrompt('general', 'step_only', { chainSteps: steps });
      await writeConfig();

      await run();

      const skill = await read('step_only', 'SKILL.md');
      expect(skill).not.toContain('All steps delegate');
      expect(skill).toMatch(/\| 1 \| Plan[^\n]*\| Sub-agent: `planner` \|/);
      expect(skill).toMatch(/\| 2 \| Build[^\n]*\| Inline \|/);
    });
  });

  // ─── Gate shapes ────────────────────────────────────────────────────────────

  describe('gate shapes an author can leave half-filled', () => {
    it('a gate.yaml with no type and no guidance file exports, with type defaulted in the table', async () => {
      const gateDir = path.join(serverRoot, 'resources', 'gates', 'bare');
      await mkdir(gateDir, { recursive: true });
      await writeFile(
        path.join(gateDir, 'gate.yaml'),
        yaml.dump({ id: 'bare', name: 'Bare', description: 'A bare gate' })
      );
      await writePrompt('general', 'uses_bare', { gateConfiguration: { include: ['bare'] } });
      await writeConfig();

      await run({ resourceType: 'prompt' });

      const skill = await read('uses_bare', 'SKILL.md');
      expect(skill).toContain('| bare | validation |');
      expect(await exists(path.join(outputDir, 'uses_bare', 'gates', 'bare', 'gate.yaml'))).toBe(
        true
      );
      expect(await exists(path.join(outputDir, 'uses_bare', 'gates', 'bare', 'guidance.md'))).toBe(
        false
      );
      const index = JSON.parse(await read('uses_bare', 'gates', 'index.json')) as {
        gates: Array<Record<string, unknown>>;
      };
      expect(index.gates).toHaveLength(1);
      expect(index.gates[0]?.['id']).toBe('bare');
      expect(index.gates[0]).not.toHaveProperty('type');
    });

    it('inline criteria and inline gate definitions render without any gates/ files', async () => {
      await writePrompt('general', 'inline_only', {
        gateConfiguration: {
          inline: ['Cite every claim', 'Stay under 200 words'],
          inline_gate_definitions: [
            { name: 'tone-check', description: 'Keep the tone calm', type: 'validation' },
          ],
        },
      });
      await writeConfig();

      await run();

      const skill = await read('inline_only', 'SKILL.md');
      expect(skill).toContain('### Inline Criteria');
      expect(skill).toContain('- Cite every claim');
      expect(skill).toContain('- Stay under 200 words');
      expect(skill).toContain('### Inline Gate Definitions');
      expect(skill).toContain('- **tone-check**: Keep the tone calm');
      expect(skill).toContain('3. Check inline criteria above');
      expect(await exists(path.join(outputDir, 'inline_only', 'gates'))).toBe(false);
    });
  });

  // ─── Same id, two categories ────────────────────────────────────────────────

  describe('two prompts with one id in different categories', () => {
    it('are written under category-prefixed directories, and the collision is logged', async () => {
      await writePrompt('alpha', 'twin');
      await writePrompt('beta', 'twin');
      await writePrompt('alpha', 'solo');
      await writeConfig();

      const { out } = await run();

      expect(await exists(path.join(outputDir, 'alpha-twin', 'SKILL.md'))).toBe(true);
      expect(await exists(path.join(outputDir, 'beta-twin', 'SKILL.md'))).toBe(true);
      expect(await exists(path.join(outputDir, 'twin'))).toBe(false);
      // A unique id keeps its bare directory (control for an over-eager prefix).
      expect(await exists(path.join(outputDir, 'solo', 'SKILL.md'))).toBe(true);
      expect(await exists(path.join(outputDir, 'alpha-solo'))).toBe(false);
      expect(out.logs.some((l) => l.includes('duplicate prompt ID') && l.includes('twin'))).toBe(
        true
      );
    });
  });

  // ─── Preview over a managed skill ───────────────────────────────────────────

  describe('a preview export over an existing managed skill', () => {
    it('plans the run, writes nothing and prunes nothing; the same run without preview prunes', async () => {
      await writeGate('code-quality');
      await writePrompt('general', 'previewed', {
        gateConfiguration: { include: ['code-quality'] },
      });
      await writeConfig();
      await run(); // first export stamps SKILL.md as managed

      const skillPath = path.join(outputDir, 'previewed', 'SKILL.md');
      const before = await readFile(skillPath, 'utf-8');
      const staleDir = path.join(outputDir, 'previewed', 'gates', 'stale');
      await mkdir(staleDir, { recursive: true });
      await writeFile(
        path.join(staleDir, 'gate.yaml'),
        yaml.dump({ id: 'stale', name: 'Stale', type: 'validation', description: 'Stale gate' })
      );
      // A change that a real run would write, so "wrote nothing" is not vacuous.
      await writePrompt('general', 'previewed', {
        description: 'changed description',
        gateConfiguration: { include: ['code-quality'] },
      });

      const { out, report } = await run({ preview: true });

      expect(await exists(staleDir)).toBe(true);
      expect(report.pruned).toBe(0);
      expect(report.written).toBe(0);
      expect(await readFile(skillPath, 'utf-8')).toBe(before);
      expect(
        out.logs.some((l) => l.includes('[preview]') && l.includes('previewed/SKILL.md'))
      ).toBe(true);
      expect(out.logs.some((l) => l.includes('removed stale gates/'))).toBe(false);

      // Positive control: the same state without --preview does remove it.
      const live = await run();
      expect(await exists(staleDir)).toBe(false);
      expect(live.report.pruned).toBe(1);
    });
  });
});
