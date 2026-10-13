/**
 * Export to Agent Skills clients
 *
 * Every other export test drives `claude-code`, so `buildAgentSkillsSkill` — the builder behind
 * cursor, codex, opencode and agent-plugins — was reached only through a handful of one-line
 * assertions. This file renders the same sections for each of those four clients and pins the
 * concrete text, so it also serves as the byte-identity net for any later change to how the two
 * skill builders share their sections.
 *
 * What differs between the four variants is small and is the reason each test is parameterised:
 * `cursor` adds `alwaysApply` and a top-level `category` to the frontmatter, and `subagents` is
 * true for cursor and opencode, false for codex and agent-plugins, which changes the chain
 * table's delegation column and appends an advisory note. Scripts, references and assets are
 * true for every registry entry and no override can change a capability, so those arms are
 * pinned as shipped, not as toggles.
 *
 * Real loader, real gate resolver, real adapters, real filesystem in a temp dir; only the I/O
 * location is redirected (MCP_SERVER_ROOT must contain `resources/`, or the resolver falls back
 * to the real `server/`), HOME is a temp dir, and the output dir is overridden per client.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

import {
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

/** The four registry entries that reach `buildAgentSkillsSkill`, with what tells them apart. */
const AGENT_SKILLS_CLIENTS = [
  { client: 'cursor', subagents: true },
  { client: 'codex', subagents: false },
  { client: 'opencode', subagents: true },
  { client: 'agent-plugins', subagents: false },
] as const;
const SUBAGENT_CLIENTS = AGENT_SKILLS_CLIENTS.filter((c) => c.subagents);
const NO_SUBAGENT_CLIENTS = AGENT_SKILLS_CLIENTS.filter((c) => !c.subagents);

const LITERAL_NOTE =
  'Supplied when this prompt runs through MCP. Here the `{name}` placeholders below ' +
  'stay literal, so state the values in your message instead.';

const ADVISORY_NOTE =
  '> *Note: This client does not natively support sub-agent delegation. Delegated steps are advisory.*';

/** Frontmatter block of a SKILL.md, parsed. */
function frontmatterOf(skillMd: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---/.exec(skillMd);
  if (!match?.[1]) throw new Error('SKILL.md has no frontmatter block');
  return yaml.load(match[1]) as Record<string, unknown>;
}

/** Everything after the frontmatter block. */
function bodyOf(skillMd: string): string {
  const match = /^---\n[\s\S]*?\n---\n\n/.exec(skillMd);
  if (!match) throw new Error('SKILL.md has no frontmatter block');
  return skillMd.slice(match[0].length);
}

/** One `resource_index` row for a script tool, shaped as `loadToolsCache` reads it. */
interface ToolRow {
  promptId: string;
  toolId: string;
  name: string;
  meta: Record<string, unknown>;
}

describe('Export to Agent Skills clients', () => {
  let tmpDir: string;
  let serverRoot: string;
  let outputDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'skills-export-agent-skills-'));
    serverRoot = path.join(tmpDir, 'server');
    outputDir = path.join(tmpDir, 'output');
    // `resources/` must exist: an MCP_SERVER_ROOT without it silently falls back to the real tree.
    await mkdir(path.join(serverRoot, 'resources'), { recursive: true });
    await mkdir(path.join(tmpDir, 'home'), { recursive: true });
    await mkdir(outputDir, { recursive: true });

    savedEnv = {
      HOME: process.env['HOME'],
      MCP_SERVER_ROOT: process.env['MCP_SERVER_ROOT'],
      MCP_RESOURCES_PATH: process.env['MCP_RESOURCES_PATH'],
      MCP_WORKSPACE: process.env['MCP_WORKSPACE'],
    };
    process.env['HOME'] = path.join(tmpDir, 'home');
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

  async function writeConfig(clientId: string): Promise<void> {
    await writeFile(
      path.join(serverRoot, 'skills-sync.yaml'),
      yaml.dump({
        registrations: { [clientId]: 'all' },
        overrides: { [clientId]: { outputDir: { user: outputDir, project: outputDir } } },
      })
    );
  }

  /** `extra` keys set to `undefined` are dropped, so a test can leave `name` or `type` out. */
  async function writeGate(
    id: string,
    extra: Record<string, unknown> = {},
    guidance: string | null = `Guidance for ${id}.`
  ): Promise<void> {
    const gateDir = path.join(serverRoot, 'resources', 'gates', id);
    await mkdir(gateDir, { recursive: true });
    await writeFile(
      path.join(gateDir, 'gate.yaml'),
      yaml.dump(
        { id, name: id, type: 'validation', description: `${id} gate`, ...extra },
        { skipInvalid: true }
      )
    );
    if (guidance !== null) await writeFile(path.join(gateDir, 'guidance.md'), guidance);
  }

  async function writePrompt(
    category: string,
    id: string,
    extra: Record<string, unknown> = {},
    messages: { system?: string; user?: string } = {}
  ): Promise<string> {
    const dir = path.join(serverRoot, 'resources', 'prompts', category, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'user-message.md'), messages.user ?? 'Do the thing.');
    if (messages.system !== undefined) {
      await writeFile(path.join(dir, 'system-message.md'), messages.system);
    }
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

  /** The prompt every section test starts from: system message, two arguments, a user message. */
  const RICH_ARGUMENTS = [
    { name: 'topic', type: 'string', description: 'Subject under review', required: true },
    { name: 'depth', type: 'string', description: 'How deep to go' },
  ];
  const RICH_SYSTEM =
    'You are a careful {{topic}} reviewer.\n' +
    '{% if depth %}Go deep on {{depth}}.{% else %}Keep it shallow.{% endif %}\n';
  const RICH_USER = 'Review {{topic}} now.\n';

  async function writeRichPrompt(extra: Record<string, unknown> = {}): Promise<void> {
    await writePrompt(
      'analysis',
      'rich',
      { arguments: RICH_ARGUMENTS, ...extra },
      { system: RICH_SYSTEM, user: RICH_USER }
    );
  }

  async function writeFramework(
    id: string,
    opts: { phases?: unknown[]; guidance?: string | null } = {}
  ): Promise<void> {
    const dir = path.join(serverRoot, 'resources', 'frameworks', id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'framework.yaml'),
      yaml.dump(
        {
          id,
          name: `${id} Framework`,
          type: id.toUpperCase(),
          version: '2.3.4',
          enabled: true,
          ...(opts.guidance === null
            ? {}
            : { systemPromptGuidance: opts.guidance ?? `Apply the ${id} method step by step.` }),
        },
        { skipInvalid: true }
      )
    );
    if (opts.phases !== undefined) {
      await writeFile(path.join(dir, 'phases.yaml'), yaml.dump(opts.phases));
    }
  }

  async function writeStyle(id: string, extra: Record<string, unknown> = {}): Promise<void> {
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
  }

  /**
   * An index stub holding the given tool rows. `loadToolsCache` reads `resource_index`, and a
   * row it can parse is what puts a schema and an execution config on the exported tool.
   */
  function toolIndex(rows: ToolRow[]) {
    return {
      isInitialized: () => true,
      query: (sql: string) =>
        sql.includes('resource_index')
          ? rows.map((row) => ({
              id: `${row.promptId}/${row.toolId}`,
              name: row.name,
              category: 'general',
              description: '',
              content_hash: 'h',
              metadata_json: JSON.stringify({
                prompt_id: row.promptId,
                tool_dir: 'unused',
                ...row.meta,
              }),
            }))
          : [],
      run: () => undefined,
      transaction: (fn: () => void) => fn(),
    };
  }

  async function run(
    clientId: string,
    overrides: Partial<SkillsSyncOptions> = {}
  ): Promise<{
    out: ReturnType<typeof silentOutput>;
    report: Awaited<ReturnType<typeof runSkillsSyncCommand>>;
  }> {
    await writeConfig(clientId);
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

  // ─── Prompt body and frontmatter ────────────────────────────────────────────

  describe('a prompt with a system message, arguments and a user message', () => {
    it.each(AGENT_SKILLS_CLIENTS)(
      '$client renders Instructions, Arguments with the literal-argument note, then Usage',
      async ({ client }) => {
        await writeRichPrompt();

        await run(client);

        // The whole body, byte for byte: `{{topic}}` survives the compile as `{topic}`, the
        // `{% else %}` branch replaces the `{% if depth %}` one, and the note sits between the
        // `## Arguments` heading and its list because `topic` is still literal.
        expect(bodyOf(await read('rich', 'SKILL.md'))).toBe(
          '## Instructions\n\n' +
            'You are a careful {topic} reviewer.\nKeep it shallow.\n\n' +
            '## Arguments\n\n' +
            `${LITERAL_NOTE}\n\n` +
            '- **topic** (required): Subject under review\n' +
            '- **depth**: How deep to go\n\n' +
            '## Usage\n\n' +
            'Review {topic} now.\n'
        );
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client omits the note when no declared argument stays literal, and keeps the list',
      async ({ client }) => {
        await writePrompt(
          'analysis',
          'rich',
          { arguments: RICH_ARGUMENTS },
          { system: 'Review the work.\n', user: 'Go.\n' }
        );

        await run(client);

        const body = bodyOf(await read('rich', 'SKILL.md'));
        expect(body).toContain('## Arguments\n\n- **topic** (required): Subject under review\n');
        expect(body).not.toContain('stay literal');
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client renders no Arguments section for a prompt that declares none',
      async ({ client }) => {
        await writePrompt('analysis', 'rich', {}, { system: 'Review the work.\n', user: 'Go.\n' });

        await run(client);

        expect(bodyOf(await read('rich', 'SKILL.md'))).toBe(
          '## Instructions\n\nReview the work.\n\n## Usage\n\nGo.\n'
        );
      }
    );

    it.each([
      {
        client: 'cursor',
        extra: { alwaysApply: false, category: 'analysis' },
      },
      { client: 'codex', extra: {} },
      { client: 'opencode', extra: {} },
      { client: 'agent-plugins', extra: {} },
    ])('$client frontmatter is the Agent Skills core plus its own extensions', async (variant) => {
      await writeRichPrompt();

      await run(variant.client);

      const fm = frontmatterOf(await read('rich', 'SKILL.md'));
      expect(fm).toEqual({
        name: 'rich',
        description: 'rich description',
        license: 'MIT',
        compatibility: { 'agent-skills': '1.0.0' },
        metadata: {
          'resource-type': 'prompt',
          'source-hash': expect.stringMatching(/^[0-9a-f]+$/),
          category: 'analysis',
        },
        ...variant.extra,
        'managed-by': 'claude-prompts-skills-sync',
        'managed-client': variant.client,
        'managed-scope': 'user',
        'managed-resource-key': 'prompt:analysis/rich',
      });
      // Claude Code vocabulary an Agent Skills client has not been verified to accept.
      expect(fm).not.toHaveProperty('argument-hint');
      expect(fm).not.toHaveProperty('allowed-tools');
      expect(fm).not.toHaveProperty('hooks');
    });

    it('the same prompt exported to claude-code does carry argument-hint (control)', async () => {
      await writeRichPrompt();

      await run('claude-code');

      expect(frontmatterOf(await read('rich', 'SKILL.md'))['argument-hint']).toBe(
        '<topic> [depth]'
      );
    });
  });

  // ─── Frameworks and styles ──────────────────────────────────────────────────

  describe('framework and style resources', () => {
    it.each(AGENT_SKILLS_CLIENTS)(
      '$client renders a framework: Guidance, Phases, and the references files',
      async ({ client }) => {
        await writeFramework('riskfw', {
          phases: [
            { id: 'p1', name: 'Identify', description: 'Find the risks.' },
            { id: 'p2', description: 'Reduce them.' },
            { id: 'p3', name: 'Review' },
            { description: 'No name, no id.' },
          ],
        });

        await run(client);

        const skill = await read('frameworks-riskfw', 'SKILL.md');
        expect(frontmatterOf(skill)['name']).toBe('riskfw Framework');
        expect(frontmatterOf(skill)['description']).toBe('riskfw Framework (RISKFW)');
        expect(frontmatterOf(skill)['metadata']).toMatchObject({ 'resource-type': 'framework' });
        // A phase is titled by name, else id, else the literal "Phase"; a missing description
        // leaves an empty paragraph rather than the word "undefined".
        expect(bodyOf(skill)).toBe(
          '## Guidance\n\nApply the riskfw method step by step.\n\n' +
            '## Phases\n\n' +
            '### Identify\n\nFind the risks.\n\n' +
            '### p2\n\nReduce them.\n\n' +
            '### Review\n\n\n\n' +
            '### Phase\n\nNo name, no id.\n\n'
        );
        expect(await read('frameworks-riskfw', 'references', 'system-prompt.md')).toBe(
          'Apply the riskfw method step by step.'
        );
        const phasesRef = await read('frameworks-riskfw', 'references', 'phases.md');
        expect(phasesRef.startsWith('# Phases\n\n')).toBe(true);
        expect(yaml.load(phasesRef.slice('# Phases\n\n'.length))).toEqual([
          { id: 'p1', name: 'Identify', description: 'Find the risks.' },
          { id: 'p2', description: 'Reduce them.' },
          { id: 'p3', name: 'Review' },
          { description: 'No name, no id.' },
        ]);
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client ships neither reference for a framework with no guidance and no phases file',
      async ({ client }) => {
        await writeFramework('barefw', { guidance: null });

        await run(client);

        expect(await exists(path.join(outputDir, 'frameworks-barefw', 'SKILL.md'))).toBe(true);
        expect(await exists(path.join(outputDir, 'frameworks-barefw', 'references'))).toBe(false);
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client renders a style: Guidance and a Style Configuration block',
      async ({ client }) => {
        await writeStyle('terse', { compatibleFrameworks: ['CAGEERF', '5W1H'] });

        await run(client);

        const skill = await read('styles-terse', 'SKILL.md');
        expect(frontmatterOf(skill)['metadata']).toMatchObject({ 'resource-type': 'style' });
        expect(bodyOf(skill)).toBe(
          '## Guidance\n\nWrite in the terse voice.\n\n' +
            '## Style Configuration\n\n' +
            '- **Priority**: 7\n' +
            '- **Enhancement Mode**: append\n' +
            '- **Compatible Frameworks**: CAGEERF, 5W1H\n\n'
        );
      }
    );

    it('a style with no compatibleFrameworks omits that line (control)', async () => {
      await writeStyle('plain');

      await run('codex');

      const body = bodyOf(await read('styles-plain', 'SKILL.md'));
      expect(body).toContain('- **Enhancement Mode**: append\n\n');
      expect(body).not.toContain('Compatible Frameworks');
    });
  });

  // ─── Script tools ───────────────────────────────────────────────────────────

  describe('a prompt with script tools', () => {
    const rows: ToolRow[] = [
      {
        promptId: 'tooled',
        toolId: 'py_tool',
        name: 'Py Tool',
        meta: {
          runtime: 'python',
          script_path: 'script.py',
          input_schema: { type: 'object', properties: { text: { type: 'string' } } },
          execution: { trigger: 'explicit', confirm: false, strict: true, timeout: 30 },
          env: { LANG: 'C' },
        },
      },
      {
        promptId: 'tooled',
        toolId: 'node_tool',
        name: 'Node Tool',
        meta: { runtime: 'node', script_path: 'script.js' },
      },
      {
        promptId: 'tooled',
        toolId: 'ruby_tool',
        name: 'Ruby Tool',
        meta: { runtime: 'ruby', script_path: 'script.rb' },
      },
      {
        promptId: 'tooled',
        toolId: 'gone_tool',
        name: 'Gone Tool',
        meta: {
          runtime: 'python',
          script_path: 'missing.py',
          input_schema: { type: 'object' },
        },
      },
    ];

    async function writeToolFile(toolId: string, file: string, content: string): Promise<void> {
      const toolDir = path.join(
        serverRoot,
        'resources',
        'prompts',
        'general',
        'tooled',
        'tools',
        toolId
      );
      await mkdir(toolDir, { recursive: true });
      await writeFile(path.join(toolDir, file), content);
    }

    async function writeTooledPrompt(): Promise<void> {
      await writePrompt('general', 'tooled', {
        tools: ['py_tool', 'node_tool', 'ruby_tool', 'gone_tool', 'disk_only'],
      });
      await writeToolFile('py_tool', 'script.py', 'print("py")\n');
      await writeToolFile('node_tool', 'script.js', 'console.log("node");\n');
      await writeToolFile('ruby_tool', 'script.rb', 'puts "ruby"\n');
      await writeToolFile('gone_tool', 'tool.yaml', 'id: gone_tool\n');
      // Not in the index: loaded from its own tool.yaml, which names no runtime.
      await writeToolFile('disk_only', 'tool.yaml', yaml.dump({ id: 'disk_only', name: 'Disk' }));
      await writeToolFile('disk_only', 'script.py', 'print("disk")\n');
    }

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client documents each tool by the command its runtime implies',
      async ({ client }) => {
        await writeTooledPrompt();

        await run(client, { dbManager: toolIndex(rows) as never });

        const body = bodyOf(await read('tooled', 'SKILL.md'));
        expect(body).toContain(
          '## Script Tools\n\nShipped with this skill. Run them directly:\n\n' +
            '- **Py Tool** — `python3 tools/py_tool/script.py`\n' +
            '- **Node Tool** — `node tools/node_tool/script.js`\n' +
            // An unknown runtime has no interpreter prefix and no extension.
            '- **Ruby Tool** — `tools/ruby_tool/script`\n' +
            '- **Gone Tool** — `python3 tools/gone_tool/script.py`\n' +
            '- **Disk** — `tools/disk_only/script`\n\n'
        );
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client ships script, schema.json and tool.json according to what the index knows',
      async ({ client }) => {
        await writeTooledPrompt();

        await run(client, { dbManager: toolIndex(rows) as never });

        const tools = path.join(outputDir, 'tooled', 'tools');
        expect((await readdir(path.join(tools, 'py_tool'))).sort()).toEqual([
          'schema.json',
          'script.py',
          'tool.json',
        ]);
        expect(await read('tooled', 'tools', 'py_tool', 'script.py')).toBe('print("py")\n');
        expect(JSON.parse(await read('tooled', 'tools', 'py_tool', 'schema.json'))).toEqual({
          type: 'object',
          properties: { text: { type: 'string' } },
        });
        // timeout and env appear only when the index carries them.
        expect(await read('tooled', 'tools', 'py_tool', 'tool.json')).toBe(
          JSON.stringify(
            {
              name: 'Py Tool',
              runtime: 'python',
              trigger: 'explicit',
              confirm: false,
              strict: true,
              timeout: 30,
              env: { LANG: 'C' },
            },
            null,
            2
          )
        );

        // No input_schema and no execution block: the default execution config, no schema.json.
        expect((await readdir(path.join(tools, 'node_tool'))).sort()).toEqual([
          'script.js',
          'tool.json',
        ]);
        expect(await read('tooled', 'tools', 'node_tool', 'tool.json')).toBe(
          JSON.stringify(
            {
              name: 'Node Tool',
              runtime: 'node',
              trigger: 'schema_match',
              confirm: true,
              strict: false,
            },
            null,
            2
          )
        );

        // An unknown runtime writes the script with no extension.
        expect((await readdir(path.join(tools, 'ruby_tool'))).sort()).toEqual([
          'script',
          'tool.json',
        ]);
        expect(await read('tooled', 'tools', 'ruby_tool', 'script')).toBe('puts "ruby"\n');

        // The script named by the index is missing on disk: no script file, but the metadata
        // still ships and the skill still documents the command.
        expect((await readdir(path.join(tools, 'gone_tool'))).sort()).toEqual([
          'schema.json',
          'tool.json',
        ]);

        // Not in the index: the script ships, the schema and execution config cannot.
        expect(await readdir(path.join(tools, 'disk_only'))).toEqual(['script']);
        expect(await read('tooled', 'tools', 'disk_only', 'script')).toBe('print("disk")\n');
      }
    );

    it('a tool.yaml-only tool is recorded as degraded in the report (control)', async () => {
      await writeTooledPrompt();

      const { report } = await run('codex', { dbManager: toolIndex(rows) as never });

      expect(report.failures.map((f) => f.id)).toEqual(['tooled/disk_only']);
    });
  });

  // ─── Chains and delegation ──────────────────────────────────────────────────

  describe('a chain prompt', () => {
    async function writeStepDir(promptDir: string, stepId: string): Promise<void> {
      await mkdir(path.join(promptDir, stepId), { recursive: true });
      await writeFile(
        path.join(promptDir, stepId, 'prompt.yaml'),
        `id: ${stepId}\nname: ${stepId}\n`
      );
    }

    const STEPS = [
      {
        id: 's1',
        stepName: 'Plan',
        promptId: 'step_plan',
        agentType: 'planner',
        delegation: true,
      },
      { id: 's2', stepName: 'Build', promptId: 'general/step_build' },
      { id: 's3', stepName: 'Review', promptId: 'step_review', delegation: true },
    ];

    async function writeFlowPrompt(withDirs: boolean): Promise<void> {
      const dir = await writePrompt('general', 'flow', { chainSteps: STEPS });
      if (withDirs) {
        await writeStepDir(dir, 'step_plan');
        await writeFile(path.join(dir, 'step_plan', 'system-message.md'), 'Plan carefully.');
        await writeFile(path.join(dir, 'step_plan', 'user-message.md'), 'Plan {{x}}.');
        await writeStepDir(dir, 'step_build');
      }
    }

    const chainSection = (skill: string): string => skill.slice(skill.indexOf('## Chain Workflow'));

    const RESOURCE_ROWS = (delegation: [string, string, string]): string =>
      '| Step | Name | Resource | Delegation |\n|------|------|----------|------------|\n' +
      `| 1 | Plan | [\`resources/step_plan/\`](resources/step_plan/) | ${delegation[0]} |\n` +
      `| 2 | Build | [\`resources/step_build/\`](resources/step_build/) | ${delegation[1]} |\n` +
      `| 3 | Review | — | ${delegation[2]} |\n`;

    it.each(SUBAGENT_CLIENTS)(
      '$client (subagents) names the sub-agent per step and adds no advisory note',
      async ({ client }) => {
        await writeFlowPrompt(true);

        await run(client);

        expect(chainSection(await read('flow', 'SKILL.md'))).toBe(
          '## Chain Workflow\n\n' +
            'Plan --> Build --> Review\n\n' +
            RESOURCE_ROWS(['Sub-agent: `planner`', 'Inline', 'Sub-agent (client default)']) +
            '\n> Full step content in `resources/{stepId}/` directories.\n\n'
        );
      }
    );

    it.each(NO_SUBAGENT_CLIENTS)(
      '$client (no subagents) marks delegated steps advisory and says so',
      async ({ client }) => {
        await writeFlowPrompt(true);

        await run(client);

        expect(chainSection(await read('flow', 'SKILL.md'))).toBe(
          '## Chain Workflow\n\n' +
            'Plan --> Build --> Review\n\n' +
            RESOURCE_ROWS(['Delegated (agent: planner)', 'Inline', 'Delegated (agent: default)']) +
            '\n> Full step content in `resources/{stepId}/` directories.\n' +
            `\n${ADVISORY_NOTE}\n\n`
        );
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client ships the step directories that exist and links only those',
      async ({ client }) => {
        await writeFlowPrompt(true);

        await run(client);

        expect(await read('flow', 'resources', 'step_plan', 'prompt.yaml')).toBe(
          'id: step_plan\nname: step_plan\n'
        );
        expect(await read('flow', 'resources', 'step_plan', 'system-message.md')).toBe(
          'Plan carefully.'
        );
        expect(await read('flow', 'resources', 'step_plan', 'user-message.md')).toBe('Plan {{x}}.');
        // A step directory holding only prompt.yaml ships only that file.
        expect(await readdir(path.join(outputDir, 'flow', 'resources', 'step_build'))).toEqual([
          'prompt.yaml',
        ]);
        expect(await exists(path.join(outputDir, 'flow', 'resources', 'step_build'))).toBe(true);
        expect(await exists(path.join(outputDir, 'flow', 'resources', 'step_review'))).toBe(false);
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client with no step directories uses the Prompt column and no resources footer',
      async ({ client, subagents }) => {
        await writeFlowPrompt(false);

        await run(client);

        const section = chainSection(await read('flow', 'SKILL.md'));
        const [first, second, third] = subagents
          ? ['Sub-agent: `planner`', 'Inline', 'Sub-agent (client default)']
          : ['Delegated (agent: planner)', 'Inline', 'Delegated (agent: default)'];
        expect(section).toBe(
          '## Chain Workflow\n\n' +
            'Plan --> Build --> Review\n\n' +
            '| Step | Prompt | Delegation |\n|------|--------|------------|\n' +
            `| 1 | Plan (\`step_plan\`) | ${first} |\n` +
            `| 2 | Build (\`general/step_build\`) | ${second} |\n` +
            `| 3 | Review (\`step_review\`) | ${third} |\n` +
            (subagents ? '\n' : `\n${ADVISORY_NOTE}\n\n`)
        );
        expect(section).not.toContain('Full step content');
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client prompt-level delegation sets the default agent, and a step agentType overrides it',
      async ({ client, subagents }) => {
        await writePrompt('general', 'flow', {
          delegation: true,
          delegationAgent: 'reviewer',
          chainSteps: STEPS,
        });

        await run(client);

        const section = chainSection(await read('flow', 'SKILL.md'));
        expect(section).toContain(
          '> All steps delegate to sub-agents by default (agent: `reviewer`).\n\n'
        );
        if (subagents) {
          expect(section).toContain('| 1 | Plan (`step_plan`) | Sub-agent: `planner` |');
          expect(section).toContain('| 2 | Build (`general/step_build`) | Sub-agent: `reviewer` |');
        } else {
          expect(section).toContain('| 1 | Plan (`step_plan`) | Delegated (agent: planner) |');
          expect(section).toContain(
            '| 2 | Build (`general/step_build`) | Delegated (agent: reviewer) |'
          );
        }
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client prompt-level delegation with no agent says "client default"',
      async ({ client, subagents }) => {
        await writePrompt('general', 'flow', {
          delegation: true,
          chainSteps: [{ id: 's1', stepName: 'Only', promptId: 'inline' }],
        });

        await run(client);

        const section = chainSection(await read('flow', 'SKILL.md'));
        expect(section).toContain(
          "> All steps delegate to sub-agents by default (the client's default agent).\n\n"
        );
        expect(section).toContain(
          subagents
            ? '| 1 | Only (`inline`) | Sub-agent (client default) |'
            : '| 1 | Only (`inline`) | Delegated (agent: default) |'
        );
      }
    );

    it('labels a step with no stepName by its prompt id, and a step with no id by its position', async () => {
      await writePrompt('general', 'flow', {
        chainSteps: [
          { id: 's1', stepName: 'Named', promptId: 'step_named' },
          { id: 's2', promptId: 'general/step_bare' },
          { id: 's3', promptId: 'trailing/' },
        ],
      });

      await run('codex');

      const section = chainSection(await read('flow', 'SKILL.md'));
      // `>>` survives only on the prompt-id fallback; the third label has no id to fall back to.
      expect(section).toContain('\nNamed --> >>step_bare --> step 3\n');
    });

    it('a chain-less prompt renders no Chain Workflow section (control)', async () => {
      await writePrompt('general', 'flow', {});

      await run('codex');

      expect(await read('flow', 'SKILL.md')).not.toContain('## Chain Workflow');
    });
  });

  // ─── Quality gates ──────────────────────────────────────────────────────────

  describe('the Quality Gates section', () => {
    const qualitySection = (skill: string): string => {
      const start = skill.indexOf('## Quality Gates');
      const end = skill.indexOf('\n## ', start + 1);
      return skill.slice(start, end === -1 ? undefined : end + 1);
    };

    const STATIC_LEAD =
      '## Quality Gates\n\nStatic requirements only: this export has executed no commands or semantic evaluations.\n\n';

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client lists tool checks by name, falling back to the id when a gate has no name',
      async ({ client }) => {
        await writeGate('lint-gate', {
          name: 'Lint',
          pass_criteria: [{ type: 'shell_verify', shell_command: ['npm', 'run', 'lint'] }],
        });
        await writeGate('anon-gate', {
          name: undefined,
          pass_criteria: [{ type: 'shell_verify', shell_command: 'npm test' }],
        });
        await writeGate('tool-gate', {
          name: 'Tool',
          pass_criteria: [{ type: 'script_tool', script_tool_id: 'word_count' }],
        });
        await writeGate('bare-check', {
          name: 'Bare',
          pass_criteria: [{ type: 'shell_verify' }],
        });
        await writePrompt('general', 'gated', {
          gateConfiguration: { include: ['lint-gate', 'anon-gate', 'tool-gate', 'bare-check'] },
        });

        await run(client, { resourceType: 'prompt' });

        const section = qualitySection(await read('gated', 'SKILL.md'));
        expect(section.startsWith(`${STATIC_LEAD}### Checks\n\n`)).toBe(true);
        expect(section).toContain(
          '- **Lint** — check: runs `npm run lint` (not executed by export)\n'
        );
        expect(section).toContain(
          '- **anon-gate** — check: runs `npm test` (not executed by export)\n'
        );
        expect(section).toContain(
          '- **Tool** — check: runs tool `word_count` (not executed by export)\n'
        );
        expect(section).toContain('- **Bare** — check (not executed by export)\n');
        expect(section).not.toContain('### Reminders');
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client tabulates reminder gates: explicit include, auto categories, and the type default',
      async ({ client }) => {
        // explicit_request, no type in the yaml: shown as "validation" under "Explicit include".
        await writeGate('explicit-gate', {
          type: undefined,
          activation: { explicit_request: true },
        });
        // Activates by category with no include: "Auto (<categories>)".
        await writeGate('auto-gate', {
          type: 'guidance',
          activation: { prompt_categories: ['review', 'general'] },
        });
        // Included, with no activation rules at all: nothing names a category.
        await writeGate('opt-in-gate', {});
        await writePrompt('general', 'gated', {
          gateConfiguration: { include: ['explicit-gate', 'opt-in-gate'] },
        });

        await run(client, { resourceType: 'prompt' });

        const section = qualitySection(await read('gated', 'SKILL.md'));
        expect(section).toContain(
          '### Reminders\n\n' +
            '| Gate | Type | When Active |\n|------|------|-------------|\n' +
            '| explicit-gate | validation | Explicit include |\n' +
            '| opt-in-gate | validation | Auto (explicit) |\n' +
            '| auto-gate | guidance | Auto (review, general) |\n' +
            '\nSee `gates/{gateId}/guidance.md` for detailed criteria.\n\n'
        );
        expect(section).not.toContain('### Checks');
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client names a reminder the harness already covers and ships none of its files',
      async ({ client }) => {
        await writeFile(
          path.join(serverRoot, 'config.json'),
          JSON.stringify({ gates: { harnessCovers: ['lint-hygiene'] } })
        );
        await writeGate('covered-gate', { subject: 'lint-hygiene' });
        await writeGate('kept-gate', { subject: 'other-subject' });
        await writePrompt('general', 'gated', {
          gateConfiguration: { include: ['covered-gate', 'kept-gate'] },
        });

        await run(client, { resourceType: 'prompt' });

        const section = qualitySection(await read('gated', 'SKILL.md'));
        expect(section).toContain('| kept-gate | validation | Auto (explicit) |\n');
        expect(section).not.toContain('| covered-gate |');
        expect(section).toContain(
          "Omitted 1 reminder(s) this installation's harness covers: covered-gate (lint-hygiene).\n\n"
        );
        expect(await exists(path.join(outputDir, 'gated', 'gates', 'covered-gate'))).toBe(false);
        expect(await exists(path.join(outputDir, 'gated', 'gates', 'kept-gate', 'gate.yaml'))).toBe(
          true
        );
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client replaces the self-review protocol with the semantic one for an evaluation gate',
      async ({ client }) => {
        await writeGate('rubric-gate', {
          pass_criteria: [
            {
              type: 'semantic_evaluation',
              id: 'cites-evidence',
              target: { kind: 'step_output' },
              question: 'Does the output cite its evidence?',
              result: { kind: 'boolean' },
              acceptance: { kind: 'equals', value: true },
              evidence_requirements: { min_items: 1 },
            },
          ],
        });
        await writePrompt('general', 'gated', { gateConfiguration: { include: ['rubric-gate'] } });

        await run(client, { resourceType: 'prompt' });

        const section = qualitySection(await read('gated', 'SKILL.md'));
        expect(section).toContain('### Evaluation Requirements\n\n');
        expect(section).toContain(
          '### Enforcement Protocol\n\nComplete the task and self-review its guidance and tool requirements.\n'
        );
        expect(section).toContain('No stop attestation is mechanically enforced on this client.\n');
        expect(section).not.toContain('Before completing this task, you MUST self-review');
        expect(section).not.toContain('Stop hook');
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client renders inline definitions with and without a description, and inline criteria',
      async ({ client }) => {
        await writePrompt('general', 'gated', {
          gateConfiguration: {
            inline: ['Cite every claim', 'Stay under 200 words'],
            inline_gate_definitions: [
              { name: 'tone-check', description: 'Keep the tone calm', type: 'validation' },
              { name: 'no-description', type: 'guidance' },
            ],
          },
        });

        await run(client);

        expect(qualitySection(await read('gated', 'SKILL.md'))).toBe(
          `${STATIC_LEAD}` +
            '### Inline Gate Definitions\n\n' +
            '- **tone-check**: Keep the tone calm\n' +
            '- **no-description**\n\n' +
            '### Inline Criteria\n' +
            '- Cite every claim\n' +
            '- Stay under 200 words\n\n' +
            '### Enforcement Protocol\n\n' +
            'Before completing this task, you MUST self-review against all gate criteria:\n\n' +
            '1. Complete all work specified in the task\n' +
            "2. Evaluate output against EACH gate's guidance (`gates/{id}/guidance.md`)\n" +
            '3. Check inline criteria above\n' +
            '4. Emit verdict: `GATE_REVIEW: PASS — [rationale]` or `GATE_REVIEW: FAIL — [rationale]`\n' +
            '5. If FAIL: address issues and re-emit until PASS\n\n' +
            '> Not mechanically enforced on this client — treat the verdict as a required self-review.\n\n'
        );
      }
    );

    it('without inline criteria the protocol has four steps, numbered 3 and 4 (control)', async () => {
      await writeGate('plain-gate', {});
      await writePrompt('general', 'gated', { gateConfiguration: { include: ['plain-gate'] } });

      await run('codex', { resourceType: 'prompt' });

      const section = qualitySection(await read('gated', 'SKILL.md'));
      expect(section).toContain('3. Emit verdict: `GATE_REVIEW: PASS — [rationale]`');
      expect(section).toContain('4. If FAIL: address issues and re-emit until PASS\n');
      expect(section).not.toContain('Check inline criteria above');
      expect(section).not.toContain('5. If FAIL');
    });

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client never ships the gate-review hook, even for a prompt that opts in',
      async ({ client }) => {
        await writeGate('plain-gate', {});
        await writePrompt('general', 'gated', {
          enforceGateHooks: true,
          gateConfiguration: { include: ['plain-gate'] },
        });

        await run(client, { resourceType: 'prompt' });

        const skill = await read('gated', 'SKILL.md');
        expect(frontmatterOf(skill)).not.toHaveProperty('hooks');
        expect(await exists(path.join(outputDir, 'gated', 'hooks'))).toBe(false);
        expect(qualitySection(skill)).toContain(
          '> Not mechanically enforced on this client — treat the verdict as a required self-review.'
        );
      }
    );

    it('claude-code ships the hook for the same opted-in prompt (control)', async () => {
      await writeGate('plain-gate', {});
      await writePrompt('general', 'gated', {
        enforceGateHooks: true,
        gateConfiguration: { include: ['plain-gate'] },
      });

      await run('claude-code', { resourceType: 'prompt' });

      expect(frontmatterOf(await read('gated', 'SKILL.md'))).toHaveProperty('hooks');
      expect(await exists(path.join(outputDir, 'gated', 'hooks', 'gate-review.py'))).toBe(true);
    });

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client ships gates/<id>/ files and a manifest for the registered gates',
      async ({ client }) => {
        await writeGate('lint-gate', {
          pass_criteria: [{ type: 'shell_verify', shell_command: ['npm', 'run', 'lint'] }],
        });
        await writeGate('quiet-gate', {}, null);
        await writePrompt('general', 'gated', {
          gateConfiguration: { include: ['lint-gate', 'quiet-gate'] },
        });

        await run(client, { resourceType: 'prompt' });

        expect(await read('gated', 'gates', 'lint-gate', 'guidance.md')).toBe(
          'Guidance for lint-gate.'
        );
        // A gate with no guidance file still ships its gate.yaml and its manifest entry.
        expect(
          await exists(path.join(outputDir, 'gated', 'gates', 'quiet-gate', 'gate.yaml'))
        ).toBe(true);
        expect(
          await exists(path.join(outputDir, 'gated', 'gates', 'quiet-gate', 'guidance.md'))
        ).toBe(false);
        const manifest = JSON.parse(await read('gated', 'gates', 'index.json')) as {
          skill: string;
          gates: Array<Record<string, unknown>>;
        };
        expect(manifest.skill).toBe('gated');
        expect(manifest.gates).toEqual([
          {
            id: 'lint-gate',
            name: 'lint-gate',
            type: 'validation',
            description: 'lint-gate gate',
            pass_criteria: [{ type: 'shell_verify', shell_command: ['npm', 'run', 'lint'] }],
          },
          {
            id: 'quiet-gate',
            name: 'quiet-gate',
            type: 'validation',
            description: 'quiet-gate gate',
          },
        ]);
      }
    );
  });

  // ─── Pass criteria on a gate resource ───────────────────────────────────────

  describe('the Pass Criteria section of an exported gate', () => {
    const passCriteria = (skill: string): string => skill.slice(skill.indexOf('## Pass Criteria'));

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client renders each criterion shape as one reviewable line',
      async ({ client }) => {
        await writeGate('mixed-gate', {
          pass_criteria: [
            // argv form, the current schema
            { type: 'shell_verify', shell_command: ['npm', 'run', 'lint'] },
            // pre-2026-08-29 string form, still readable for export
            { type: 'shell_verify', shell_command: 'npm test' },
            { type: 'script_tool', script_tool_id: 'word_count' },
            { type: 'inline_guidance', framework: 'CAGEERF', min_compliance_score: 0.8 },
            // A criterion with nothing recognizable is named by its keys, never serialized.
            { type: 'custom_check', threshold: 3, mode: 'strict' },
            { weight: 2 },
            // An empty argv is not a command.
            { type: 'shell_verify', shell_command: [] },
            // A bare type, and a null entry, which reads as an empty criterion.
            { type: 'manual' },
            null,
          ],
        });

        await run(client, { resourceType: 'gate' });

        expect(passCriteria(await read('gates-mixed-gate', 'SKILL.md'))).toBe(
          '## Pass Criteria\n\n' +
            '- Passes `npm run lint`\n' +
            '- Passes `npm test`\n' +
            '- Passes the `word_count` check\n' +
            '- Complies with the CAGEERF framework\n' +
            '- Scores at least 0.8 on framework compliance\n' +
            '- custom_check (threshold, mode)\n' +
            '- unspecified (weight)\n' +
            '- shell_verify (shell_command)\n' +
            '- manual\n' +
            '- unspecified\n\n'
        );
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client renders the gate guidance and an empty Pass Criteria heading for a gate with none',
      async ({ client }) => {
        await writeGate('empty-gate', { pass_criteria: undefined });

        await run(client, { resourceType: 'gate' });

        const skill = await read('gates-empty-gate', 'SKILL.md');
        expect(frontmatterOf(skill)['metadata']).toMatchObject({ 'resource-type': 'gate' });
        expect(bodyOf(skill)).toBe(
          '## Guidance\n\nGuidance for empty-gate.\n\n## Pass Criteria\n\n\n'
        );
      }
    );
  });

  // ─── Prompt docs ────────────────────────────────────────────────────────────

  describe('a prompt with a docs/ directory', () => {
    it.each(AGENT_SKILLS_CLIENTS)(
      '$client ships docs/ (the assets capability) alongside SKILL.md',
      async ({ client }) => {
        const dir = await writePrompt('general', 'documented', {});
        await mkdir(path.join(dir, 'docs', 'sub'), { recursive: true });
        await writeFile(path.join(dir, 'docs', 'a.md'), '# A doc');
        await writeFile(path.join(dir, 'docs', 'sub', 'b.md'), '# B doc');

        await run(client);

        expect(await read('documented', 'docs', 'a.md')).toBe('# A doc');
        expect(await read('documented', 'docs', 'sub', 'b.md')).toBe('# B doc');
      }
    );
  });

  // ─── Removal warnings on a re-export ────────────────────────────────────────

  describe('re-exporting over a managed SKILL.md', () => {
    /** Only the removal warnings: the same run also warns about an empty tool index and template gaps. */
    const removals = (out: ReturnType<typeof silentOutput>): string[] =>
      out.warns.filter((w) => w.includes('export removes'));

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client warns once per section the new render drops, and writes the new render',
      async ({ client }) => {
        await writeGate('lint-gate', {});
        await writeRichPrompt({ gateConfiguration: { include: ['lint-gate'] } });
        expect(removals((await run(client)).out)).toEqual([]);
        expect(await read('rich', 'SKILL.md')).toContain('## Quality Gates');

        // Drop the arguments, the gate and the user message from the prompt.
        await writePrompt('analysis', 'rich', {}, { system: 'Review the work.\n', user: '' });
        const second = (await run(client)).out;

        expect(removals(second)).toEqual([
          '  rich: export removes section "## Arguments"',
          '  rich: export removes section "## Quality Gates"',
          '  rich: export removes section "## Usage"',
        ]);
        expect(bodyOf(await read('rich', 'SKILL.md'))).toBe(
          '## Instructions\n\nReview the work.\n\n'
        );
      }
    );

    it.each(AGENT_SKILLS_CLIENTS)(
      '$client prunes the gates/<id>/ directory of a gate the prompt no longer includes',
      async ({ client }) => {
        await writeGate('lint-gate', {});
        await writeGate('docs-gate', {});
        await writePrompt('general', 'gated', {
          gateConfiguration: { include: ['lint-gate', 'docs-gate'] },
        });
        await run(client, { resourceType: 'prompt' });
        expect(await exists(path.join(outputDir, 'gated', 'gates', 'docs-gate'))).toBe(true);

        await writePrompt('general', 'gated', { gateConfiguration: { include: ['lint-gate'] } });
        const { out, report } = await run(client, { resourceType: 'prompt' });

        expect(await exists(path.join(outputDir, 'gated', 'gates', 'docs-gate'))).toBe(false);
        expect(await exists(path.join(outputDir, 'gated', 'gates', 'lint-gate', 'gate.yaml'))).toBe(
          true
        );
        expect(report.pruned).toBe(1);
        expect(out.logs).toContain(
          "  gated: removed stale gates/docs-gate/ (no longer in this skill's gate set)"
        );
      }
    );

    it('an unchanged re-export, and one that only adds a section, warn about nothing (control)', async () => {
      await writePrompt('analysis', 'rich', {}, { system: 'Review the work.\n', user: 'Go.\n' });
      await run('codex');
      expect(removals((await run('codex')).out)).toEqual([]);

      // Adding arguments adds `## Arguments`: ordinary sync output, not a removal.
      await writeRichPrompt();
      expect(removals((await run('codex')).out)).toEqual([]);
    });

    it('a frontmatter hooks block on the managed file is reported as removed', async () => {
      await writePrompt('analysis', 'rich', {}, { system: 'Review the work.\n', user: 'Go.\n' });
      await run('codex');
      const skillPath = path.join(outputDir, 'rich', 'SKILL.md');
      const exported = await readFile(skillPath, 'utf-8');
      await writeFile(skillPath, exported.replace(/^---\n/, '---\nhooks:\n  Stop: []\n'));

      const { out } = await run('codex');

      expect(removals(out)).toEqual([
        '  rich: export removes the frontmatter hooks block; set enforceGateHooks: true in the prompt YAML to keep it',
      ]);
      expect(frontmatterOf(await readFile(skillPath, 'utf-8'))).not.toHaveProperty('hooks');
    });

    it('a hand-written SKILL.md with no frontmatter is overwritten without a removal warning', async () => {
      await writePrompt('analysis', 'rich', {}, { system: 'Review the work.\n', user: 'Go.\n' });
      const skillPath = path.join(outputDir, 'rich', 'SKILL.md');
      await mkdir(path.dirname(skillPath), { recursive: true });
      await writeFile(skillPath, '# My notes\n\n## Hand-written section\n\nKeep me.\n');

      const { out } = await run('codex');

      // No managed marker means the file is not this tool's to compare against.
      expect(removals(out)).toEqual([]);
      expect(await readFile(skillPath, 'utf-8')).toContain('## Instructions');
      expect(await readFile(skillPath, 'utf-8')).not.toContain('Hand-written section');
    });

    it('a managed SKILL.md that is only its frontmatter, with no trailing newline, warns about nothing', async () => {
      await writePrompt('analysis', 'rich', {}, { system: 'Review the work.\n', user: 'Go.\n' });
      await run('codex');
      const skillPath = path.join(outputDir, 'rich', 'SKILL.md');
      const exported = await readFile(skillPath, 'utf-8');
      const frontmatterOnly = /^---\n[\s\S]*?\n---/.exec(exported)![0];
      await writeFile(skillPath, frontmatterOnly);

      const { out } = await run('codex');

      expect(removals(out)).toEqual([]);
      expect(await readFile(skillPath, 'utf-8')).toContain('## Instructions');
    });
  });
});
