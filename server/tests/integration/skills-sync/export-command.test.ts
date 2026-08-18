/**
 * Export Command Integration Tests
 *
 * `export` is the primary skills-sync command and had no tests: the existing suites
 * cover the INBOUND direction (pull/clone: SKILL.md -> canonical YAML) and prune
 * bookkeeping. Every defect found on 2026-08-16 lived in the OUTBOUND compile and
 * survived the full 2571-test unit suite untouched.
 *
 * Each test here is anchored to a mutation that was proven unobserved, so reverting
 * the corresponding fix reddens this file and nothing else:
 *   M2 - chain-step `inlineGateIds` dropped from the exported gate set
 *   M3 - manifest reported as saved when no database was available
 *   M4 - gate-review hook missing from SKILL.md frontmatter
 *   M6 - gate section claiming hook enforcement unconditionally
 *
 * Real loader, real gate resolver, real adapters, real filesystem in a temp dir.
 * Only the I/O location is redirected, via MCP_SERVER_ROOT + an outputDir override.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

import {
  runSkillsSyncCommand,
  type SkillsSyncOptions,
  type SkillsSyncOutput,
} from '../../../src/modules/skills-sync/service.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** Frontmatter block of a SKILL.md, parsed. */
function frontmatterOf(skillMd: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---/.exec(skillMd);
  if (!match?.[1]) throw new Error('SKILL.md has no frontmatter block');
  return yaml.load(match[1]) as Record<string, unknown>;
}

describe('Export Command Integration', () => {
  let tmpDir: string;
  let serverRoot: string;
  let outputDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'skills-export-'));
    serverRoot = path.join(tmpDir, 'server');
    outputDir = path.join(tmpDir, 'output');
    await mkdir(serverRoot, { recursive: true });
    await mkdir(outputDir, { recursive: true });

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

  /**
   * `extra` carries `activation` and `gate_type`. A gate written without `activation` is
   * ALWAYS active — `isGateActiveForContext` reads absent rules as "no restriction", the same
   * as `GateManager.selectGates` does at runtime — so a fixture that wants to stay out of an
   * unrelated prompt has to say so.
   */
  async function writeGate(
    id: string,
    name: string,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    const gateDir = path.join(serverRoot, 'resources', 'gates', id);
    await mkdir(gateDir, { recursive: true });
    await writeFile(
      path.join(gateDir, 'gate.yaml'),
      yaml.dump({ id, name, type: 'validation', description: `${name} gate`, ...extra })
    );
    await writeFile(path.join(gateDir, 'guidance.md'), `Guidance for ${id}.`);
  }

  async function writePrompt(
    category: string,
    id: string,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
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
  }

  async function writeConfig(clientId: string): Promise<void> {
    await writeFile(
      path.join(serverRoot, 'skills-sync.yaml'),
      yaml.dump({
        registrations: { [clientId]: 'all' },
        overrides: { [clientId]: { outputDir: { user: outputDir, project: outputDir } } },
      })
    );
  }

  async function runExport(clientId = 'claude-code') {
    const out = silentOutput();
    await runSkillsSyncCommand(
      { command: 'export', client: clientId, scope: 'user' } as SkillsSyncOptions,
      out
    );
    return out;
  }

  // ── M2: chain-step gates ───────────────────────────────────────────────────

  describe('gates declared on chain steps', () => {
    beforeEach(async () => {
      await writeGate('code-quality', 'Code Quality');
      await writeGate('never-wanted', 'Never Wanted');
    });

    it('includes a gate that only a chain step declares', async () => {
      // The runtime enforces this gate at step 2. An exported skill has no per-step
      // boundary, so omitting it under-reports what the chain actually enforces.
      await writePrompt('general', 'gated_chain', {
        chainSteps: [
          { id: 's1', stepName: 'Setup', promptId: 'inline' },
          { id: 's2', stepName: 'Gated', promptId: 'inline', inlineGateIds: ['code-quality'] },
        ],
      });
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'gated_chain', 'SKILL.md'), 'utf-8');
      expect(skill).toContain('code-quality');
      expect(
        await exists(path.join(outputDir, 'gated_chain', 'gates', 'code-quality', 'guidance.md'))
      ).toBe(true);
    });

    it('still honors gateConfiguration.exclude against a step-declared gate', async () => {
      await writePrompt('general', 'excluded_chain', {
        gateConfiguration: { exclude: ['never-wanted'] },
        chainSteps: [
          { id: 's1', stepName: 'Gated', promptId: 'inline', inlineGateIds: ['never-wanted'] },
        ],
      });
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'excluded_chain', 'SKILL.md'), 'utf-8');
      expect(skill).not.toContain('never-wanted');
    });
  });

  // ── F1 + F16: export activation delegates to the engine ────────────────────

  /**
   * F1. Export hand-rolled its own auto-activation — `prompt_categories.includes(category)`
   * plus `explicit_request` — while the runtime calls `isGateActiveForContext` through
   * `GenericGateGuide.isActive`. The two disagree in both directions, so a skill advertised a
   * contract `>>` does not enforce and omitted one it does. Measured against the real gate set
   * for category `development` on 2026-08-18: engine 11, export 7.
   *
   * The plan's prescribed fix — delegate and stop — is NOT sufficient on its own, which is what
   * `creed-fidelity` below is here to pin.
   */
  describe('gate activation follows the engine (F1)', () => {
    it('activates a gate that declares no category restriction', async () => {
      // The five-gate half of the measured gap. The old check demanded a category MATCH; the
      // engine only requires the absence of a CONFLICT, so an unrestricted gate is active.
      await writeGate('unrestricted', 'Unrestricted');
      await writePrompt('general', 'plain');
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'plain', 'SKILL.md'), 'utf-8');
      expect(skill).toContain('unrestricted');
    });

    it('matches the declared category case-insensitively', async () => {
      // The engine lowercases both sides; the hand-rolled check used exact `includes`.
      await writeGate('upper-cat', 'Upper Cat', {
        activation: { prompt_categories: ['General'] },
      });
      // The prompt id must not contain the gate id: `toContain` would then pass on the id
      // echoed in the skill header alone. Measured — an earlier `cased`/`cased_prompt` pair
      // survived the mutation that reverts this fix.
      await writePrompt('general', 'mixed_capitals');
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'mixed_capitals', 'SKILL.md'), 'utf-8');
      expect(skill).toContain('upper-cat');
    });

    it('still withholds a gate whose category does not match', async () => {
      await writeGate('elsewhere', 'Elsewhere', { activation: { prompt_categories: ['other'] } });
      await writePrompt('general', 'unmatched');
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'unmatched', 'SKILL.md'), 'utf-8');
      expect(skill).not.toContain('elsewhere');
    });

    it('still withholds a gate requiring explicit request', async () => {
      await writeGate('on-demand', 'On Demand', {
        activation: { prompt_categories: ['general'], explicit_request: true },
      });
      await writePrompt('general', 'not_asked');
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'not_asked', 'SKILL.md'), 'utf-8');
      expect(skill).not.toContain('on-demand');
    });

    it('skips a disabled gate, as selectGates does', async () => {
      await writeGate('switched-off', 'Switched Off', { enabled: false });
      await writePrompt('general', 'enabled_only');
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'enabled_only', 'SKILL.md'), 'utf-8');
      expect(skill).not.toContain('switched-off');
    });
  });

  /**
   * F16 (split from F2). An exported prompt skill injects no framework — `loadPromptIR` sets
   * `frameworkData: null` unconditionally — so a gate that depends on one is a claim the
   * artifact cannot honour. The runtime says the same thing: `framework-nesting` binds every
   * source rank, so not even an explicit `include` rescues it.
   */
  describe('gates that depend on a framework are never exported (F16)', () => {
    it('withholds a gate_type: framework gate even when explicitly included', async () => {
      await writeGate('framework-compliance', 'Framework Compliance', {
        gate_type: 'framework',
        activation: { prompt_categories: ['general'] },
      });
      await writePrompt('general', 'fw_included', {
        gateConfiguration: { include: ['framework-compliance'] },
      });
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'fw_included', 'SKILL.md'), 'utf-8');
      expect(skill).not.toContain('framework-compliance');
    });

    it('withholds a category gate that names a framework_context', async () => {
      // `creed-fidelity`'s real shape: gate_type `category`, framework_context `[RADIANT]`.
      // Delegation alone ACTIVATES it, because the regular-gate branch reads an absent
      // framework as unconstrained rather than as a mismatch. Reading gate_type alone would
      // miss it, which is why `dependsOnFramework` checks both declarations.
      await writeGate('creed-fidelity', 'Creed Fidelity', {
        gate_type: 'category',
        activation: { prompt_categories: ['general'], framework_context: ['RADIANT'] },
      });
      await writePrompt('general', 'creed_prompt');
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'creed_prompt', 'SKILL.md'), 'utf-8');
      expect(skill).not.toContain('creed-fidelity');
    });

    it('a framework-free gate alongside them is still exported', async () => {
      // Guards the obvious over-correction: dropping every gate would pass both tests above.
      await writeGate('plain-gate', 'Plain Gate', {
        activation: { prompt_categories: ['general'] },
      });
      await writeGate('fw-gate', 'FW Gate', {
        gate_type: 'framework',
        activation: { prompt_categories: ['general'] },
      });
      await writePrompt('general', 'mixed');
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'mixed', 'SKILL.md'), 'utf-8');
      expect(skill).toContain('plain-gate');
      expect(skill).not.toContain('fw-gate');
    });
  });

  // ── M4 + M6: hook emission and the enforcement claim ───────────────────────

  // ── F6 / DEV-W3-3: a tool missing from a NON-EMPTY index degrades in silence ──
  //
  // `loadToolsCache` warns only when the cache is wholly empty. If most tools
  // indexed and one dropped out — the shape a validation failure takes — that one
  // fell through to the per-tool fallback with no warning and exported with no
  // schema.json and no tool.json. Same command, two different artifacts.
  describe('partial-cold tool index (F6)', () => {
    /**
     * Index stub returning exactly one tool row, so the cache is NON-EMPTY and the
     * wholly-empty warning stays silent. The tool it knows about belongs to a
     * different prompt than the one under test.
     */
    function indexKnowing(toolRowIds: string[]) {
      return {
        isInitialized: () => true,
        query: (sql: string) =>
          sql.includes('type = ?') || sql.includes('resource_index')
            ? toolRowIds.map((id) => ({
                id,
                name: id,
                category: 'general',
                description: '',
                content_hash: 'h',
                metadata_json: JSON.stringify({
                  runtime: 'python',
                  input_schema: {},
                  prompt_id: id.split('/')[0],
                  script_path: 'script.py',
                  tool_dir: 'x',
                }),
              }))
            : [],
        run: () => undefined,
        transaction: (fn: () => void) => fn(),
      };
    }

    async function writePromptWithTool(id: string, toolId: string): Promise<void> {
      await writePrompt('general', id, { tools: [toolId] });
      const toolDir = path.join(serverRoot, 'resources', 'prompts', 'general', id, 'tools', toolId);
      await mkdir(toolDir, { recursive: true });
      await writeFile(
        path.join(toolDir, 'tool.yaml'),
        yaml.dump({ id: toolId, name: toolId, script: 'script.py', runtime: 'python' })
      );
      await writeFile(path.join(toolDir, 'script.py'), 'print("hi")');
    }

    it('warns per tool when one tool is missing from an otherwise-populated index', async () => {
      await writeConfig('claude-code');
      // `indexed_owner` is in the index; `dropped_owner` is not. Neither id is a
      // substring of the tool ids, so a warning about the wrong one cannot pass.
      await writePromptWithTool('indexed_owner', 'alpha-widget');
      await writePromptWithTool('dropped_owner', 'beta-widget');

      const out = silentOutput();
      const report = await runSkillsSyncCommand(
        {
          command: 'export',
          client: 'claude-code',
          scope: 'user',
          dbManager: indexKnowing(['indexed_owner/alpha-widget']) as never,
        } as SkillsSyncOptions,
        out
      );

      const degraded = report.failures.filter((f) => f.id === 'dropped_owner/beta-widget');
      expect(degraded).toHaveLength(1);
      expect(degraded[0]?.reason).toContain('not in the resource index');
      expect(out.warns.join('\n')).toContain('dropped_owner/beta-widget');
    });

    it('stays quiet about the tool the index does know', async () => {
      await writeConfig('claude-code');
      await writePromptWithTool('indexed_owner', 'alpha-widget');
      await writePromptWithTool('dropped_owner', 'beta-widget');

      const out = silentOutput();
      const report = await runSkillsSyncCommand(
        {
          command: 'export',
          client: 'claude-code',
          scope: 'user',
          dbManager: indexKnowing(['indexed_owner/alpha-widget']) as never,
        } as SkillsSyncOptions,
        out
      );

      // Without this the previous test also passes for a fix that warns about
      // every tool unconditionally.
      expect(report.failures.map((f) => f.id)).not.toContain('indexed_owner/alpha-widget');
    });
  });

  // ── F13: --json must make stdout parseable, not merely add a JSON line ──
  describe('--json output (F13)', () => {
    it('emits exactly one stdout write, and it parses as the run report', async () => {
      await writeConfig('claude-code');
      await writePrompt('general', 'exported_thing');

      const out = silentOutput();
      const report = await runSkillsSyncCommand(
        {
          command: 'export',
          client: 'claude-code',
          scope: 'user',
          json: true,
        } as SkillsSyncOptions,
        out
      );

      // An export normally logs a banner, a per-file `wrote ...` line and a
      // manifest line. Under --json every one of those must be suppressed, or
      // stdout does not parse.
      expect(out.logs).toHaveLength(1);
      const parsed = JSON.parse(out.logs[0] as string) as Record<string, unknown>;
      expect(parsed['command']).toBe('export');
      expect(parsed['resources']).toBe(report.resources);
      expect(parsed['written']).toBeGreaterThan(0);
      expect(Array.isArray(parsed['failures'])).toBe(true);
    });

    it('still writes the human log when --json is absent', async () => {
      await writeConfig('claude-code');
      await writePrompt('general', 'exported_thing');

      const out = await runExport();

      // Guards the inverse: a fix that suppressed logs unconditionally would
      // pass the test above.
      expect(out.logs.length).toBeGreaterThan(1);
      expect(out.logs.some((line) => line.includes('wrote'))).toBe(true);
    });

    it('reports a failure in the JSON when the manifest cannot be saved', async () => {
      await writeConfig('claude-code');
      await writePrompt('general', 'exported_thing');

      // No dbManager → the manifest is dropped. Previously this was a log line
      // only; a machine consumer had no way to see it.
      const out = silentOutput();
      const report = await runSkillsSyncCommand(
        {
          command: 'export',
          client: 'claude-code',
          scope: 'user',
          json: true,
        } as SkillsSyncOptions,
        out
      );

      expect(report.failures.some((f) => f.reason.includes('manifest not saved'))).toBe(true);
    });
  });

  // ── F17/F18: what a skill reader is told about arguments that never bind ──
  //
  // Arguments are appended as trailing free text, never substituted, so any
  // placeholder the compile emits stays literal. F18 removes most of them by
  // preferring the `{% else %}` fallback; F17 annotates whatever survives.
  describe('argument placeholders in exported skills (F17/F18)', () => {
    async function writePromptWithBody(
      id: string,
      body: string,
      args: Array<Record<string, unknown>>
    ): Promise<string> {
      const dir = path.join(serverRoot, 'resources', 'prompts', 'general', id);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'user-message.md'), body);
      await writeFile(
        path.join(dir, 'prompt.yaml'),
        yaml.dump({
          id,
          name: id,
          description: `${id} description`,
          category: 'general',
          userMessageTemplateFile: 'user-message.md',
          arguments: args,
        })
      );
      await writeConfig('claude-code');
      await runExport();
      return readFile(path.join(outputDir, id, 'SKILL.md'), 'utf-8');
    }

    it('emits the else-branch, not the placeholder that can never bind', async () => {
      const skill = await writePromptWithBody(
        'branching',
        'Mode: {% if work_kind %}{{ work_kind }}{% else %}[bug_fix | feature | refactor]{% endif %}',
        [{ name: 'work_kind', description: 'kind of work', required: false }]
      );

      expect(skill).toContain('[bug_fix | feature | refactor]');
      expect(skill).not.toContain('{work_kind}');
    });

    it('stays silent about literal arguments when the else-branch removed them all', async () => {
      const skill = await writePromptWithBody(
        'branching_quiet',
        'Mode: {% if work_kind %}{{ work_kind }}{% else %}[bug_fix | feature]{% endif %}',
        [{ name: 'work_kind', description: 'kind of work', required: false }]
      );

      // The whole point of the composition: a prompt written with a fallback
      // gets no warning banner, because it has nothing left to warn about.
      expect(skill).toContain('## Arguments');
      expect(skill).not.toContain('stay literal');
    });

    it('annotates when a placeholder really does survive the compile', async () => {
      const skill = await writePromptWithBody(
        'bare_interp',
        'Do this to {{ target_thing }} carefully.',
        [{ name: 'target_thing', description: 'what to act on', required: true }]
      );

      expect(skill).toContain('{target_thing}');
      expect(skill).toContain('stay literal');
    });

    it('says nothing when arguments are declared but never interpolated', async () => {
      const skill = await writePromptWithBody('declared_only', 'A fixed instruction.', [
        { name: 'unused_arg', description: 'declared, never used', required: false },
      ]);

      // Guards against the annoying case: every argument-bearing skill carrying a
      // caveat it does not need.
      expect(skill).toContain('- **unused_arg**');
      expect(skill).not.toContain('stay literal');
    });
  });

  describe('gate-review hook emission', () => {
    beforeEach(async () => {
      // Scoped to a category none of these prompts use, so it reaches a skill only through the
      // explicit `include` each gated test declares. Unrestricted, it would auto-activate into
      // the ungated prompt below and there would be no negative case left to assert (F1).
      await writeGate('code-quality', 'Code Quality', {
        activation: { prompt_categories: ['code'] },
      });
    });

    it('emits both the frontmatter hook and the script it points at', async () => {
      await writePrompt('general', 'gated', {
        gateConfiguration: { include: ['code-quality'] },
      });
      await writeConfig('claude-code');
      await runExport();

      const skillPath = path.join(outputDir, 'gated', 'SKILL.md');
      const fm = frontmatterOf(await readFile(skillPath, 'utf-8'));
      const stop = (fm['hooks'] as Record<string, unknown> | undefined)?.['Stop'] as
        Array<{ hooks: Array<Record<string, unknown>> }> | undefined;

      expect(stop).toBeDefined();
      const hook = stop![0]!.hooks[0]!;
      expect(hook['type']).toBe('command');
      // `once` is honored only in skill frontmatter; it is what keeps the block from
      // riding along and stopping unrelated later turns in the same session.
      expect(hook['once']).toBe(true);

      // The command must point at a script that exists, or the hook fails open silently.
      const scriptPath = path.join(outputDir, 'gated', 'hooks', 'gate-review.py');
      expect(await exists(scriptPath)).toBe(true);
      expect(String(hook['command'])).toContain(scriptPath);
    });

    it('claims enforcement only when it actually shipped a hook', async () => {
      await writePrompt('general', 'gated', {
        gateConfiguration: { include: ['code-quality'] },
      });
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'gated', 'SKILL.md'), 'utf-8');
      expect(skill).toContain('registers a `Stop` hook');
      expect(skill).not.toContain('Not mechanically enforced');
    });

    it('says it is NOT enforced on a client with no frontmatter-hook support', async () => {
      // codex uses the agent-skills adapter, which assigns no meaning to `hooks`.
      // Claiming enforcement there is the exact lie this branch exists to prevent.
      await writePrompt('general', 'gated', {
        gateConfiguration: { include: ['code-quality'] },
      });
      await writeConfig('codex');
      await runExport('codex');

      const skill = await readFile(path.join(outputDir, 'gated', 'SKILL.md'), 'utf-8');
      expect(skill).toContain('Not mechanically enforced');
      expect(skill).not.toContain('registers a `Stop` hook');
      expect(frontmatterOf(skill)['hooks']).toBeUndefined();
      expect(await exists(path.join(outputDir, 'gated', 'hooks', 'gate-review.py'))).toBe(false);
    });

    it('emits no hook at all for a prompt with no gates', async () => {
      await writePrompt('general', 'ungated');
      await writeConfig('claude-code');
      await runExport();

      const skill = await readFile(path.join(outputDir, 'ungated', 'SKILL.md'), 'utf-8');
      expect(frontmatterOf(skill)['hooks']).toBeUndefined();
      expect(await exists(path.join(outputDir, 'ungated', 'hooks', 'gate-review.py'))).toBe(false);
    });
  });

  // ── Emitted hook behavior ──────────────────────────────────────────────────

  describe('emitted gate-review hook behavior', () => {
    /**
     * Runs the script the export actually wrote, against a real Stop payload.
     *
     * Asserting on the generated source text instead (`toContain('return 2')`) only
     * proves a string literal survived template interpolation — it cannot distinguish
     * a hook that blocks from one that never blocks.
     */
    async function runHook(payload: Record<string, unknown>) {
      const { spawnSync } = await import('node:child_process');
      const scriptPath = path.join(outputDir, 'gated', 'hooks', 'gate-review.py');
      const result = spawnSync('python3', [scriptPath], {
        input: JSON.stringify(payload),
        encoding: 'utf-8',
      });
      return { status: result.status, stderr: result.stderr ?? '' };
    }

    beforeEach(async () => {
      await writeGate('code-quality', 'Code Quality');
      await writePrompt('general', 'gated', {
        gateConfiguration: { include: ['code-quality'] },
      });
      await writeConfig('claude-code');
      await runExport();
    });

    it('blocks the stop when no verdict was emitted, and names the gate', async () => {
      const { status, stderr } = await runHook({
        last_assistant_message: 'All done, I finished the work.',
      });
      expect(status).toBe(2);
      expect(stderr).toContain('code-quality');
    });

    it('allows the stop on a PASS verdict', async () => {
      const { status } = await runHook({
        last_assistant_message: 'GATE_REVIEW: PASS — every criterion met',
      });
      expect(status).toBe(0);
    });

    it('blocks the stop on a FAIL verdict', async () => {
      const { status, stderr } = await runHook({
        last_assistant_message: 'GATE_REVIEW: FAIL — missing tests',
      });
      expect(status).toBe(2);
      expect(stderr).toContain('FAIL');
    });

    it('does not stack a second block while already continuing from one', async () => {
      // Claude Code force-stops after 8 consecutive blocks; re-blocking on a turn that
      // is already a stop-hook continuation burns that budget for nothing.
      const { status } = await runHook({
        stop_hook_active: true,
        last_assistant_message: 'no verdict here',
      });
      expect(status).toBe(0);
    });

    it('fails open on malformed input rather than stranding the session', async () => {
      const { spawnSync } = await import('node:child_process');
      const result = spawnSync(
        'python3',
        [path.join(outputDir, 'gated', 'hooks', 'gate-review.py')],
        { input: 'not json at all', encoding: 'utf-8' }
      );
      expect(result.status).toBe(0);
    });
  });

  // ── F3 + F4: template fidelity reporting (Wave 2) ──────────────────────────

  describe('template fidelity warnings', () => {
    /** Overwrites the default body so a single construct is under test. */
    async function writePromptWithBody(
      id: string,
      body: string,
      extra: Record<string, unknown> = {}
    ) {
      await writePrompt('general', id, extra);
      await writeFile(
        path.join(serverRoot, 'resources', 'prompts', 'general', id, 'user-message.md'),
        body
      );
      await writeConfig('claude-code');
      return runExport();
    }

    function warningsFor(out: { warns: string[] }, id: string): string {
      return out.warns.filter((line) => line.includes(id)).join('\n');
    }

    it('reports a filter expression that survives verbatim', async () => {
      const out = await writePromptWithBody('filtered', '{{content|default("nothing")}}');
      expect(warningsFor(out, 'filtered')).toContain('survives verbatim');
      expect(warningsFor(out, 'filtered')).toContain('{{content|default("nothing")}}');
    });

    it('reports {{ref:}} and {{script:}} reference forms', async () => {
      const out = await writePromptWithBody('refs', 'See {{ref:intro}} then {{script:counter}}.');
      const warned = warningsFor(out, 'refs');
      expect(warned).toContain('{{ref:intro}}');
      expect(warned).toContain('{{script:counter}}');
    });

    it('reports dotted access, which the bare-word compiler cannot match', async () => {
      const out = await writePromptWithBody('dotted', 'Count: {{tool_wc.word_count}}');
      expect(warningsFor(out, 'dotted')).toContain('{{tool_wc.word_count}}');
    });

    it('reports control-flow blocks other than {% if %}', async () => {
      const out = await writePromptWithBody('looped', '{% for x in items %}{{ x }}{% endfor %}');
      expect(warningsFor(out, 'looped')).toContain('{% for %}');
    });

    it('reports a dropped {% else %} branch', async () => {
      // The compile keeps the if-branch and discards the else with no trace in the
      // output — the failure mode that was silently losing content in dev-workflow.
      const out = await writePromptWithBody(
        'branched',
        '{% if mode %}{{ mode }}{% else %}[pick one]{% endif %}',
        { arguments: [{ name: 'mode', type: 'string', description: 'mode' }] }
      );
      expect(warningsFor(out, 'branched')).toContain('{% else %} branch is dropped');
    });

    it('reports argument placeholders that stay literal', async () => {
      const out = await writePromptWithBody('argy', 'Task: {{ task }} / Scope: {{ scope }}', {
        arguments: [
          { name: 'task', type: 'string', description: 'task', required: true },
          { name: 'scope', type: 'string', description: 'scope' },
        ],
      });
      const warned = warningsFor(out, 'argy');
      expect(warned).toContain('2 argument placeholder(s) stay literal');
      expect(warned).toContain('{scope}, {task}');
    });

    it('stays silent for a prompt whose only interpolation is a bare variable', async () => {
      // `{{ name }}` is the one form the compiler handles; warning here would be noise.
      const out = await writePromptWithBody('clean', 'Hello {{ name }}, welcome.');
      expect(warningsFor(out, 'clean')).toBe('');
    });

    it('does not warn when arguments are declared but never interpolated', async () => {
      // Nothing is lost, so there is nothing to report — the distinction that keeps
      // this from firing on every argument-bearing prompt in the repo.
      const out = await writePromptWithBody('declared-only', 'No placeholders at all here.', {
        arguments: [{ name: 'unused', type: 'string', description: 'unused' }],
      });
      expect(warningsFor(out, 'declared-only')).toBe('');
    });

    it('exports the resource anyway — warnings never skip or refuse (Q2 ruling)', async () => {
      // Q2 RULED 2026-08-17: warn and continue. A skipped export trades a visible
      // defect for an invisible absence, and would drop every argument-bearing skill.
      const out = await writePromptWithBody('still-exported', '{{a|default("x")}} {{ref:y}}');
      expect(warningsFor(out, 'still-exported')).toContain('did not translate');
      expect(await exists(path.join(outputDir, 'still-exported', 'SKILL.md'))).toBe(true);
      expect(out.logs.join('\n')).toContain('still-exported/SKILL.md');
    });
  });

  // ── M3: manifest reporting ─────────────────────────────────────────────────

  describe('manifest reporting', () => {
    it('reports the manifest as NOT saved when no database is available', async () => {
      // The CLI passes no dbManager, so `saveManifestBatch` no-ops. Logging "manifest
      // saved" here claims durable drift state that does not exist, and `diff` then
      // reports every resource as new.
      await writePrompt('general', 'plain');
      await writeConfig('claude-code');
      const out = await runExport();

      const manifestLines = out.logs.filter((line) => line.includes('manifest'));
      expect(manifestLines.length).toBeGreaterThan(0);
      expect(manifestLines.join('\n')).toContain('NOT saved');
      expect(manifestLines.join('\n')).not.toMatch(/^\s*manifest saved/m);
    });
  });

  // ── F7: chain flow line renders step names ─────────────────────────────────

  describe('chain flow line', () => {
    async function flowLineFor(id: string, chainSteps: unknown[]): Promise<string> {
      await writePrompt('general', id, { chainSteps });
      await writeConfig('claude-code');
      await runExport();
      const skill = await readFile(path.join(outputDir, id, 'SKILL.md'), 'utf-8');
      const line = skill.split('\n').find((l) => l.includes(' --> '));
      return line ?? '';
    }

    it('renders step names, not the literal prompt id, for an all-inline chain', async () => {
      // Every inline step shares one non-invocable prompt id, so rendering the id
      // collapsed the whole flow to `>>inline --> >>inline` and conveyed nothing.
      const flow = await flowLineFor('named_chain', [
        { id: 's1', stepName: 'Gather Evidence', promptId: 'inline' },
        { id: 's2', stepName: 'Rule On It', promptId: 'inline' },
      ]);

      expect(flow).toBe('Gather Evidence --> Rule On It');
      expect(flow).not.toContain('>>inline');
    });

    it('falls back to the invocable id when a step declares no name', async () => {
      // The loader coerces a missing stepName to '' rather than undefined, so a
      // nullish fallback would silently render an empty label here.
      const flow = await flowLineFor('unnamed_chain', [
        { id: 's1', promptId: 'development/dev-workflow' },
        { id: 's2', stepName: 'Second', promptId: 'inline' },
      ]);

      expect(flow).toBe('>>dev-workflow --> Second');
    });
  });

  // ── F8: pass criteria render as prose, never serialized config ─────────────

  describe('gate pass criteria rendering', () => {
    async function gateSkillWithCriteria(
      id: string,
      passCriteria: unknown[],
      clientId = 'claude-code'
    ): Promise<string> {
      const gateDir = path.join(serverRoot, 'resources', 'gates', id);
      await mkdir(gateDir, { recursive: true });
      await writeFile(
        path.join(gateDir, 'gate.yaml'),
        yaml.dump({
          id,
          name: id,
          type: 'validation',
          description: `${id} gate`,
          pass_criteria: passCriteria,
        })
      );
      await writeFile(path.join(gateDir, 'guidance.md'), `Guidance for ${id}.`);
      await writeConfig(clientId);
      await runExport(clientId);
      // Non-prompt resources are emitted under a pluralised prefix (`gates-<id>/`).
      return readFile(path.join(outputDir, `gates-${id}`, 'SKILL.md'), 'utf-8');
    }

    /** The Pass Criteria section only, so assertions cannot pass on unrelated body text. */
    function passCriteriaSection(skillMd: string): string {
      const match = /## Pass Criteria\n([\s\S]*?)(?=\n## |$)/.exec(skillMd);
      return match?.[1] ?? '';
    }

    it('renders an inline_guidance criterion as prose with no JSON object', async () => {
      // The section is a checklist a model self-reviews against. A serialized config
      // blob is not a reviewable instruction.
      const skill = await gateSkillWithCriteria('prose-gate', [
        {
          type: 'inline_guidance',
          min_length: 100,
          required_patterns: ['States the work type'],
          forbidden_patterns: ['TODO'],
        },
      ]);
      const section = passCriteriaSection(skill);

      expect(section).toContain('States the work type');
      expect(section).toContain('100 characters');
      expect(section).toContain('TODO');
      expect(section).not.toContain('{"');
      expect(section).not.toContain('min_length');
      expect(section).not.toContain('[inline_guidance]');
    });

    it('summarizes a shell_verify criterion by the command it runs', async () => {
      // Only one shipped gate uses this type, so it is the variant most likely to
      // regress unnoticed if the renderer only ever handles inline_guidance.
      const section = passCriteriaSection(
        await gateSkillWithCriteria('shell-gate', [
          { type: 'shell_verify', shell_command: 'npm test', shell_timeout: 300000 },
        ])
      );

      expect(section).toContain('npm test');
      expect(section).not.toContain('shell_timeout');
      expect(section).not.toContain('300000');
    });

    it('names an unrecognized criterion by its keys rather than serializing it', async () => {
      // GatePassCriteria is a passthrough schema, so unknown keys reach the exporter.
      // The fallback must stay lossy-but-readable — never a JSON dump.
      const section = passCriteriaSection(
        await gateSkillWithCriteria('odd-gate', [
          { type: 'inline_guidance', keyword_count: { evidence: 2 } },
        ])
      );

      expect(section).toContain('keyword_count');
      expect(section).not.toContain('{"');
      expect(section).not.toContain('evidence');
    });

    it('renders prose for the generic adapter too, not just claude-code', async () => {
      // The defect existed as byte-identical copies in BOTH exporters. Breaking only
      // the generic one left the whole 74-test suite green (mutation M-K), so a
      // claude-code-only assertion cannot close this row.
      const section = passCriteriaSection(
        await gateSkillWithCriteria(
          'generic-gate',
          [{ type: 'inline_guidance', min_length: 100, required_patterns: ['Cites evidence'] }],
          'codex'
        )
      );

      expect(section).toContain('Cites evidence');
      expect(section).toContain('100 characters');
      expect(section).not.toContain('{"');
      expect(section).not.toContain('min_length');
    });
  });

  // ── F5: script tools are documented, never faked as a tool allowlist ────────

  describe('script tool advertisement', () => {
    async function promptWithScriptTool(id: string, clientId: string): Promise<string> {
      const dir = path.join(serverRoot, 'resources', 'prompts', 'general', id);
      const toolDir = path.join(dir, 'tools', 'word_count');
      await mkdir(toolDir, { recursive: true });
      await writeFile(path.join(toolDir, 'script.py'), 'print("hi")\n');
      await writeFile(
        path.join(toolDir, 'tool.yaml'),
        yaml.dump({ id: 'word_count', name: 'Word Counter', runtime: 'python' })
      );
      await writePrompt('general', id, { tools: ['word_count'] });
      await writeConfig(clientId);
      await runExport(clientId);
      return readFile(path.join(outputDir, id, 'SKILL.md'), 'utf-8');
    }

    it('never emits a `tools:` frontmatter key — it is not a SKILL.md field', async () => {
      // `tools:` is a subagent-definition key, not a skill key. Portable Agent Skills
      // packaging rejects unknown frontmatter keys outright, so emitting it is a
      // latent hard failure, not a harmless extra.
      const skill = await promptWithScriptTool('tooled', 'claude-code');
      expect(frontmatterOf(skill)).not.toHaveProperty('tools');
    });

    it.each(['claude-code', 'codex'])(
      'never names a script tool where a canonical tool name belongs (%s)',
      async (clientId) => {
        // `allowed-tools` matches canonical tool names only, so a bare `word_count` or
        // `Word Counter` entry pre-approved nothing while reading as a working allowlist.
        // A script-tool identifier may still appear INSIDE a Bash(...) command specifier —
        // that is a path, not a tool name — so this asserts on the entry shape.
        //
        // Parameterised over both exporters deliberately: the two emitted DIFFERENT invalid
        // keys (`tools:` here, `allowed-tools:` there), and a claude-code-only assertion
        // let mutation M-M restore the generic one with the suite fully green.
        const fm = frontmatterOf(await promptWithScriptTool('tooled', clientId));
        const entries = (fm['allowed-tools'] as string[] | undefined) ?? [];
        for (const entry of entries) {
          expect(entry).toMatch(/^[A-Z][A-Za-z]*(\(.*\))?$/);
        }
        expect(entries).not.toContain('word_count');
        expect(entries).not.toContain('Word Counter');
      }
    );

    it('pre-approves the exact command that runs the script, not blanket Bash', async () => {
      // Auto-accept is the point: a skill is only ever read by a model, so the agent case
      // is the only case. But a bare `Bash` grant would hand every exported skill arbitrary
      // shell, so the grant is scoped by command prefix to the one script that shipped.
      const fm = frontmatterOf(await promptWithScriptTool('tooled', 'claude-code'));

      expect(fm['allowed-tools']).toEqual(['Bash(python3 tools/word_count/script.py:*)']);
      expect(fm['allowed-tools']).not.toContain('Bash');
    });

    it('pre-approves exactly the command it documents — they cannot drift', async () => {
      // `Bash(...)` matches by command prefix, so if the documented command and the
      // pre-approved one ever diverge the grant silently stops matching and the user
      // gets a permission prompt with no indication why.
      const skill = await promptWithScriptTool('tooled', 'claude-code');
      const granted = (frontmatterOf(skill)['allowed-tools'] as string[])[0];
      const command = /^Bash\((.*):\*\)$/.exec(granted ?? '')?.[1];

      expect(command).toBeTruthy();
      expect(skill).toContain(`\`${command}\``);
    });

    it('does not emit Claude Code permission syntax for other clients', async () => {
      // `Bash(cmd:*)` is Claude Code permission vocabulary. Emitting it to clients whose
      // frontmatter contract has not been verified is the exact mistake F5 documented.
      const fm = frontmatterOf(await promptWithScriptTool('tooled', 'codex'));
      expect(fm).not.toHaveProperty('allowed-tools');
    });

    it.each(['claude-code', 'codex'])('documents how to run the script (%s)', async (clientId) => {
      // Removing the frontmatter claim must not lose the information that a script
      // shipped at all — the body is where an accurate version of it belongs.
      const skill = await promptWithScriptTool('tooled', clientId);
      expect(skill).toContain('Word Counter');
      expect(skill).toContain('tools/word_count/script.py');
    });
  });
});
