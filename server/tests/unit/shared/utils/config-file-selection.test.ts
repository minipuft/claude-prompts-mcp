// @lifecycle canonical - Unit tests for the one function that picks the config file out of six candidates.
/**
 * Config File Selection
 *
 * `selectConfigFile` is steps 1-5 of the six-step order (owner ruling R1) that `PathResolver`,
 * `cpm config`, the version-history scope and the startup probe all take their answer from; the
 * sixth, the packaged file, is `PathResolver`'s own (pinned by `project-config-order.test.ts`).
 * Each case deletes or adds exactly one candidate so a step that stops being consulted changes the
 * answer, and the walk-down case removes the winner one at a time so the order is asserted as a
 * whole sequence, not as the handful of pairs somebody thought of.
 *
 * Classification: Unit (temp directories only).
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  PROJECT_WORKSPACE_DIR_NAME,
  findProjectWorkspace,
  selectConfigFile,
  selectLaunchConfigFile,
} from '../../../../src/shared/utils/config-file-selection.js';

describe('config file selection', () => {
  let root: string;
  let workspace: string;
  let project: string;
  let projectWorkspace: string;
  let explicit: string;

  const projectJsonc = (): string => join(projectWorkspace, 'config.jsonc');
  const projectJson = (): string => join(projectWorkspace, 'config.json');
  const workspaceJsonc = (): string => join(workspace, 'config.jsonc');
  const workspaceJson = (): string => join(workspace, 'config.json');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'config-file-selection-'));
    workspace = join(root, 'workspace');
    project = join(root, 'project');
    projectWorkspace = join(project, PROJECT_WORKSPACE_DIR_NAME);
    explicit = join(root, 'explicit.json');
    for (const dir of [workspace, projectWorkspace]) {
      mkdirSync(dir, { recursive: true });
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('selectConfigFile', () => {
    it('walks the five steps in order as each winner is removed', () => {
      for (const file of [
        explicit,
        projectJsonc(),
        projectJson(),
        workspaceJsonc(),
        workspaceJson(),
      ]) {
        writeFileSync(file, '{}');
      }
      const sources = { explicit, projectWorkspace, workspace };

      const winners: [string, string][] = [];
      for (const removed of [
        undefined,
        explicit,
        projectJsonc(),
        projectJson(),
        workspaceJsonc(),
        workspaceJson(),
      ]) {
        if (removed === explicit) {
          sources.explicit = '';
        } else if (removed !== undefined) {
          rmSync(removed);
        }
        const chosen = selectConfigFile(sources);
        winners.push([chosen?.origin ?? 'none', chosen?.path ?? 'none']);
      }

      expect(winners).toEqual([
        ['explicit', explicit],
        ['project', projectJsonc()],
        ['project', projectJson()],
        ['workspace', workspaceJsonc()],
        ['workspace', workspaceJson()],
        ['none', 'none'],
      ]);
    });

    it('returns an explicit path as given, without asking whether it exists', () => {
      expect(selectConfigFile({ explicit, projectWorkspace, workspace })).toEqual({
        path: explicit,
        origin: 'explicit',
      });
    });

    it('treats an empty explicit path as unset', () => {
      writeFileSync(projectJsonc(), '{}');

      expect(selectConfigFile({ explicit: '', projectWorkspace, workspace })).toEqual({
        path: projectJsonc(),
        origin: 'project',
      });
    });

    it('prefers a project config to a workspace config, and says so only because the project has one', () => {
      writeFileSync(workspaceJsonc(), '{}');

      // Control: the project folder exists but holds no config, so the workspace answers.
      expect(selectConfigFile({ projectWorkspace, workspace })?.origin).toBe('workspace');

      writeFileSync(projectJson(), '{}');
      expect(selectConfigFile({ projectWorkspace, workspace })).toEqual({
        path: projectJson(),
        origin: 'project',
      });
    });

    it('reads a project config.json only when the project holds no config.jsonc', () => {
      writeFileSync(projectJson(), '{}');
      expect(selectConfigFile({ projectWorkspace })?.path).toBe(projectJson());

      writeFileSync(projectJsonc(), '{}');
      expect(selectConfigFile({ projectWorkspace })?.path).toBe(projectJsonc());
    });

    it('returns nothing when no candidate exists, leaving the packaged file to the server', () => {
      expect(
        selectConfigFile({ explicit: undefined, projectWorkspace, workspace })
      ).toBeUndefined();
      expect(selectConfigFile({})).toBeUndefined();
    });
  });

  describe('findProjectWorkspace', () => {
    it('finds .claude-prompts under CLAUDE_PROJECT_DIR before the working directory', () => {
      const elsewhere = join(root, 'elsewhere');
      mkdirSync(join(elsewhere, PROJECT_WORKSPACE_DIR_NAME), { recursive: true });

      expect(findProjectWorkspace({ env: { CLAUDE_PROJECT_DIR: project }, cwd: elsewhere })).toBe(
        projectWorkspace
      );
      expect(findProjectWorkspace({ env: {}, cwd: elsewhere })).toBe(
        join(elsewhere, PROJECT_WORKSPACE_DIR_NAME)
      );
    });

    it('finds nothing when the project has no .claude-prompts directory', () => {
      const bare = join(root, 'bare');
      mkdirSync(bare);

      expect(
        findProjectWorkspace({ env: { CLAUDE_PROJECT_DIR: bare }, cwd: bare })
      ).toBeUndefined();
    });

    it('does not take a file named .claude-prompts for the directory', () => {
      const odd = join(root, 'odd');
      mkdirSync(odd);
      writeFileSync(join(odd, PROJECT_WORKSPACE_DIR_NAME), 'not a directory');

      expect(findProjectWorkspace({ env: { CLAUDE_PROJECT_DIR: odd }, cwd: odd })).toBeUndefined();
    });
  });

  describe('selectLaunchConfigFile', () => {
    it('applies the server order to a process that has only an environment and a workspace', () => {
      writeFileSync(workspaceJsonc(), '{}');
      writeFileSync(projectJsonc(), '{}');
      const env = { CLAUDE_PROJECT_DIR: project };

      expect(selectLaunchConfigFile(workspace, { env, cwd: root })).toEqual({
        path: projectJsonc(),
        origin: 'project',
      });

      // MCP_CONFIG_PATH outranks both, resolved like the server resolves it.
      expect(
        selectLaunchConfigFile(workspace, { env: { ...env, MCP_CONFIG_PATH: explicit }, cwd: root })
      ).toEqual({ path: explicit, origin: 'explicit' });
      expect(
        selectLaunchConfigFile(workspace, {
          env: { ...env, MCP_CONFIG_PATH: 'relative.json' },
          cwd: root,
        })?.path
      ).toBe(resolve(process.cwd(), 'relative.json'));
    });

    it('reads the workspace when the launch has no project folder (the control)', () => {
      writeFileSync(workspaceJsonc(), '{}');
      const bare = join(root, 'bare');
      mkdirSync(bare);

      expect(selectLaunchConfigFile(workspace, { env: {}, cwd: bare })).toEqual({
        path: workspaceJsonc(),
        origin: 'workspace',
      });
    });
  });
});
