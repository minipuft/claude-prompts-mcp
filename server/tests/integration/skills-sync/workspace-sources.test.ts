/**
 * Workspace Source Integration Tests
 *
 * Skills sync reads the resource roots the server serves: the bundled package tree, with the
 * workspace named by MCP_WORKSPACE layered over it, and a workspace entry with the same identity
 * winning. The Claude Code plugin sets MCP_WORKSPACE and nothing else, so a sync that reads only
 * the package tree exports none of a plugin user's own prompts or gates, and writes into a folder
 * that every plugin update replaces.
 *
 * Two temp dirs: the package root (named through MCP_SERVER_ROOT) and the workspace.
 * Real loader, real gate resolver, real adapters, real filesystem.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

import {
  runSkillsSyncCommand,
  type SkillsSyncOptions,
  type SkillsSyncOutput,
} from '../../../src/modules/skills-sync/service.js';
import { resolveSkillsSyncPaths } from '../../../src/runtime/skills-sync-paths.js';

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

async function writeGate(
  root: string,
  id: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const gateDir = path.join(root, 'resources', 'gates', id);
  await mkdir(gateDir, { recursive: true });
  await writeFile(
    path.join(gateDir, 'gate.yaml'),
    yaml.dump({ id, name: id, type: 'validation', description: `${id} gate`, ...extra })
  );
  await writeFile(path.join(gateDir, 'guidance.md'), `Guidance for ${id}.`);
}

async function writePrompt(
  root: string,
  category: string,
  id: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const dir = path.join(root, 'resources', 'prompts', category, id);
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

async function writeConfig(root: string, outputDir: string): Promise<string> {
  const configPath = path.join(root, 'skills-sync.yaml');
  await writeFile(
    configPath,
    yaml.dump({
      registrations: { 'claude-code': 'all' },
      overrides: { 'claude-code': { outputDir: { user: outputDir, project: outputDir } } },
    })
  );
  return configPath;
}

async function run(options: SkillsSyncOptions) {
  const out = silentOutput();
  const report = await runSkillsSyncCommand(options, out, resolveSkillsSyncPaths());
  return { out, report };
}

describe('skills sync reads the workspace over the bundled tree', () => {
  let tmpDir: string;
  let packageRoot: string;
  let workspace: string;
  let outputDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'skills-workspace-'));
    packageRoot = path.join(tmpDir, 'package');
    workspace = path.join(tmpDir, 'workspace');
    outputDir = path.join(tmpDir, 'output');
    await mkdir(path.join(packageRoot, 'resources'), { recursive: true });
    await mkdir(path.join(workspace, 'resources'), { recursive: true });
    await mkdir(outputDir, { recursive: true });

    savedEnv = Object.fromEntries(
      ['MCP_SERVER_ROOT', 'MCP_RESOURCES_PATH', 'MCP_WORKSPACE', 'MCP_RUNTIME_ROOT'].map((key) => [
        key,
        process.env[key],
      ])
    );
    process.env['MCP_SERVER_ROOT'] = packageRoot;
    process.env['MCP_WORKSPACE'] = workspace;
    delete process.env['MCP_RESOURCES_PATH'];
    delete process.env['MCP_RUNTIME_ROOT'];
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('previews a workspace prompt together with the workspace gate it names', async () => {
    await writeGate(workspace, 'workspace-gate');
    await writeGate(packageRoot, 'bundled-gate');
    await writePrompt(workspace, 'general', 'workspace_prompt', {
      gateConfiguration: { include: ['workspace-gate', 'bundled-gate'] },
    });
    await writeConfig(packageRoot, outputDir);

    const prompt = await run({
      command: 'export',
      client: 'claude-code',
      scope: 'user',
      resourceType: 'prompt',
      id: 'workspace_prompt',
      preview: true,
    });
    expect(prompt.report.resources).toBe(1);
    expect(prompt.out.logs).toContain('  [preview] workspace_prompt/SKILL.md');
    // The workspace gate resolves from the workspace, and a bundled gate stays reachable under it.
    expect(prompt.out.logs).toContain(
      '  [preview] workspace_prompt/gates/workspace-gate/guidance.md'
    );
    expect(prompt.out.logs).toContain(
      '  [preview] workspace_prompt/gates/bundled-gate/guidance.md'
    );

    const gate = await run({
      command: 'export',
      client: 'claude-code',
      scope: 'user',
      resourceType: 'gate',
      id: 'workspace-gate',
      preview: true,
    });
    expect(gate.report.resources).toBe(1);
    expect(existsSync(path.join(outputDir, 'workspace_prompt'))).toBe(false);
  });

  it('exports the workspace copy of a prompt the package also ships', async () => {
    await writePrompt(packageRoot, 'general', 'shared_prompt', { description: 'bundled copy' });
    await writePrompt(workspace, 'general', 'shared_prompt', { description: 'workspace copy' });
    await writeConfig(packageRoot, outputDir);

    const { report } = await run({
      command: 'export',
      client: 'claude-code',
      scope: 'user',
      resourceType: 'prompt',
      id: 'shared_prompt',
    });

    expect(report.resources).toBe(1);
    const skill = await readFile(path.join(outputDir, 'shared_prompt', 'SKILL.md'), 'utf-8');
    expect(skill).toContain('workspace copy');
    expect(skill).not.toContain('bundled copy');
  });

  it('reads skills-sync.yaml from the workspace before the package, and leaves the package file alone', async () => {
    await writePrompt(packageRoot, 'general', 'config_probe');
    const packageOutput = path.join(tmpDir, 'package-output');
    const packageConfig = await writeConfig(packageRoot, packageOutput);
    const packageConfigBefore = await readFile(packageConfig, 'utf-8');
    await writeConfig(workspace, outputDir);

    await run({ command: 'export', client: 'claude-code', scope: 'user', id: 'config_probe' });

    expect(existsSync(path.join(outputDir, 'config_probe', 'SKILL.md'))).toBe(true);
    expect(existsSync(packageOutput)).toBe(false);
    expect(await readFile(packageConfig, 'utf-8')).toBe(packageConfigBefore);
  });

  it('refuses to pull an edit back into a bundled prompt while a workspace is set', async () => {
    const bundledDir = await writePrompt(packageRoot, 'general', 'bundled_pull');
    await writeConfig(packageRoot, outputDir);
    await run({ command: 'export', client: 'claude-code', scope: 'user', id: 'bundled_pull' });

    const skillPath = path.join(outputDir, 'bundled_pull', 'SKILL.md');
    const exported = await readFile(skillPath, 'utf-8');
    expect(exported).toContain('Do the thing.');
    await writeFile(skillPath, exported.replace('Do the thing.', 'Do the other thing.'));

    const { out, report } = await run({ command: 'pull', client: 'claude-code', scope: 'user' });

    const bundledSource = path.join(bundledDir, 'user-message.md');
    expect(await readFile(bundledSource, 'utf-8')).toBe('Do the thing.');
    expect(report.failures.map((failure) => failure.id)).toContain('bundled_pull');
    const refusal = out.warns.find((warning) => warning.includes('bundled_pull'));
    expect(refusal).toBeDefined();
    expect(refusal).toContain(bundledSource);
    expect(refusal).toContain(workspace);
  });

  it('clones a SKILL.md into the workspace rather than the package tree', async () => {
    const skillDir = path.join(tmpDir, 'source', 'cloned_skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: Cloned Skill\ndescription: A cloned skill.\n---\n\n## Usage\n\nReview this.\n'
    );

    await run({
      command: 'clone',
      file: path.join(skillDir, 'SKILL.md'),
      id: 'cloned_skill',
      category: 'testing',
    });

    const relative = path.join('resources', 'prompts', 'testing', 'cloned_skill', 'prompt.yaml');
    expect(existsSync(path.join(workspace, relative))).toBe(true);
    expect(existsSync(path.join(packageRoot, relative))).toBe(false);
  });

  it('writes patch files under MCP_RUNTIME_ROOT when it is set, not under the package', async () => {
    await writeConfig(workspace, outputDir);
    const runtimeRoot = path.join(tmpDir, 'runtime');
    process.env['MCP_RUNTIME_ROOT'] = runtimeRoot;

    await run({ command: 'patch', client: 'claude-code', scope: 'user' });

    expect(existsSync(path.join(runtimeRoot, 'runtime-state', 'patches'))).toBe(true);
    expect(existsSync(path.join(packageRoot, 'runtime-state'))).toBe(false);
  });

  it('writes patch files under the workspace when MCP_RUNTIME_ROOT is unset', async () => {
    await writeConfig(workspace, outputDir);

    await run({ command: 'patch', client: 'claude-code', scope: 'user' });

    expect(existsSync(path.join(workspace, 'runtime-state', 'patches'))).toBe(true);
    expect(existsSync(path.join(packageRoot, 'runtime-state'))).toBe(false);
  });

  it('applies gates.harnessCovers from the config.json the server reads, the workspace one first', async () => {
    // The server reads the workspace's config.json when the workspace holds one, so an export
    // that read only the package's copy would keep a reminder the runtime leaves out.
    await writeGate(packageRoot, 'security-reminder', {
      subject: 'security',
      pass_criteria: [{ type: 'inline_guidance' }],
    });
    await writePrompt(workspace, 'general', 'covered_prompt', {
      gateConfiguration: { include: ['security-reminder'] },
    });
    await writeFile(
      path.join(workspace, 'config.json'),
      JSON.stringify({ gates: { harnessCovers: ['security'] } })
    );
    await writeConfig(workspace, outputDir);

    await run({ command: 'export', client: 'claude-code', scope: 'user', id: 'covered_prompt' });

    const skill = await readFile(path.join(outputDir, 'covered_prompt', 'SKILL.md'), 'utf-8');
    expect(skill).toContain("Omitted 1 reminder(s) this installation's harness covers: security.");
    expect(skill).not.toContain('| security-reminder |');
  });
});
