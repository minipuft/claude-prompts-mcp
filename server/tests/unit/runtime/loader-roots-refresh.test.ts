/**
 * A loader takes its roots again when the project `.claude-prompts/` appears (R2).
 *
 * The gate, framework and style loaders fix their lookup order at construction, from the roots the
 * resolver named at startup. A project directory created since is the primary now and outranks the
 * workspace, but a loader that kept the startup order kept serving the workspace copy of a shared
 * id. `refreshRoots` is how the reconciliation after a late directory re-asks, through the same
 * `resolveResourceRoots` that configured the loader, so no order is stated twice.
 *
 * Each case is driven twice over one loader: before the directory exists (the order is the
 * startup one, and a refresh changes nothing), and after (the refresh moves the project to the
 * front, drops the cached definition, and a second refresh changes nothing again).
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';
import { RuntimeFrameworkLoader } from '../../../src/engine/frameworks/definitions/runtime-framework-loader.js';
import { StyleDefinitionLoader } from '../../../src/modules/formatting/core/style-definition-loader.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import {
  createLoaderRootsSource,
  resolveResourceRoots,
} from '../../../src/runtime/resource-roots.js';

type TypeDir = 'gates' | 'frameworks' | 'styles';

/** The entry file and a minimal valid document, per type, whose `description` names its origin. */
const ENTRY: Record<TypeDir, { file: string; document: (origin: string) => string }> = {
  gates: {
    file: 'gate.yaml',
    document: (origin) =>
      [
        'id: shared',
        'name: Shared',
        'type: validation',
        'severity: medium',
        `description: ${origin}`,
        'pass_criteria:',
        '  - type: inline_guidance',
        '',
      ].join('\n'),
  },
  frameworks: {
    file: 'framework.yaml',
    document: (origin) =>
      [
        'id: shared',
        'name: Shared',
        'type: SHARED',
        'enabled: true',
        `systemPromptGuidance: ${origin}`,
        'version: 1.0.0',
        'toolDescriptions: {}',
        '',
      ].join('\n'),
  },
  styles: {
    file: 'style.yaml',
    document: (origin) =>
      ['id: shared', 'name: Shared', `description: ${origin}`, 'enabled: true', ''].join('\n'),
  },
};

describe('loader.refreshRoots follows a project .claude-prompts/ created after construction', () => {
  let dir: string;
  let packageRoot: string;
  let workspace: string;
  let project: string;
  let resolver: PathResolver;
  const saved: Record<string, string | undefined> = {};

  const write = (root: string, type: TypeDir, origin: string): void => {
    mkdirSync(path.join(root, 'shared'), { recursive: true });
    writeFileSync(path.join(root, 'shared', ENTRY[type].file), ENTRY[type].document(origin));
  };

  /** A loader configured the way the composition root configures it. */
  function configured(type: TypeDir) {
    const roots = resolveResourceRoots(resolver, type, primaryOf(type));
    const rootsSource = createLoaderRootsSource(resolver, type);
    if (type === 'gates') {
      return new GateDefinitionLoader({
        gatesDir: roots.primary as string,
        additionalGatesDirs: roots.lookupDirs,
        rootsSource,
      });
    }
    if (type === 'frameworks') {
      return new RuntimeFrameworkLoader({
        frameworksDir: roots.primary as string,
        additionalFrameworksDirs: roots.lookupDirs,
        rootsSource,
      });
    }
    return new StyleDefinitionLoader({
      stylesDir: roots.primary as string,
      additionalStylesDirs: roots.lookupDirs,
      rootsSource,
    });
  }

  const primaryOf = (type: TypeDir): string =>
    type === 'gates'
      ? resolver.getGatesPath()
      : type === 'frameworks'
        ? resolver.getFrameworksPath()
        : resolver.getStylesPath();

  /** The origin the loader serves for the shared id, and the root it came from. */
  function served(
    loader: GateDefinitionLoader | RuntimeFrameworkLoader | StyleDefinitionLoader,
    type: TypeDir
  ): { origin: string | undefined; sourceRoot: string | undefined } {
    if (type === 'gates') {
      const gate = (loader as GateDefinitionLoader).loadGate('shared');
      return { origin: gate?.description, sourceRoot: gate?.sourceRoot };
    }
    if (type === 'frameworks') {
      const framework = (loader as RuntimeFrameworkLoader).loadFramework('shared');
      return { origin: framework?.systemPromptGuidance, sourceRoot: framework?.sourceRoot };
    }
    const style = (loader as StyleDefinitionLoader).loadStyle('shared');
    return { origin: style?.description, sourceRoot: style?.sourceRoot };
  }

  beforeEach(() => {
    for (const key of ['MCP_WORKSPACE', 'MCP_RESOURCES_PATH']) saved[key] = process.env[key];
    dir = mkdtempSync(path.join(tmpdir(), 'loader-roots-refresh-'));
    packageRoot = path.join(dir, 'package');
    workspace = path.join(dir, 'workspace');
    project = path.join(dir, 'project');
    mkdirSync(path.join(packageRoot, 'resources'), { recursive: true });
    mkdirSync(workspace);
    mkdirSync(project);
    process.env['MCP_WORKSPACE'] = workspace;
    delete process.env['MCP_RESOURCES_PATH'];
    resolver = new PathResolver({
      cli: {},
      packageRoot,
      projectDiscovery: true,
      projectLaunch: { env: { CLAUDE_PROJECT_DIR: project }, cwd: dir },
    });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(['gates', 'frameworks', 'styles'] as const)(
    'moves the project to the front of the %s lookup and serves its copy of a shared id',
    (type) => {
      const workspaceRoot = path.join(workspace, 'resources', type);
      const projectRoot = path.join(project, '.claude-prompts', 'resources', type);
      write(workspaceRoot, type, 'FROM WORKSPACE');
      const loader = configured(type);

      // Before: the workspace is the primary, so the workspace copy serves and a refresh is a no-op.
      expect(served(loader, type)).toEqual({ origin: 'FROM WORKSPACE', sourceRoot: workspaceRoot });
      expect(loader.getWatchDirectories()).toEqual(
        expect.arrayContaining([workspaceRoot, projectRoot])
      );
      const watchedBefore = [...loader.getWatchDirectories()].sort();
      expect(loader.refreshRoots()).toBe(false);

      // The project directory appears, holding its own copy of the id.
      write(projectRoot, type, 'FROM PROJECT');
      // Positive control: nothing has asked the loader to look again, so it still serves the
      // workspace copy from its cache.
      expect(served(loader, type).origin).toBe('FROM WORKSPACE');

      expect(loader.refreshRoots()).toBe(true);
      expect(served(loader, type)).toEqual({ origin: 'FROM PROJECT', sourceRoot: projectRoot });
      expect(loader.getWatchDirectories()[0]).toBe(projectRoot);
      // Only the rank moved: the same directories are watched, so no new watch is needed.
      expect([...loader.getWatchDirectories()].sort()).toEqual(watchedBefore);

      // Idempotent: asking again, with nothing changed, changes nothing.
      expect(loader.refreshRoots()).toBe(false);
    }
  );

  it.each(['gates', 'frameworks', 'styles'] as const)(
    'CONTROL: a %s loader configured without a source never moves',
    (type) => {
      const workspaceRoot = path.join(workspace, 'resources', type);
      const projectRoot = path.join(project, '.claude-prompts', 'resources', type);
      write(workspaceRoot, type, 'FROM WORKSPACE');
      const roots = resolveResourceRoots(resolver, type, primaryOf(type));
      const config = { rootsSource: undefined };
      const loader =
        type === 'gates'
          ? new GateDefinitionLoader({
              gatesDir: roots.primary!,
              additionalGatesDirs: roots.lookupDirs,
              ...config,
            })
          : type === 'frameworks'
            ? new RuntimeFrameworkLoader({
                frameworksDir: roots.primary!,
                additionalFrameworksDirs: roots.lookupDirs,
                ...config,
              })
            : new StyleDefinitionLoader({
                stylesDir: roots.primary!,
                additionalStylesDirs: roots.lookupDirs,
                ...config,
              });

      write(projectRoot, type, 'FROM PROJECT');

      expect(loader.refreshRoots()).toBe(false);
      expect(served(loader, type).origin).toBe('FROM WORKSPACE');
    }
  );
});
