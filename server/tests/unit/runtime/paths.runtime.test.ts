import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';
import { ConfigLoader } from '../../../src/infra/config/index.js';
import { parseServerCliArgs } from '../../../src/runtime/cli.js';
import { createPathResolver, PathResolver } from '../../../src/runtime/paths.js';
import { indexerResourceRoots, resolveResourceRoots } from '../../../src/runtime/resource-roots.js';
import { isolateResourceLocations } from '../../helpers/resource-locations.js';
import {
  assertUsableDirectorySetting,
  PathSettingError,
} from '../../../src/shared/utils/path-setting.js';

/**
 * Every path override `PathResolver` honors, neutralized for the duration of this file.
 *
 * Every one of them, not the two the assertions set. `MCP_RESOURCES_PATH` is exported into the shell by
 * the Claude Code plugin that runs this very server, so on a maintainer's machine
 * `getResourcesPath()` returned `~/.claude/resources` and the third assertion failed — while CI,
 * where nothing exports it, stayed green. A test that passes only where the product is NOT
 * installed is measuring the environment, not the resolver.
 *
 * Saved and restored rather than merely deleted: this process is shared with every other test
 * file in the run. `helpers/resource-locations.ts` owns the list and the restore.
 */
const pathLocations = isolateResourceLocations();

describe('PathResolver writable runtime paths', () => {
  it('keeps state and relative logs under MCP_RUNTIME_ROOT', () => {
    pathLocations.set({ runtimeRoot: '/tmp/codex-prompts/server', workspace: '/read-only/plugin' });
    const resolver = new PathResolver({ cli: {}, packageRoot: '/read-only/package' });

    expect(resolver.getRuntimeStatePath()).toBe('/tmp/codex-prompts/server/runtime-state');
    expect(resolver.getLogsPath('./logs')).toBe('/tmp/codex-prompts/server/logs');
    expect(resolver.getResourcesPath()).toBe('/read-only/package/resources');
  });

  it('retains an absolute configured log directory', () => {
    const resolver = new PathResolver({ cli: {}, packageRoot: '/package' });
    expect(resolver.getLogsPath('/var/tmp/claude-prompts-logs')).toBe(
      '/var/tmp/claude-prompts-logs'
    );
  });

  it('falls back to the effective workspace when no runtime root is explicit', () => {
    pathLocations.set({ workspace: path.join('/tmp', 'workspace') });
    const resolver = new PathResolver({ cli: {}, packageRoot: '/package' });

    expect(resolver.getRuntimeRoot()).toBe(path.join('/tmp', 'workspace'));
  });
});

describe('PathResolver takes CLAUDE_PLUGIN_DATA as the workspace when MCP_WORKSPACE is unset', () => {
  const packageRoot = '/claude-prompts/package';

  it('lets MCP_WORKSPACE win when both variables are set', () => {
    pathLocations.set({ workspace: '/tmp/chosen-workspace', pluginData: '/tmp/plugin-data' });
    const resolver = new PathResolver({ cli: {}, packageRoot });

    expect(resolver.getWorkspace()).toBe('/tmp/chosen-workspace');
    expect(resolver.getRuntimeRoot()).toBe('/tmp/chosen-workspace');
  });

  it('uses CLAUDE_PLUGIN_DATA as the workspace and, through it, the runtime root', () => {
    pathLocations.set({ pluginData: '/tmp/plugin-data' });
    const resolver = new PathResolver({ cli: {}, packageRoot });

    expect(resolver.getWorkspace()).toBe('/tmp/plugin-data');
    expect(resolver.getRuntimeRoot()).toBe('/tmp/plugin-data');
    expect(resolver.isUsingCustomWorkspace()).toBe(true);
  });

  it('lets --workspace win over CLAUDE_PLUGIN_DATA', () => {
    pathLocations.set({ pluginData: '/tmp/plugin-data' });
    const resolver = new PathResolver({ cli: { workspace: '/tmp/flag-workspace' }, packageRoot });

    expect(resolver.getWorkspace()).toBe('/tmp/flag-workspace');
  });

  it('falls back to the package root when neither variable is set, or CLAUDE_PLUGIN_DATA is empty', () => {
    expect(new PathResolver({ cli: {}, packageRoot }).getWorkspace()).toBe(packageRoot);

    pathLocations.set({ pluginData: '' });
    expect(new PathResolver({ cli: {}, packageRoot }).getWorkspace()).toBe(packageRoot);
  });

  describe('refusal', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'plugin-data-refusal-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    function refusalFor(resolver: PathResolver): string {
      try {
        resolver.assertUsablePathSettings();
      } catch (error) {
        expect(error).toBeInstanceOf(PathSettingError);
        return (error as Error).message;
      }
      throw new Error('assertUsablePathSettings() returned instead of refusing');
    }

    it('refuses a CLAUDE_PLUGIN_DATA naming a missing directory, naming the variable and the package root', () => {
      const missing = path.join(dir, 'no-plugin-data');
      pathLocations.set({ pluginData: missing });

      const message = refusalFor(new PathResolver({ cli: {}, packageRoot }));

      expect(message).toBe(
        [
          `Refusing to start: the CLAUDE_PLUGIN_DATA environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.`,
          `Expected an existing directory at that path, or unset CLAUDE_PLUGIN_DATA to use the package root at ${packageRoot}.`,
        ].join('\n')
      );
    });

    it('accepts an existing CLAUDE_PLUGIN_DATA, and ignores a missing one when MCP_WORKSPACE outranks it', () => {
      pathLocations.set({ pluginData: dir });
      expect(() =>
        new PathResolver({ cli: {}, packageRoot }).assertUsablePathSettings()
      ).not.toThrow();

      pathLocations.set({ workspace: dir, pluginData: path.join(dir, 'never-created') });
      expect(() =>
        new PathResolver({ cli: {}, packageRoot }).assertUsablePathSettings()
      ).not.toThrow();
    });

    it('names CLAUDE_PLUGIN_DATA as the fallback of an unusable MCP_WORKSPACE', () => {
      pathLocations.set({ workspace: path.join(dir, 'missing-workspace'), pluginData: dir });

      const message = refusalFor(new PathResolver({ cli: {}, packageRoot }));

      expect(message).toContain(
        `unset MCP_WORKSPACE to use the CLAUDE_PLUGIN_DATA workspace at ${dir}`
      );
    });

    it('names CLAUDE_PLUGIN_DATA behind an unusable --workspace when MCP_WORKSPACE is unset', () => {
      pathLocations.set({ pluginData: dir });

      const message = refusalFor(
        new PathResolver({ cli: { workspace: path.join(dir, 'missing-flag') }, packageRoot })
      );

      expect(message).toContain(
        `remove --workspace to use the CLAUDE_PLUGIN_DATA workspace at ${dir}`
      );
    });
  });
});

/**
 * An explicit config path is a statement about which settings to run with. Before this refusal,
 * `ConfigLoader.loadConfig` answered a missing, unreadable or malformed file with its built-in
 * defaults, so the server booted and served while ignoring the path it was given.
 */
describe('PathResolver refuses an explicit config path it cannot use', () => {
  let dir: string;
  const packageRoot = '/claude-prompts/package';
  const packagedDefault = path.join(packageRoot, 'config.json');

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'config-path-refusal-'));
  });

  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  function refusalFor(resolver: PathResolver): string {
    try {
      resolver.getConfigPath();
    } catch (error) {
      expect(error).toBeInstanceOf(PathSettingError);
      return (error as Error).message;
    }
    throw new Error('getConfigPath() returned instead of refusing');
  }

  it('names the variable, the value, the resolved path, the problem and the packaged default', () => {
    const missing = path.join(dir, 'nope.json');
    pathLocations.set({ configPath: missing });

    const message = refusalFor(new PathResolver({ cli: {}, packageRoot }));

    expect(message).toContain('MCP_CONFIG_PATH');
    expect(message).toContain(`"${missing}"`);
    expect(message).toContain(`resolves to ${missing}`);
    expect(message).toContain('does not exist');
    expect(message).toContain('Expected a readable JSON config file');
    expect(message).toContain(
      `unset MCP_CONFIG_PATH to use the packaged default at ${packagedDefault}`
    );
  });

  it('names the --config flag and resolves a relative value against the working directory', () => {
    const message = refusalFor(
      new PathResolver({ cli: { config: 'relative/nope.json' }, packageRoot })
    );

    expect(message).toContain('--config is set to "relative/nope.json"');
    expect(message).toContain(`resolves to ${path.resolve(process.cwd(), 'relative/nope.json')}`);
    expect(message).toContain(`remove --config to use the packaged default at ${packagedDefault}`);
    expect(message).not.toContain('MCP_CONFIG_PATH');
  });

  it('refuses a directory', () => {
    pathLocations.set({ configPath: dir });
    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      'is a directory, not a file'
    );
  });

  it('refuses a file that is not valid JSON, and JSON that is not an object', () => {
    const malformed = path.join(dir, 'malformed.json');
    writeFileSync(malformed, '{ not json');
    pathLocations.set({ configPath: malformed });
    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain('is not valid JSON (');

    const scalar = path.join(dir, 'scalar.json');
    writeFileSync(scalar, '42');
    pathLocations.set({ configPath: scalar });
    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      'is valid JSON but not a JSON object'
    );
  });

  // Root reads through mode 000, so the case is unreachable there rather than failing.
  const unreadableIt = process.getuid?.() === 0 ? it.skip : it;
  unreadableIt('refuses a file it cannot read', () => {
    const locked = path.join(dir, 'locked.json');
    writeFileSync(locked, '{}');
    chmodSync(locked, 0o000);
    pathLocations.set({ configPath: locked });

    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      'cannot be read (EACCES)'
    );
  });

  it('names the workspace config as the fallback when unsetting would resolve to it', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    writeFileSync(path.join(workspace, 'config.json'), '{}');
    pathLocations.set({ workspace, configPath: path.join(dir, 'nope.json') });

    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      `to use the workspace config at ${path.join(workspace, 'config.json')}`
    );
  });

  it('returns a usable explicit path unchanged', () => {
    const valid = path.join(dir, 'config.json');
    writeFileSync(valid, '{"logging": {"level": "warn"}}');
    pathLocations.set({ configPath: valid });

    expect(new PathResolver({ cli: {}, packageRoot }).getConfigPath()).toBe(valid);
  });

  /** Comments and a trailing comma — invalid strict JSON, valid `.jsonc`. */
  const COMMENTED_CONFIG_TEXT = [
    '{',
    '  // a line comment',
    '  /* a block comment */',
    '  "logging": { "level": "warn" },',
    '}',
  ].join('\n');

  it('accepts an explicit --config/MCP_CONFIG_PATH .jsonc path with comments and a trailing comma', () => {
    const valid = path.join(dir, 'config.jsonc');
    writeFileSync(valid, COMMENTED_CONFIG_TEXT);
    pathLocations.set({ configPath: valid });

    expect(new PathResolver({ cli: {}, packageRoot }).getConfigPath()).toBe(valid);
  });

  it('POSITIVE CONTROL — the same commented text named config.json is refused (strict JSON stays strict)', () => {
    const invalid = path.join(dir, 'config.json');
    writeFileSync(invalid, COMMENTED_CONFIG_TEXT);
    pathLocations.set({ configPath: invalid });

    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain('is not valid JSON (');
  });

  it('names the unusable workspace config it would fall back to, rather than sending the operator into a second refusal', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    writeFileSync(path.join(workspace, 'config.json'), '{ not json');
    pathLocations.set({ workspace, configPath: path.join(dir, 'nope.json') });

    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      `to use the workspace config at ${path.join(workspace, 'config.json')} (which is not valid JSON (`
    );
  });

  it('leaves the packaged default to ConfigLoader, which still answers an unusable one with built-in defaults', () => {
    // The package root here does not exist, so a check applied to the packaged default would throw.
    expect(new PathResolver({ cli: {}, packageRoot }).getConfigPath()).toBe(packagedDefault);
  });
});

/**
 * A workspace, a resources path or a workspace config.json that cannot be used stops startup.
 * Before this refusal a missing workspace was CREATED by the logs mkdir, a missing resources path
 * fell through to the bundled catalog one subfolder at a time, and a malformed workspace
 * config.json booted on built-in defaults — each a server running on settings nobody asked for.
 */
describe('PathResolver.assertUsablePathSettings refuses an unusable path setting', () => {
  let dir: string;
  const packageRoot = '/claude-prompts/package';

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'path-setting-refusal-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function refusalFor(resolver: PathResolver): string {
    try {
      resolver.assertUsablePathSettings();
    } catch (error) {
      expect(error).toBeInstanceOf(PathSettingError);
      return (error as Error).message;
    }
    throw new Error('assertUsablePathSettings() returned instead of refusing');
  }

  it('refuses a missing MCP_WORKSPACE, naming the value, the resolved path and the package root', () => {
    const missing = path.join(dir, 'no-workspace');
    pathLocations.set({ workspace: missing });

    const message = refusalFor(new PathResolver({ cli: {}, packageRoot }));

    expect(message).toBe(
      [
        `Refusing to start: the MCP_WORKSPACE environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.`,
        `Expected an existing directory at that path, or unset MCP_WORKSPACE to use the package root at ${packageRoot}.`,
      ].join('\n')
    );
  });

  it('refuses a --workspace that names a file, and names the MCP_WORKSPACE behind it as the fallback', () => {
    const file = path.join(dir, 'a-file');
    writeFileSync(file, '');
    const behind = path.join(dir, 'behind');
    pathLocations.set({ workspace: behind });

    const message = refusalFor(new PathResolver({ cli: { workspace: file }, packageRoot }));

    expect(message).toContain(`--workspace is set to "${file}"`);
    expect(message).toContain('and that path is not a directory.');
    expect(message).toContain(`remove --workspace to use the MCP_WORKSPACE workspace at ${behind}`);
  });

  it('refuses a missing MCP_RESOURCES_PATH, naming the resources it would fall back to', () => {
    const missing = path.join(dir, 'no-resources');
    pathLocations.set({ resourcesPath: missing });

    const message = refusalFor(new PathResolver({ cli: {}, packageRoot }));

    expect(message).toContain(
      `the MCP_RESOURCES_PATH environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.`
    );
    expect(message).toContain(
      `or unset MCP_RESOURCES_PATH to use the packaged resources at ${path.join(packageRoot, 'resources')}.`
    );
  });

  it('refuses a workspace config.json that is malformed, not an object, or a directory', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    const config = path.join(workspace, 'config.json');
    pathLocations.set({ workspace });

    writeFileSync(config, '{ not json');
    const malformed = refusalFor(new PathResolver({ cli: {}, packageRoot }));
    expect(malformed).toContain(
      `the MCP_WORKSPACE environment variable is set to "${workspace}", which resolves to ${workspace}, and its config file ${config} is not valid JSON (`
    );
    expect(malformed).toContain(
      `Expected a readable JSON config file at that path, or move it out of the workspace to use the packaged default at ${path.join(packageRoot, 'config.json')}.`
    );

    writeFileSync(config, '[]');
    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      'is valid JSON but not a JSON object'
    );

    rmSync(config);
    mkdirSync(config);
    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      `its config file ${config} is a directory, not a file`
    );
  });

  // Root reads through mode 000, so the case is unreachable there rather than failing.
  const unreadableIt = process.getuid?.() === 0 ? it.skip : it;
  unreadableIt('refuses a workspace config.json it cannot read', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    const config = path.join(workspace, 'config.json');
    writeFileSync(config, '{}');
    chmodSync(config, 0o000);
    pathLocations.set({ workspace });

    try {
      expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
        'cannot be read (EACCES)'
      );
    } finally {
      chmodSync(config, 0o600);
    }
  });

  it('resolves config.jsonc before config.json, and loads a commented, trailing-comma-holding one without refusing', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    const jsoncConfig = path.join(workspace, 'config.jsonc');
    writeFileSync(
      jsoncConfig,
      ['{', '  // comment', '  "logging": { "level": "warn" },', '}'].join('\n')
    );
    pathLocations.set({ workspace });

    const resolver = new PathResolver({ cli: {}, packageRoot });
    expect(() => resolver.assertUsablePathSettings()).not.toThrow();
    expect(resolver.getConfigPath()).toBe(jsoncConfig);
  });

  it('refuses a workspace holding both config.jsonc and config.json, naming both absolute paths', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    const jsoncConfig = path.join(workspace, 'config.jsonc');
    const jsonConfig = path.join(workspace, 'config.json');
    writeFileSync(jsoncConfig, '{}');
    writeFileSync(jsonConfig, '{}');
    pathLocations.set({ workspace });

    const message = refusalFor(new PathResolver({ cli: {}, packageRoot }));
    expect(message).toContain(jsoncConfig);
    expect(message).toContain(jsonConfig);
    expect(message).toContain('config.jsonc');
    expect(message).toContain('config.json');
  });

  it('does not refuse a workspace with no config.json, an empty value, or a usable explicit config beside a broken workspace one', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    pathLocations.set({ workspace });
    const resolver = new PathResolver({ cli: {}, packageRoot });
    expect(() => resolver.assertUsablePathSettings()).not.toThrow();
    expect(resolver.getConfigPath()).toBe(path.join(packageRoot, 'config.json'));

    pathLocations.set({ workspace: '', resourcesPath: '' });
    expect(() =>
      new PathResolver({ cli: { workspace: '' }, packageRoot }).assertUsablePathSettings()
    ).not.toThrow();

    // The workspace config is not the one in use once an explicit config is named.
    pathLocations.set({ workspace });
    writeFileSync(path.join(workspace, 'config.json'), '{ not json');
    const explicit = path.join(dir, 'explicit.json');
    writeFileSync(explicit, '{}');
    pathLocations.set({ configPath: explicit });
    expect(() =>
      new PathResolver({ cli: {}, packageRoot }).assertUsablePathSettings()
    ).not.toThrow();
  });

  it('assertUsableDirectorySetting returns the resolved path and words a non-server refusal as "run"', () => {
    expect(assertUsableDirectorySetting({ name: 'MCP_RESOURCES_PATH', value: dir })).toBe(dir);

    const missing = path.join(dir, 'gone');
    expect(() =>
      assertUsableDirectorySetting({ name: 'MCP_RESOURCES_PATH', value: missing }, { verb: 'run' })
    ).toThrow(
      `Refusing to run: the MCP_RESOURCES_PATH environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.\nExpected an existing directory at that path, or unset MCP_RESOURCES_PATH.`
    );
  });
});

/**
 * A custom workspace or explicit resource base receives new resources before type dirs exist.
 *
 * `resolveResourceSubdir` used to return the first directory that EXISTED, so an empty workspace
 * resolved every type to the package tree. That is the Claude Code plugin's data directory on its
 * first start, and every prompt `resource_manager` created there landed inside the install
 * directory, which the next plugin update replaced.
 */
describe('PathResolver resolves resource directories inside a custom workspace', () => {
  const TYPES = ['prompts', 'gates', 'frameworks', 'styles', 'scripts'] as const;
  let dir: string;
  let packageRoot: string;
  let workspace: string;

  function directoriesOf(resolver: PathResolver): Record<(typeof TYPES)[number], string> {
    return {
      prompts: resolver.getPromptsPath(),
      gates: resolver.getGatesPath(),
      frameworks: resolver.getFrameworksPath(),
      styles: resolver.getStylesPath(),
      scripts: resolver.getScriptsPath(),
    };
  }

  function expectedUnder(root: string): Record<(typeof TYPES)[number], string> {
    return Object.fromEntries(TYPES.map((type) => [type, path.join(root, type)])) as Record<
      (typeof TYPES)[number],
      string
    >;
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'workspace-write-root-'));
    packageRoot = path.join(dir, 'package');
    workspace = path.join(dir, 'workspace');
    for (const type of TYPES)
      mkdirSync(path.join(packageRoot, 'resources', type), { recursive: true });
    mkdirSync(workspace);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves every type to <workspace>/resources/<type> in an empty workspace, creating nothing', () => {
    pathLocations.set({ workspace });
    const resolver = new PathResolver({ cli: {}, packageRoot });

    expect(directoriesOf(resolver)).toEqual(expectedUnder(path.join(workspace, 'resources')));
    // Resolution names the directory; only a write creates it.
    expect(readdirSync(workspace)).toEqual([]);
    // The bundled tree still contributes underneath — lowest, so first in the overlay list — and
    // the not-yet-created legacy root is no overlay.
    expect(resolver.getBundledResourceDir('prompts')).toBe(
      path.join(packageRoot, 'resources', 'prompts')
    );
    expect(resolver.getOverlayResourceDirs('prompts', resolver.getPromptsPath())).toEqual([
      path.join(packageRoot, 'resources', 'prompts'),
    ]);
  });

  it('resolves the same way for a --workspace flag, and keeps a resources directory that exists', () => {
    mkdirSync(path.join(workspace, 'resources', 'gates'), { recursive: true });
    const resolver = new PathResolver({ cli: { workspace }, packageRoot });

    expect(directoriesOf(resolver)).toEqual(expectedUnder(path.join(workspace, 'resources')));
    expect(existsSync(path.join(workspace, 'resources', 'prompts'))).toBe(false);
  });

  it('keeps writing into a legacy <workspace>/<type> directory, so an existing collection does not split', () => {
    mkdirSync(path.join(workspace, 'prompts'));
    mkdirSync(path.join(workspace, 'frameworks'));
    mkdirSync(path.join(workspace, 'resources', 'frameworks'), { recursive: true });
    pathLocations.set({ workspace });
    const resolver = new PathResolver({ cli: {}, packageRoot });

    expect(resolver.getPromptsPath()).toBe(path.join(workspace, 'prompts'));
    expect(resolver.getGatesPath()).toBe(path.join(workspace, 'resources', 'gates'));
    // With both layouts present, `resources/<type>` is the root and the legacy one is an overlay beneath it.
    expect(resolver.getFrameworksPath()).toBe(path.join(workspace, 'resources', 'frameworks'));
    expect(resolver.getOverlayResourceDirs('frameworks', resolver.getFrameworksPath())).toEqual([
      path.join(packageRoot, 'resources', 'frameworks'),
      path.join(workspace, 'frameworks'),
    ]);
  });

  it.each(['environment', 'cli', 'package'] as const)(
    'keeps first-write getters inside an explicit resource base with a %s workspace',
    (workspaceSource) => {
      const resources = path.join(dir, 'desired-resource-boundary');
      mkdirSync(resources);
      pathLocations.set({ resourcesPath: resources });
      if (workspaceSource === 'environment') pathLocations.set({ workspace });
      const cli = workspaceSource === 'cli' ? { workspace } : {};
      const resolver = new PathResolver({ cli, packageRoot });
      expect(() => resolver.assertUsablePathSettings()).not.toThrow();
      expect(resolver.getResourcesPath()).toBe(resources);
      expect(directoriesOf(resolver)).toEqual(expectedUnder(resources));
      expect(readdirSync(resources)).toEqual([]);

      for (const type of TYPES) {
        const writeRoot = directoriesOf(resolver)[type];
        const marker = `${type}-desired-root`;
        mkdirSync(writeRoot);
        writeFileSync(path.join(writeRoot, '.write-root-marker'), marker);
        const readRoot = directoriesOf(new PathResolver({ cli, packageRoot }))[type];
        expect(readFileSync(path.join(readRoot, '.write-root-marker'), 'utf8')).toBe(marker);
        expect(readFileSync(path.join(resources, type, '.write-root-marker'), 'utf8')).toBe(marker);
        expect(existsSync(path.join(packageRoot, 'resources', type, '.write-root-marker'))).toBe(
          false
        );
        expect(resolver.getBundledResourceDir(type)).toBe(
          path.join(packageRoot, 'resources', type)
        );
        // Only the bundle beside the write root: no workspace layout exists.
        expect(resolver.getOverlayResourceDirs(type, writeRoot)).toEqual([
          path.join(packageRoot, 'resources', type),
        ]);
      }
      expect(readdirSync(workspace)).toEqual([]);
    }
  );

  it('retains existing explicit and legacy type directories and workspace overlays', () => {
    const resources = path.join(dir, 'personal');
    mkdirSync(path.join(resources, 'prompts'), { recursive: true });
    mkdirSync(path.join(workspace, 'gates'));
    mkdirSync(path.join(resources, 'frameworks'));
    mkdirSync(path.join(workspace, 'frameworks'));
    mkdirSync(path.join(workspace, 'resources', 'frameworks'), { recursive: true });
    pathLocations.set({ workspace, resourcesPath: resources });
    const resolver = new PathResolver({ cli: {}, packageRoot });

    expect(resolver.getPromptsPath()).toBe(path.join(resources, 'prompts'));
    expect(resolver.getGatesPath()).toBe(path.join(workspace, 'gates'));
    expect(resolver.getFrameworksPath()).toBe(path.join(resources, 'frameworks'));
    expect(resolver.getOverlayResourceDirs('frameworks', resolver.getFrameworksPath())).toEqual([
      path.join(packageRoot, 'resources', 'frameworks'),
      path.join(workspace, 'frameworks'),
      path.join(workspace, 'resources', 'frameworks'),
    ]);
  });

  it('leaves a server whose workspace is the package root on the package tree', () => {
    expect(directoriesOf(new PathResolver({ cli: {}, packageRoot }))).toEqual(
      expectedUnder(path.join(packageRoot, 'resources'))
    );

    pathLocations.set({ workspace: packageRoot });
    expect(directoriesOf(new PathResolver({ cli: {}, packageRoot }))).toEqual(
      expectedUnder(path.join(packageRoot, 'resources'))
    );
  });
});

/**
 * The project directory as a resource root (R1-R3 of the project-workspace plan).
 *
 * The project is named through the resolver's injected launch environment, never by changing this
 * process's environment or working directory: the discovery flag is off by default, so every other
 * describe block in this file runs the resolver exactly as it did before the project existed.
 */
describe('PathResolver resolves the project directory as a resource root', () => {
  const TYPES = ['prompts', 'gates', 'frameworks', 'styles', 'scripts'] as const;
  type ResourceType = (typeof TYPES)[number];
  let dir: string;
  let packageRoot: string;
  let workspace: string;
  let project: string;
  let elsewhere: string;

  const gateYaml = (name: string): string =>
    [
      'id: shadowed',
      `name: ${name}`,
      'type: validation',
      'severity: medium',
      'description: Test gate shadowed',
      'pass_criteria:',
      '  - type: inline_guidance',
      '',
    ].join('\n');

  function writeGate(root: string, name: string): void {
    mkdirSync(path.join(root, 'shadowed'), { recursive: true });
    writeFileSync(path.join(root, 'shadowed', 'gate.yaml'), gateYaml(name), 'utf-8');
  }

  /** A resolver whose project directory is `project`, found through CLAUDE_PROJECT_DIR. */
  function resolverWithDiscovery(
    overrides: Partial<ConstructorParameters<typeof PathResolver>[0]> = {}
  ) {
    return new PathResolver({
      cli: {},
      packageRoot,
      projectDiscovery: true,
      projectLaunch: { env: { CLAUDE_PROJECT_DIR: project }, cwd: elsewhere },
      ...overrides,
    });
  }

  function directoriesOf(resolver: PathResolver): Record<ResourceType, string> {
    return {
      prompts: resolver.getPromptsPath(),
      gates: resolver.getGatesPath(),
      frameworks: resolver.getFrameworksPath(),
      styles: resolver.getStylesPath(),
      scripts: resolver.getScriptsPath(),
    };
  }

  function expectedUnder(root: string): Record<ResourceType, string> {
    return Object.fromEntries(TYPES.map((type) => [type, path.join(root, type)])) as Record<
      ResourceType,
      string
    >;
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-workspace-root-'));
    packageRoot = path.join(dir, 'package');
    workspace = path.join(dir, 'workspace');
    project = path.join(dir, 'project');
    elsewhere = path.join(dir, 'elsewhere');
    for (const type of TYPES)
      mkdirSync(path.join(packageRoot, 'resources', type), { recursive: true });
    mkdirSync(workspace);
    mkdirSync(project);
    mkdirSync(elsewhere);
    pathLocations.set({ workspace });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('makes <project>/.claude-prompts/resources/<type> the primary of every type when .claude-prompts/ exists, creating nothing', () => {
    const projectWorkspace = path.join(project, '.claude-prompts');
    mkdirSync(projectWorkspace);
    const resolver = resolverWithDiscovery();

    expect(resolver.getProjectWorkspace()).toBe(projectWorkspace);
    expect(directoriesOf(resolver)).toEqual(
      expectedUnder(path.join(projectWorkspace, 'resources'))
    );
    // Resolution names the directory; only a write creates it.
    expect(readdirSync(projectWorkspace)).toEqual([]);
    expect(readdirSync(workspace)).toEqual([]);
    // The custom workspace is still the workspace: only the primary moved.
    expect(resolver.isUsingCustomWorkspace()).toBe(true);
    expect(resolver.getWorkspace()).toBe(workspace);
  });

  it('keeps writing into a per-type directory that already exists under the project, and ignores a legacy <project>/.claude-prompts/<type>/', () => {
    mkdirSync(path.join(project, '.claude-prompts', 'resources', 'gates'), { recursive: true });
    mkdirSync(path.join(project, '.claude-prompts', 'prompts'));
    const resolver = resolverWithDiscovery();

    expect(resolver.getGatesPath()).toBe(
      path.join(project, '.claude-prompts', 'resources', 'gates')
    );
    expect(resolver.getPromptsPath()).toBe(
      path.join(project, '.claude-prompts', 'resources', 'prompts')
    );
  });

  it('finds the project directory in CLAUDE_PROJECT_DIR, else in the working directory', () => {
    mkdirSync(path.join(elsewhere, '.claude-prompts'));
    const byCwd = resolverWithDiscovery({ projectLaunch: { env: {}, cwd: elsewhere } });
    expect(byCwd.getProjectWorkspace()).toBe(path.join(elsewhere, '.claude-prompts'));

    // CLAUDE_PROJECT_DIR outranks the working directory, so `project` (with no .claude-prompts/)
    // is the project and the working directory's .claude-prompts/ is not looked at.
    const byEnv = resolverWithDiscovery({
      projectLaunch: { env: { CLAUDE_PROJECT_DIR: project }, cwd: elsewhere },
    });
    expect(byEnv.getProjectWorkspace()).toBeUndefined();
  });

  it('keeps the workspace candidates as overlays and the bundle as the lowest root beneath the project primary', () => {
    mkdirSync(path.join(project, '.claude-prompts'));
    const resolver = resolverWithDiscovery();
    const primary = resolver.getGatesPath();

    // Lowest first: the bundle, then the workspace candidates.
    expect(resolver.getOverlayResourceCandidates('gates', primary)).toEqual([
      path.join(packageRoot, 'resources', 'gates'),
      path.join(workspace, 'gates'),
      path.join(workspace, 'resources', 'gates'),
    ]);
    expect(resolver.getBundledResourceDir('gates')).toBe(
      path.join(packageRoot, 'resources', 'gates')
    );
  });

  it('reads the project, the workspace candidates, then the bundle, in that order', () => {
    mkdirSync(path.join(project, '.claude-prompts'));
    const resolver = resolverWithDiscovery();

    const roots = resolveResourceRoots(resolver, 'gates', resolver.getGatesPath());

    expect(roots.primary).toBe(path.join(project, '.claude-prompts', 'resources', 'gates'));
    expect(roots.lookupDirs).toEqual([
      path.join(project, '.claude-prompts', 'resources', 'gates'),
      path.join(workspace, 'resources', 'gates'),
      path.join(workspace, 'gates'),
      path.join(packageRoot, 'resources', 'gates'),
    ]);
  });

  it('hands the indexer the project root, highest last, for every indexed type', () => {
    mkdirSync(path.join(project, '.claude-prompts'));
    const resolver = resolverWithDiscovery();
    const projectResources = path.join(project, '.claude-prompts', 'resources');

    const roots = indexerResourceRoots(resolver);

    expect(Object.keys(roots).sort()).toEqual(['framework', 'gate', 'prompt', 'style']);
    for (const [kind, type] of [
      ['prompt', 'prompts'],
      ['gate', 'gates'],
      ['framework', 'frameworks'],
      ['style', 'styles'],
    ] as const) {
      // Lowest precedence first: the walk accumulates, so the last root overwrites.
      expect(roots[kind]).toEqual([
        path.join(packageRoot, 'resources', type),
        path.join(workspace, type),
        path.join(workspace, 'resources', type),
        path.join(projectResources, type),
      ]);
    }
  });

  it('serves a gate defined in the project and in the workspace from the project copy', () => {
    const projectGates = path.join(project, '.claude-prompts', 'resources', 'gates');
    writeGate(projectGates, 'FROM PROJECT');
    writeGate(path.join(workspace, 'resources', 'gates'), 'FROM WORKSPACE');
    writeGate(path.join(workspace, 'gates'), 'FROM WORKSPACE LEGACY');
    writeGate(path.join(packageRoot, 'resources', 'gates'), 'FROM BUNDLE');
    const resolver = resolverWithDiscovery();
    const roots = resolveResourceRoots(resolver, 'gates', resolver.getGatesPath());

    const loader = new GateDefinitionLoader({
      gatesDir: roots.primary as string,
      additionalGatesDirs: roots.lookupDirs,
    });

    expect(loader.loadGate('shadowed')?.name).toBe('FROM PROJECT');
    expect(loader.loadGate('shadowed')?.sourceRoot).toBe(projectGates);
  });

  it("CONTROL: without .claude-prompts/ the primaries, the order and the served gate are the workspace's", () => {
    writeGate(path.join(workspace, 'resources', 'gates'), 'FROM WORKSPACE');
    writeGate(path.join(packageRoot, 'resources', 'gates'), 'FROM BUNDLE');
    const withDiscovery = resolverWithDiscovery();
    const withoutDiscovery = new PathResolver({ cli: {}, packageRoot });

    expect(withDiscovery.getProjectWorkspace()).toBeUndefined();
    expect(directoriesOf(withDiscovery)).toEqual(expectedUnder(path.join(workspace, 'resources')));
    expect(directoriesOf(withDiscovery)).toEqual(directoriesOf(withoutDiscovery));

    // The one addition is the project folder as a not-yet-existing location (it is what lets a
    // `.claude-prompts/` created later be served), listed first, where it will rank once it
    // exists. The primary, the bundle and what is served do not move.
    const pending = path.join(project, '.claude-prompts', 'resources', 'gates');
    const baseline = resolveResourceRoots(
      withoutDiscovery,
      'gates',
      withoutDiscovery.getGatesPath()
    );
    const roots = resolveResourceRoots(withDiscovery, 'gates', withDiscovery.getGatesPath());
    expect(existsSync(pending)).toBe(false);
    expect(roots.primary).toBe(baseline.primary);
    expect(roots.bundled).toBe(baseline.bundled);
    expect(roots.overlays).toEqual([...baseline.overlays, pending]);
    expect(roots.lookupDirs).toEqual([
      pending,
      path.join(workspace, 'resources', 'gates'),
      path.join(workspace, 'gates'),
      path.join(packageRoot, 'resources', 'gates'),
    ]);

    const loader = new GateDefinitionLoader({
      gatesDir: roots.primary as string,
      additionalGatesDirs: roots.lookupDirs,
    });
    expect(loader.loadGate('shadowed')?.name).toBe('FROM WORKSPACE');
  });

  it('CONTROL: a .claude-prompts/ that exists is ignored unless projectDiscovery is on', () => {
    mkdirSync(path.join(project, '.claude-prompts', 'resources', 'gates'), { recursive: true });
    const resolver = new PathResolver({
      cli: {},
      packageRoot,
      projectLaunch: { env: { CLAUDE_PROJECT_DIR: project }, cwd: elsewhere },
    });

    expect(resolver.getProjectWorkspace()).toBeUndefined();
    expect(directoriesOf(resolver)).toEqual(expectedUnder(path.join(workspace, 'resources')));
  });

  it('keeps the project folder as the write root of every type with MCP_RESOURCES_PATH set', () => {
    mkdirSync(path.join(project, '.claude-prompts'));
    const resources = path.join(dir, 'explicit-resources');
    mkdirSync(resources);
    pathLocations.set({ resourcesPath: resources });
    const resolver = resolverWithDiscovery();

    expect(directoriesOf(resolver)).toEqual(
      expectedUnder(path.join(project, '.claude-prompts', 'resources'))
    );
  });

  it('puts the project over the bundle when the workspace is the package root, with no overlays', () => {
    pathLocations.reset();
    mkdirSync(path.join(project, '.claude-prompts'));
    const resolver = resolverWithDiscovery();
    const primary = resolver.getGatesPath();

    expect(resolver.isUsingCustomWorkspace()).toBe(false);
    expect(primary).toBe(path.join(project, '.claude-prompts', 'resources', 'gates'));
    expect(resolveResourceRoots(resolver, 'gates', primary).lookupDirs).toEqual([
      primary,
      path.join(packageRoot, 'resources', 'gates'),
    ]);
  });

  it('answers every type from the project on the first call after .claude-prompts/ appears, and from the workspace again once it is gone', () => {
    const resolver = resolverWithDiscovery();
    const projectWorkspace = path.join(project, '.claude-prompts');

    // Positive control: every type has been asked once, so the answers below come from a cache
    // that was warm when the directory appeared, not from a first resolution.
    expect(directoriesOf(resolver)).toEqual(expectedUnder(path.join(workspace, 'resources')));
    expect(resolver.getProjectWorkspace()).toBeUndefined();

    mkdirSync(projectWorkspace);
    expect(directoriesOf(resolver)).toEqual(
      expectedUnder(path.join(projectWorkspace, 'resources'))
    );
    // Resolution names the directory; only a write creates it.
    expect(readdirSync(projectWorkspace)).toEqual([]);

    rmSync(projectWorkspace, { recursive: true });
    expect(directoriesOf(resolver)).toEqual(expectedUnder(path.join(workspace, 'resources')));
  });

  it('moves only the primary once the project appears: the project folder already led the order', () => {
    const resolver = resolverWithDiscovery();
    const projectGates = path.join(project, '.claude-prompts', 'resources', 'gates');
    const workspaceGates = path.join(workspace, 'resources', 'gates');

    const before = resolveResourceRoots(resolver, 'gates', resolver.getGatesPath());
    expect(before.primary).toBe(workspaceGates);
    expect(before.lookupDirs.slice(0, 2)).toEqual([projectGates, workspaceGates]);

    mkdirSync(path.join(project, '.claude-prompts'));
    const after = resolveResourceRoots(resolver, 'gates', resolver.getGatesPath());
    expect(after.primary).toBe(projectGates);
    expect(after.lookupDirs).toEqual(before.lookupDirs);
  });

  it('moves the write root from the MCP_RESOURCES_PATH folder to the project when .claude-prompts/ appears later', () => {
    const resources = path.join(dir, 'explicit-resources');
    mkdirSync(resources);
    pathLocations.set({ resourcesPath: resources });
    const resolver = resolverWithDiscovery();

    expect(directoriesOf(resolver)).toEqual(expectedUnder(resources));
    mkdirSync(path.join(project, '.claude-prompts'));
    expect(directoriesOf(resolver)).toEqual(
      expectedUnder(path.join(project, '.claude-prompts', 'resources'))
    );
  });

  describe('by transport, built through createPathResolver', () => {
    beforeEach(() => {
      pathLocations.set({ projectDir: project });
      mkdirSync(path.join(project, '.claude-prompts'));
    });

    const resolverFor = (...args: string[]) =>
      createPathResolver(parseServerCliArgs(args), packageRoot);

    it('makes the project the primary under --transport=stdio, and when no transport is named', () => {
      for (const resolver of [resolverFor('--transport=stdio'), resolverFor()]) {
        expect(resolver.getProjectWorkspace()).toBe(path.join(project, '.claude-prompts'));
        expect(resolver.getGatesPath()).toBe(
          path.join(project, '.claude-prompts', 'resources', 'gates')
        );
      }
    });

    it('ignores the same project directory under --transport=streamable-http and --transport=both', () => {
      for (const transport of ['streamable-http', 'both']) {
        const resolver = resolverFor(`--transport=${transport}`);
        expect(resolver.getProjectWorkspace()).toBeUndefined();
        expect(resolver.getGatesPath()).toBe(path.join(workspace, 'resources', 'gates'));
        expect(resolver.getOverlayResourceCandidates('gates')).not.toContain(
          path.join(project, '.claude-prompts', 'resources', 'gates')
        );
      }
    });
  });
});

/**
 * The one ordered location list per resource type (`PathResolver.getResourceLocations`).
 *
 * The config list goes through a real `ConfigLoader`, so the entries the resolver sees are the ones
 * the loader resolved against the config file's directory — the resolver never reads the file.
 */
describe('PathResolver.getResourceLocations builds one ordered list per type', () => {
  let dir: string;
  let packageRoot: string;
  let project: string;
  let resources: string;
  let configDir: string;

  /** A resolver with discovery on, `project` as the project directory and `list` as `paths.resources`. */
  async function resolverWith(list: string[] | undefined): Promise<PathResolver> {
    const configPath = path.join(configDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({ version: 5, ...(list !== undefined && { paths: { resources: list } }) })
    );
    const loader = new ConfigLoader(configPath);
    await loader.loadConfig();
    const resolver = new PathResolver({
      cli: {},
      packageRoot,
      projectDiscovery: true,
      projectLaunch: { env: { CLAUDE_PROJECT_DIR: project }, cwd: dir },
    });
    resolver.readResourceLocationsFrom(() => loader.getConfig().paths);
    return resolver;
  }

  const pathsAndKinds = (resolver: PathResolver, type: string): Array<[string, string]> =>
    resolver.getResourceLocations(type).locations.map(({ path: dirPath, kind }) => [dirPath, kind]);

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'resource-locations-'));
    packageRoot = path.join(dir, 'package');
    project = path.join(dir, 'project');
    resources = path.join(dir, 'var-resources');
    configDir = path.join(dir, 'cfg');
    for (const created of [
      path.join(packageRoot, 'resources', 'prompts'),
      path.join(packageRoot, 'resources', 'gates'),
      path.join(project, '.claude-prompts'),
      resources,
      path.join(dir, 'shared'),
      path.join(configDir, 'extra'),
    ]) {
      mkdirSync(created, { recursive: true });
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('orders project, the MCP_RESOURCES_PATH folder, then each listed entry with "bundled" where it is listed', async () => {
    pathLocations.set({ resourcesPath: resources });
    const resolver = await resolverWith(['../shared', 'bundled', './extra']);

    expect(pathsAndKinds(resolver, 'prompts')).toEqual([
      [path.join(project, '.claude-prompts', 'resources', 'prompts'), 'project'],
      [path.join(resources, 'prompts'), 'profile'],
      [path.join(dir, 'shared', 'prompts'), 'listed'],
      [path.join(packageRoot, 'resources', 'prompts'), 'bundled'],
      [path.join(configDir, 'extra', 'prompts'), 'listed'],
    ]);
    expect(resolver.getResourceLocations('prompts').bundledImplicit).toBe(false);
  });

  it('leaves the bundle out and reports it implicit when the list does not name "bundled"', async () => {
    pathLocations.set({ resourcesPath: resources });
    const resolver = await resolverWith(['../shared', './extra']);

    expect(pathsAndKinds(resolver, 'prompts')).toEqual([
      [path.join(project, '.claude-prompts', 'resources', 'prompts'), 'project'],
      [path.join(resources, 'prompts'), 'profile'],
      [path.join(dir, 'shared', 'prompts'), 'listed'],
      [path.join(configDir, 'extra', 'prompts'), 'listed'],
    ]);
    expect(resolver.getResourceLocations('prompts').bundledImplicit).toBe(true);
  });

  it('reports no implicit bundle when the config names no list at all', async () => {
    const resolver = await resolverWith(undefined);

    expect(resolver.getResourceLocations('prompts').bundledImplicit).toBe(false);
    // With no custom workspace the profile's folder IS the package's, placed as the bundle: last.
    expect(pathsAndKinds(resolver, 'prompts').at(-1)).toEqual([
      path.join(packageRoot, 'resources', 'prompts'),
      'bundled',
    ]);
  });

  it("makes entry two the profile's <workspace>/resources/<type> when MCP_RESOURCES_PATH is unset", async () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    pathLocations.set({ workspace });
    const resolver = await resolverWith(['../shared']);

    expect(pathsAndKinds(resolver, 'prompts')).toEqual([
      [path.join(project, '.claude-prompts', 'resources', 'prompts'), 'project'],
      [path.join(workspace, 'resources', 'prompts'), 'profile'],
      [path.join(workspace, 'prompts'), 'profile'],
      [path.join(dir, 'shared', 'prompts'), 'listed'],
    ]);
  });

  it('keeps a legacy <workspace>/<type> as entry two, and the write root, when it is the only layout present', async () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(path.join(workspace, 'prompts'), { recursive: true });
    pathLocations.set({ workspace });
    rmSync(path.join(project, '.claude-prompts'), { recursive: true });
    const resolver = await resolverWith(undefined);

    const { locations, writeRoot } = resolver.getResourceLocations('prompts');
    expect(locations.map((location) => location.path)).toEqual([
      path.join(project, '.claude-prompts', 'resources', 'prompts'),
      path.join(workspace, 'prompts'),
      path.join(workspace, 'resources', 'prompts'),
      path.join(packageRoot, 'resources', 'prompts'),
    ]);
    expect(writeRoot).toBe(path.join(workspace, 'prompts'));
    expect(resolver.getPromptsPath()).toBe(writeRoot);
  });

  it('lists the project folder first and writes into it with MCP_RESOURCES_PATH set', async () => {
    pathLocations.set({ resourcesPath: resources });
    const resolver = await resolverWith(undefined);
    const projectPrompts = path.join(project, '.claude-prompts', 'resources', 'prompts');

    expect(resolver.getResourceLocations('prompts').locations[0]).toMatchObject({
      path: projectPrompts,
      kind: 'project',
    });
    expect(resolver.getResourceLocations('prompts').writeRoot).toBe(projectPrompts);
    expect(resolver.getPromptsPath()).toBe(projectPrompts);
    expect(resolveResourceRoots(resolver, 'prompts', resolver.getPromptsPath()).lookupDirs).toEqual(
      [
        projectPrompts,
        path.join(resources, 'prompts'),
        path.join(packageRoot, 'resources', 'prompts'),
      ]
    );
  });

  it('hands the loaders the list in order with "bundled" at its listed position, and the overlays as the list reversed without the primary', async () => {
    pathLocations.set({ resourcesPath: resources });
    const resolver = await resolverWith(['../shared', 'bundled', './extra']);
    const roots = resolveResourceRoots(resolver, 'gates', resolver.getGatesPath());

    expect(roots.primary).toBe(path.join(project, '.claude-prompts', 'resources', 'gates'));
    expect(roots.lookupDirs).toEqual([
      path.join(project, '.claude-prompts', 'resources', 'gates'),
      path.join(resources, 'gates'),
      path.join(dir, 'shared', 'gates'),
      path.join(packageRoot, 'resources', 'gates'),
      path.join(configDir, 'extra', 'gates'),
    ]);
    expect(roots.overlays).toEqual([
      path.join(configDir, 'extra', 'gates'),
      path.join(packageRoot, 'resources', 'gates'),
      path.join(dir, 'shared', 'gates'),
      path.join(resources, 'gates'),
    ]);
    expect(roots.bundled).toBe(path.join(packageRoot, 'resources', 'gates'));
  });

  it('serves a gate from the earliest location that holds it', async () => {
    const gate = (name: string) =>
      [
        'id: shadowed',
        `name: ${name}`,
        'type: validation',
        'severity: medium',
        'description: Test gate shadowed',
        'pass_criteria:',
        '  - type: inline_guidance',
        '',
      ].join('\n');
    const writeGate = (root: string, name: string) => {
      mkdirSync(path.join(root, 'shadowed'), { recursive: true });
      writeFileSync(path.join(root, 'shadowed', 'gate.yaml'), gate(name), 'utf-8');
    };
    writeGate(path.join(dir, 'shared', 'gates'), 'FROM SHARED');
    writeGate(path.join(configDir, 'extra', 'gates'), 'FROM EXTRA');
    writeGate(path.join(packageRoot, 'resources', 'gates'), 'FROM BUNDLE');
    const servedBy = async (list: string[]) => {
      const resolver = await resolverWith(list);
      const roots = resolveResourceRoots(resolver, 'gates', resolver.getGatesPath());
      return new GateDefinitionLoader({
        gatesDir: roots.primary as string,
        additionalGatesDirs: roots.lookupDirs,
      }).loadGate('shadowed')?.name;
    };

    expect(await servedBy(['../shared', './extra'])).toBe('FROM SHARED');
    // CONTROL: the same three copies, the list reversed, serve the other listed copy.
    expect(await servedBy(['./extra', '../shared'])).toBe('FROM EXTRA');
  });
});

/**
 * Where a write lands once the config names `paths.writeTarget` (R3j). The resolver is handed the
 * config the composition root's way, and the loader is given the same resolver as its port, so the
 * profile folder the loader accepts is the one the resolver answers with.
 */
describe('PathResolver write root follows paths.writeTarget', () => {
  const TYPES = ['prompts', 'gates', 'frameworks', 'styles', 'scripts'] as const;
  let dir: string;
  let packageRoot: string;
  let project: string;
  let workspace: string;
  let configDir: string;

  async function resolverWith(writeTarget: string | undefined): Promise<PathResolver> {
    const resolver = new PathResolver({
      cli: {},
      packageRoot,
      projectDiscovery: true,
      projectLaunch: { env: { CLAUDE_PROJECT_DIR: project }, cwd: dir },
    });
    const configPath = path.join(configDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 5,
        paths: {
          resources: ['./lib', './lib2', 'bundled'],
          ...(writeTarget !== undefined && { writeTarget }),
        },
      })
    );
    const loader = new ConfigLoader(configPath, resolver);
    await loader.loadConfig();
    resolver.readResourceLocationsFrom(() => loader.getConfig().paths);
    return resolver;
  }

  const typeGetters = (resolver: PathResolver): Record<(typeof TYPES)[number], string> => ({
    prompts: resolver.getPromptsPath(),
    gates: resolver.getGatesPath(),
    frameworks: resolver.getFrameworksPath(),
    styles: resolver.getStylesPath(),
    scripts: resolver.getScriptsPath(),
  });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'write-target-'));
    packageRoot = path.join(dir, 'package');
    project = path.join(dir, 'project');
    workspace = path.join(dir, 'workspace');
    configDir = path.join(dir, 'cfg');
    for (const created of [
      path.join(packageRoot, 'resources', 'prompts'),
      path.join(workspace, 'resources'),
      project,
      path.join(configDir, 'lib'),
      path.join(configDir, 'lib2'),
    ]) {
      mkdirSync(created, { recursive: true });
    }
    pathLocations.set({ workspace });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes every type to <writeTarget>/<type> when the config names a listed folder', async () => {
    const resolver = await resolverWith('./lib2');
    const getters = typeGetters(resolver);

    for (const type of TYPES) {
      const expected = path.join(configDir, 'lib2', type);
      expect(resolver.getResourceLocations(type).writeRoot).toBe(expected);
      expect(getters[type]).toBe(expected);
    }
  });

  it('keeps the project folder as the write root on STDIO with writeTarget set', async () => {
    mkdirSync(path.join(project, '.claude-prompts'));
    const resolver = await resolverWith('./lib2');
    const getters = typeGetters(resolver);

    for (const type of TYPES) {
      const expected = path.join(project, '.claude-prompts', 'resources', type);
      expect(resolver.getResourceLocations(type).writeRoot).toBe(expected);
      expect(getters[type]).toBe(expected);
    }
  });

  it("writes to the profile's own folder when writeTarget is unset", async () => {
    const resolver = await resolverWith(undefined);
    const getters = typeGetters(resolver);

    for (const type of TYPES) {
      const expected = path.join(workspace, 'resources', type);
      expect(resolver.getResourceLocations(type).writeRoot).toBe(expected);
      expect(getters[type]).toBe(expected);
    }
  });

  it("keeps the profile's own layout when writeTarget names the profile's folder", async () => {
    // A legacy `<workspace>/prompts` collection: naming the profile's folder is the unset answer,
    // so the write root stays there instead of flattening to `<workspace>/resources/prompts`.
    mkdirSync(path.join(workspace, 'prompts'));
    const resolver = await resolverWith(path.join(workspace, 'resources'));

    expect(resolver.getProfileResourcesDir()).toBe(path.join(workspace, 'resources'));
    expect(resolver.getResourceLocations('prompts').writeRoot).toBe(
      path.join(workspace, 'prompts')
    );
  });
});

/**
 * A package-root server (no `--workspace`, `MCP_WORKSPACE` or `CLAUDE_PLUGIN_DATA`) under a
 * `paths.resources` list (R3r): the package's own folder is the bundle, served only where the list
 * names `"bundled"`, and never the write root while the list names a folder.
 */
describe('PathResolver at the package root under a paths.resources list', () => {
  const TYPES = ['prompts', 'gates', 'frameworks', 'styles'] as const;
  let dir: string;
  let packageRoot: string;
  let first: string;
  let second: string;

  function resolverWith(list: readonly string[]): PathResolver {
    const resolver = new PathResolver({ cli: {}, packageRoot });
    resolver.readResourceLocationsFrom(() => ({ resources: list }));
    return resolver;
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'package-root-list-'));
    packageRoot = path.join(dir, 'package');
    first = path.join(dir, 'first');
    second = path.join(dir, 'second');
    for (const type of TYPES) {
      mkdirSync(path.join(packageRoot, 'resources', type), { recursive: true });
      mkdirSync(path.join(first, type), { recursive: true });
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(TYPES)(
    'keeps the package folder out of %s and writes into the first listed folder',
    (type) => {
      const resolver = resolverWith([first, second]);
      const packageDir = path.join(packageRoot, 'resources', type);
      const writeRoot = resolver.getResourceLocations(type).writeRoot;
      const roots = resolveResourceRoots(resolver, type, writeRoot);

      expect(resolver.isUsingCustomWorkspace()).toBe(false);
      expect(writeRoot).toBe(path.join(first, type));
      expect(roots.primary).toBe(path.join(first, type));
      expect(roots.lookupDirs).toEqual([path.join(first, type), path.join(second, type)]);
      expect(roots.lookupDirs).not.toContain(packageDir);
      expect(roots.bundled).toBeUndefined();
    }
  );

  it('answers the same write root through the per-type getters', () => {
    const resolver = resolverWith([first, 'bundled']);

    expect(resolver.getPromptsPath()).toBe(path.join(first, 'prompts'));
    expect(resolver.getGatesPath()).toBe(path.join(first, 'gates'));
    expect(resolver.getFrameworksPath()).toBe(path.join(first, 'frameworks'));
    expect(resolver.getStylesPath()).toBe(path.join(first, 'styles'));
  });

  it('CONTROL: with "bundled" listed, the package folder serves at its listed position', () => {
    const resolver = resolverWith(['bundled', first]);
    const packageDir = path.join(packageRoot, 'resources', 'prompts');
    const writeRoot = resolver.getResourceLocations('prompts').writeRoot;
    const roots = resolveResourceRoots(resolver, 'prompts', writeRoot);

    // The write root is still the first listed FOLDER, never the bundle the list names first.
    expect(writeRoot).toBe(path.join(first, 'prompts'));
    expect(roots.lookupDirs).toEqual([packageDir, path.join(first, 'prompts')]);
    expect(roots.bundled).toBe(packageDir);
  });

  it('CONTROL: with no list, the package folder stays the primary write root', () => {
    const resolver = resolverWith([]);
    const packageDir = path.join(packageRoot, 'resources', 'prompts');

    expect(resolver.getResourceLocations('prompts').writeRoot).toBe(packageDir);
    expect(resolveResourceRoots(resolver, 'prompts', packageDir).lookupDirs).toEqual([packageDir]);
  });
});
