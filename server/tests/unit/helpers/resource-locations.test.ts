/**
 * The resource-locations helper keeps a maintainer's exported path variables out of a test and
 * puts them back afterward.
 *
 * Every other file that locates resources through the helper trusts these four properties, and a
 * helper that stopped restoring would not fail any of them: the next test scrubs the variable
 * again, so the leak only shows to a reader of `process.env` after the cleanup. These cases read it.
 *
 * The ambient variables are seeded through `RESOURCE_LOCATION_ENV_KEYS` rather than by name, so
 * this file is the one place that writes a location variable without going through the helper.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  RESOURCE_LOCATION_ENV_KEYS,
  isolateResourceLocations,
  resourceLocationEnv,
  withResourceLocations,
} from '../../helpers/resource-locations.js';

const AMBIENT = '/ambient/personal-library';

/** The shell this suite runs in, as a maintainer's would be: every location variable exported. */
const outerEnv = new Map<string, string | undefined>();

function exportAmbient(): void {
  for (const key of RESOURCE_LOCATION_ENV_KEYS) {
    outerEnv.set(key, process.env[key]);
    process.env[key] = `${AMBIENT}/${key}`;
  }
}

function restoreOuter(): void {
  for (const [key, value] of outerEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('withResourceLocations', () => {
  beforeAll(exportAmbient);
  afterAll(restoreOuter);

  it('hides every exported location variable during the test and returns all of them after', () => {
    const scope = withResourceLocations({ resourcesPath: '/tmp/chosen' });

    expect(process.env['MCP_RESOURCES_PATH']).toBe('/tmp/chosen');
    for (const key of RESOURCE_LOCATION_ENV_KEYS) {
      if (key !== 'MCP_RESOURCES_PATH') expect(process.env[key]).toBeUndefined();
    }

    scope.cleanup();
    for (const key of RESOURCE_LOCATION_ENV_KEYS) {
      expect(process.env[key]).toBe(`${AMBIENT}/${key}`);
    }
  });

  it('does not carry one setup into the next when two run back to back', () => {
    const first = withResourceLocations({ resourcesPath: '/tmp/first', workspace: '/tmp/ws' });
    first.cleanup();
    expect(process.env['MCP_RESOURCES_PATH']).toBe(`${AMBIENT}/MCP_RESOURCES_PATH`);

    const second = withResourceLocations({ workspace: '/tmp/ws-two' });
    expect(process.env['MCP_RESOURCES_PATH']).toBeUndefined();
    expect(process.env['MCP_WORKSPACE']).toBe('/tmp/ws-two');
    second.cleanup();
    expect(process.env['MCP_RESOURCES_PATH']).toBe(`${AMBIENT}/MCP_RESOURCES_PATH`);
    expect(process.env['MCP_WORKSPACE']).toBe(`${AMBIENT}/MCP_WORKSPACE`);
  });

  it('reset clears what an earlier set named, then applies the new options', () => {
    const scope = withResourceLocations({ workspace: '/tmp/ws' });
    scope.set({ resourcesPath: '/tmp/res' });
    expect(scope.env).toEqual({ MCP_WORKSPACE: '/tmp/ws', MCP_RESOURCES_PATH: '/tmp/res' });

    scope.reset({ serverRoot: '/tmp/pkg' });
    expect(process.env['MCP_WORKSPACE']).toBeUndefined();
    expect(process.env['MCP_RESOURCES_PATH']).toBeUndefined();
    expect(process.env['MCP_SERVER_ROOT']).toBe('/tmp/pkg');
    expect(scope.env).toEqual({ MCP_SERVER_ROOT: '/tmp/pkg' });

    scope.cleanup();
    expect(process.env['MCP_WORKSPACE']).toBe(`${AMBIENT}/MCP_WORKSPACE`);
  });
});

describe('resourceLocationEnv', () => {
  beforeAll(exportAmbient);
  afterAll(restoreOuter);

  it('names each option by its variable and leaves this process alone', () => {
    const env = resourceLocationEnv({
      workspace: '/tmp/ws',
      resourcesPath: '/tmp/res',
      runtimeRoot: '/tmp/rt',
      configPath: '/tmp/cfg.jsonc',
      pluginData: '/tmp/plugin',
      projectDir: '/tmp/project',
    });

    expect(env).toEqual({
      MCP_WORKSPACE: '/tmp/ws',
      MCP_RESOURCES_PATH: '/tmp/res',
      MCP_RUNTIME_ROOT: '/tmp/rt',
      MCP_CONFIG_PATH: '/tmp/cfg.jsonc',
      CLAUDE_PLUGIN_DATA: '/tmp/plugin',
      CLAUDE_PROJECT_DIR: '/tmp/project',
    });
    expect(process.env['MCP_RESOURCES_PATH']).toBe(`${AMBIENT}/MCP_RESOURCES_PATH`);
  });
});

describe('a paths.resources list', () => {
  let workspace: string | undefined;

  beforeAll(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'resource-locations-list-'));
  });
  afterAll(() => {
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  });

  it('is written to the workspace config.jsonc, in order, and needs a workspace to live in', () => {
    const ws = workspace as string;
    const env = resourceLocationEnv({ workspace: ws, list: ['bundled', '/tmp/library'] });

    expect(env).toEqual({ MCP_WORKSPACE: ws });
    expect(JSON.parse(readFileSync(path.join(ws, 'config.jsonc'), 'utf8'))).toEqual({
      paths: { resources: ['bundled', '/tmp/library'] },
    });

    // Positive control for the refusal: the same call with a workspace wrote a file above.
    expect(() => resourceLocationEnv({ list: ['bundled'] })).toThrow('needs `workspace`');
    expect(existsSync(path.join(ws, 'config.jsonc'))).toBe(true);
  });
});

describe('isolateResourceLocations', () => {
  const handle = isolateResourceLocations();

  beforeAll(exportAmbient);
  afterAll(restoreOuter);

  // Ordered pair: the second case reads what the first one left behind.
  it('lets a test set a location', () => {
    handle.set({ resourcesPath: '/tmp/set-in-first-test' });
    expect(process.env['MCP_RESOURCES_PATH']).toBe('/tmp/set-in-first-test');
  });

  it('hands the next test a clean slate rather than the previous test or the shell', () => {
    for (const key of RESOURCE_LOCATION_ENV_KEYS) expect(process.env[key]).toBeUndefined();
  });
});
