// @lifecycle canonical - cpm's config readers and writers act on the file the server reads, project config included.
/**
 * `cpm config` and the version-history scope follow the server's six-step order (owner ruling R1)
 *
 * The server prefers `<project>/.claude-prompts/config.jsonc` (then `.json`) to the workspace's
 * config. These readers used to look at the workspace only, so a `cpm config set` run inside a
 * project edited a file the server running there was not reading, and `cpm config get` reported a
 * value the server did not use. Each case pairs the project behaviour with a control that removes
 * exactly the project folder, so "the workspace answered" is shown to be the other branch and not
 * an accident of the fixture.
 *
 * The project directory is `CLAUDE_PROJECT_DIR`, else the working directory, read from the
 * process the way the server reads it; the cases set the variable and restore it.
 *
 * Classification: Unit (real files in a temp directory, no mocks).
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONFIG_JSONC_TEMPLATE } from '../../../src/cli-shared/_generated/config-template.js';
import {
  readConfig,
  resetConfig,
  resolveConfigPath,
  setConfigValue,
  validateConfig,
} from '../../../src/cli-shared/config-operations.js';
import { resolveTenantId } from '../../../src/cli-shared/version-history-scope.js';

const ENV_KEYS = ['CLAUDE_PROJECT_DIR', 'MCP_CONFIG_PATH'] as const;

const WORKSPACE_CONFIG = `{
  "gates": { "enabled": true },
  "logging": { "level": "info" }
}
`;

const PROJECT_CONFIG = `// the project's own settings
{
  "gates": { "enabled": false }, // this project reviews nothing
  "logging": { "level": "debug" },
}
`;

describe('cpm follows the server order for a project config', () => {
  const savedEnv = new Map<string, string | undefined>(
    ENV_KEYS.map((key) => [key, process.env[key]])
  );
  let root: string;
  let workspace: string;
  let project: string;
  let projectWorkspace: string;

  const workspaceJsonc = (): string => join(workspace, 'config.jsonc');
  const projectJsonc = (): string => join(projectWorkspace, 'config.jsonc');
  const projectJson = (): string => join(projectWorkspace, 'config.json');

  /** The control: the same trees with the project folder gone, so only the workspace remains. */
  function removeProjectFolder(): void {
    rmSync(projectWorkspace, { recursive: true, force: true });
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cpm-config-project-'));
    workspace = join(root, 'workspace');
    project = join(root, 'project');
    projectWorkspace = join(project, '.claude-prompts');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(projectWorkspace, { recursive: true });
    writeFileSync(workspaceJsonc(), WORKSPACE_CONFIG, 'utf8');
    delete process.env['MCP_CONFIG_PATH'];
    process.env['CLAUDE_PROJECT_DIR'] = project;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('reading', () => {
    it('sees a project config value where the workspace holds another', () => {
      writeFileSync(projectJsonc(), PROJECT_CONFIG, 'utf8');

      const result = readConfig(workspace);

      expect(result.success).toBe(true);
      expect(result.configPath).toBe(projectJsonc());
      expect(result.config).toMatchObject({
        gates: { enabled: false },
        logging: { level: 'debug' },
      });
    });

    it('reads the workspace config when the project folder is gone (control)', () => {
      writeFileSync(projectJsonc(), PROJECT_CONFIG, 'utf8');
      removeProjectFolder();

      const result = readConfig(workspace);

      expect(result.configPath).toBe(workspaceJsonc());
      expect(result.config).toMatchObject({ gates: { enabled: true } });
    });

    it('reads the workspace config when the project folder holds none', () => {
      expect(readConfig(workspace).configPath).toBe(workspaceJsonc());
    });

    it('reads a project config.json when the project holds no config.jsonc', () => {
      writeFileSync(projectJson(), '{ "gates": { "enabled": false } }\n', 'utf8');

      const result = readConfig(workspace);

      expect(result.configPath).toBe(projectJson());
      expect(result.config).toMatchObject({ gates: { enabled: false } });
    });

    it('takes the project directory from the working directory when CLAUDE_PROJECT_DIR is unset', () => {
      writeFileSync(projectJsonc(), PROJECT_CONFIG, 'utf8');

      expect(resolveConfigPath(workspace, { env: {}, cwd: project })).toBe(projectJsonc());
      expect(resolveConfigPath(workspace, { env: {}, cwd: root })).toBe(workspaceJsonc());
    });

    it('lets MCP_CONFIG_PATH outrank the project config, as it does on the server', () => {
      writeFileSync(projectJsonc(), PROJECT_CONFIG, 'utf8');
      const explicit = join(root, 'explicit.json');
      writeFileSync(explicit, '{ "gates": { "enabled": true } }\n', 'utf8');
      process.env['MCP_CONFIG_PATH'] = explicit;

      expect(readConfig(workspace).configPath).toBe(explicit);
    });

    it('refuses a project folder holding both config names, naming both files', () => {
      writeFileSync(projectJsonc(), PROJECT_CONFIG, 'utf8');
      writeFileSync(projectJson(), '{}\n', 'utf8');

      const result = readConfig(workspace);

      expect(result.success).toBe(false);
      expect(result.error).toContain(projectJsonc());
      expect(result.error).toContain(projectJson());
    });

    it('validates the project config, not the workspace one', () => {
      writeFileSync(projectJsonc(), '{ "gates": { "enabled": "perhaps" } }\n', 'utf8');

      expect(validateConfig(workspace).valid).toBe(false);

      removeProjectFolder();
      expect(validateConfig(workspace).valid).toBe(true);
    });
  });

  describe('writing', () => {
    it('sets a value in the project config and leaves the workspace config byte-identical', () => {
      writeFileSync(projectJsonc(), PROJECT_CONFIG, 'utf8');

      const result = setConfigValue(workspace, 'logging.level', 'warn');

      expect(result).toMatchObject({ success: true, previousValue: 'debug', newValue: 'warn' });
      expect(readFileSync(projectJsonc(), 'utf8')).toBe(
        PROJECT_CONFIG.replace('"debug"', '"warn"')
      );
      expect(readFileSync(workspaceJsonc(), 'utf8')).toBe(WORKSPACE_CONFIG);
    });

    it('sets a value in the workspace config when the project folder is gone (control)', () => {
      writeFileSync(projectJsonc(), PROJECT_CONFIG, 'utf8');
      removeProjectFolder();

      const result = setConfigValue(workspace, 'logging.level', 'warn');

      expect(result).toMatchObject({ success: true, previousValue: 'info', newValue: 'warn' });
      expect(readFileSync(workspaceJsonc(), 'utf8')).toBe(
        WORKSPACE_CONFIG.replace('"info"', '"warn"')
      );
    });

    it('refuses a set while the project folder holds both names, touching neither', () => {
      writeFileSync(projectJsonc(), PROJECT_CONFIG, 'utf8');
      writeFileSync(projectJson(), '{}\n', 'utf8');

      const result = setConfigValue(workspace, 'logging.level', 'warn');

      expect(result.success).toBe(false);
      expect(readFileSync(projectJsonc(), 'utf8')).toBe(PROJECT_CONFIG);
      expect(readFileSync(projectJson(), 'utf8')).toBe('{}\n');
    });

    it('refuses a reset while the project folder holds both names, writing nothing', () => {
      writeFileSync(projectJsonc(), PROJECT_CONFIG, 'utf8');
      writeFileSync(projectJson(), '{}\n', 'utf8');

      const result = resetConfig(workspace);

      expect(result.success).toBe(false);
      expect(result.message).toContain(projectJsonc());
      expect(result.message).toContain(projectJson());
      expect(readFileSync(projectJsonc(), 'utf8')).toBe(PROJECT_CONFIG);
      expect(readFileSync(projectJson(), 'utf8')).toBe('{}\n');
    });

    it('names the project config.jsonc as the file a create would write when none exists anywhere', () => {
      rmSync(workspaceJsonc());

      expect(resolveConfigPath(workspace)).toBe(projectJsonc());

      // Control: no project folder, so the workspace is where a create belongs, as it always was.
      removeProjectFolder();
      expect(resolveConfigPath(workspace)).toBe(workspaceJsonc());
    });

    it('creates the project config on reset when none exists and the project folder does', () => {
      rmSync(workspaceJsonc());

      const result = resetConfig(workspace);

      expect(result).toMatchObject({ success: true, configPath: projectJsonc() });
      expect(readFileSync(projectJsonc(), 'utf8')).toBe(CONFIG_JSONC_TEMPLATE);
      expect(existsSync(workspaceJsonc())).toBe(false);
    });

    it('creates the workspace config on reset when there is no project folder (control)', () => {
      rmSync(workspaceJsonc());
      removeProjectFolder();

      const result = resetConfig(workspace);

      expect(result).toMatchObject({ success: true, configPath: workspaceJsonc() });
      expect(existsSync(projectJsonc())).toBe(false);
    });

    it('resets the project config under its own name and leaves the workspace config alone', () => {
      writeFileSync(projectJson(), '{ "gates": { "enabled": false } }\n', 'utf8');

      const result = resetConfig(workspace);

      expect(result).toMatchObject({ success: true, configPath: projectJson() });
      expect(existsSync(projectJsonc())).toBe(false);
      expect(readFileSync(workspaceJsonc(), 'utf8')).toBe(WORKSPACE_CONFIG);
    });
  });

  describe('the version-history scope', () => {
    const SCOPED = (id: string): string =>
      `{ "identity": { "launchDefaults": { "workspaceId": "${id}" } } }\n`;

    it('reads the workspace id from the project config before the workspace config', () => {
      writeFileSync(workspaceJsonc(), SCOPED('workspace-scope'), 'utf8');
      writeFileSync(projectJsonc(), SCOPED('project-scope'), 'utf8');
      const dbPath = join(workspace, 'runtime-state', 'state.db');

      expect(resolveTenantId(dbPath)).toBe('project-scope');
    });

    it('reads the workspace id from the workspace config when the project folder is gone (control)', () => {
      writeFileSync(workspaceJsonc(), SCOPED('workspace-scope'), 'utf8');
      writeFileSync(projectJsonc(), SCOPED('project-scope'), 'utf8');
      removeProjectFolder();
      const dbPath = join(workspace, 'runtime-state', 'state.db');

      expect(resolveTenantId(dbPath)).toBe('workspace-scope');
    });
  });
});
