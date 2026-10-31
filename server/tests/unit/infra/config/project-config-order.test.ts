/**
 * Which config file is read once a project may carry its own `.claude-prompts/config.jsonc`.
 *
 * Order: `--config`/`MCP_CONFIG_PATH`, the project's `.claude-prompts/config.jsonc`, its
 * `config.json` (only when `.jsonc` is absent), the workspace's, then the packaged file. The
 * resolver is the loader's single source for the path, so the order is asserted on
 * `getConfigPath()` and on the refusals `assertUsablePathSettings()` raises at startup.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PathResolver } from '../../../../src/runtime/paths.js';
import { PathSettingError } from '../../../../src/shared/utils/path-setting.js';

const PATH_ENV_KEYS = [
  'MCP_RUNTIME_ROOT',
  'MCP_WORKSPACE',
  'MCP_RESOURCES_PATH',
  'MCP_CONFIG_PATH',
] as const;
const savedEnv = new Map<string, string | undefined>(
  PATH_ENV_KEYS.map((key) => [key, process.env[key]])
);

describe('config file order with a project workspace', () => {
  let root: string;
  let packageRoot: string;
  let workspace: string;
  let project: string;
  let projectWorkspace: string;
  let elsewhere: string;

  beforeEach(() => {
    for (const key of PATH_ENV_KEYS) delete process.env[key];
    root = mkdtempSync(path.join(tmpdir(), 'project-config-order-'));
    packageRoot = path.join(root, 'package');
    workspace = path.join(root, 'workspace');
    project = path.join(root, 'project');
    projectWorkspace = path.join(project, '.claude-prompts');
    elsewhere = path.join(root, 'elsewhere');
    for (const dir of [packageRoot, workspace, projectWorkspace, elsewhere]) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path.join(packageRoot, 'config.json'), '{}');
    process.env['MCP_WORKSPACE'] = workspace;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function resolver(
    overrides: Partial<ConstructorParameters<typeof PathResolver>[0]> = {}
  ): PathResolver {
    return new PathResolver({
      cli: {},
      packageRoot,
      projectDiscovery: true,
      projectLaunch: { env: { CLAUDE_PROJECT_DIR: project }, cwd: elsewhere },
      ...overrides,
    });
  }

  function refusalFor(instance: PathResolver): string {
    try {
      instance.assertUsablePathSettings();
    } catch (error) {
      expect(error).toBeInstanceOf(PathSettingError);
      return (error as Error).message;
    }
    throw new Error('assertUsablePathSettings() returned instead of refusing');
  }

  it('reads the project config.jsonc before the workspace config', () => {
    const workspaceConfig = path.join(workspace, 'config.jsonc');
    const projectConfig = path.join(projectWorkspace, 'config.jsonc');
    writeFileSync(workspaceConfig, '{}');
    writeFileSync(projectConfig, '{ // project\n}');

    // Positive control: without discovery the same trees resolve to the workspace file.
    expect(resolver({ projectDiscovery: false }).getConfigPath()).toBe(workspaceConfig);

    const instance = resolver();
    expect(() => instance.assertUsablePathSettings()).not.toThrow();
    expect(instance.getConfigPath()).toBe(projectConfig);
  });

  it('reads the project config.json when it holds no config.jsonc, still before the workspace', () => {
    writeFileSync(path.join(workspace, 'config.jsonc'), '{}');
    const projectConfig = path.join(projectWorkspace, 'config.json');
    writeFileSync(projectConfig, '{}');

    expect(resolver().getConfigPath()).toBe(projectConfig);
  });

  it('lets --config and MCP_CONFIG_PATH win over the project and workspace configs', () => {
    writeFileSync(path.join(workspace, 'config.jsonc'), '{}');
    writeFileSync(path.join(projectWorkspace, 'config.jsonc'), '{}');
    const explicit = path.join(root, 'explicit.json');
    writeFileSync(explicit, '{}');

    expect(resolver({ cli: { config: explicit } }).getConfigPath()).toBe(explicit);

    process.env['MCP_CONFIG_PATH'] = explicit;
    expect(resolver().getConfigPath()).toBe(explicit);
  });

  it('does not inspect a project config an explicit --config has displaced', () => {
    writeFileSync(path.join(projectWorkspace, 'config.jsonc'), '{}');
    writeFileSync(path.join(projectWorkspace, 'config.json'), '{}');
    const explicit = path.join(root, 'explicit.json');
    writeFileSync(explicit, '{}');

    expect(() => resolver({ cli: { config: explicit } }).assertUsablePathSettings()).not.toThrow();
  });

  it('refuses a project directory holding both config.jsonc and config.json, naming both paths', () => {
    const jsoncConfig = path.join(projectWorkspace, 'config.jsonc');
    const jsonConfig = path.join(projectWorkspace, 'config.json');
    writeFileSync(jsoncConfig, '{}');
    writeFileSync(jsonConfig, '{}');

    const message = refusalFor(resolver());
    expect(message).toContain(jsoncConfig);
    expect(message).toContain(jsonConfig);
    expect(message).toContain('Refusing to start');

    // Positive control: with discovery off the same directory is not a project and nothing refuses.
    expect(() => resolver({ projectDiscovery: false }).assertUsablePathSettings()).not.toThrow();
  });

  it('refuses a project config that is not a readable JSON object', () => {
    const projectConfig = path.join(projectWorkspace, 'config.jsonc');
    writeFileSync(projectConfig, '[1, 2]');

    expect(refusalFor(resolver())).toContain(projectConfig);
  });

  it('CONTROL: with no project directory the order is the workspace file, then the packaged one', () => {
    const workspaceConfig = path.join(workspace, 'config.json');
    writeFileSync(workspaceConfig, '{}');
    rmSync(projectWorkspace, { recursive: true });

    const withWorkspace = resolver();
    expect(() => withWorkspace.assertUsablePathSettings()).not.toThrow();
    expect(withWorkspace.getConfigPath()).toBe(workspaceConfig);

    rmSync(workspaceConfig);
    expect(resolver().getConfigPath()).toBe(path.join(packageRoot, 'config.json'));
  });

  it('CONTROL: a project directory holding no config file leaves the workspace config in effect', () => {
    const workspaceConfig = path.join(workspace, 'config.jsonc');
    writeFileSync(workspaceConfig, '{}');

    expect(resolver().getConfigPath()).toBe(workspaceConfig);
  });
});
