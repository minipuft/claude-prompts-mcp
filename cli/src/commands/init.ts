import { rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { initWorkspace, initConfig, validateResourceFile } from '@cli-shared/index.js';
import { declaredResourceId } from '@cli-shared/resource-operations.js';

import { output } from '../lib/output.js';
import { discoverResourcePaths, resolveResourceDir } from '../lib/workspace.js';
import { printValidationFailure } from '../lib/resource-validation.js';

interface InitOptions {
  path?: string;
  json: boolean;
  noValidate?: boolean;
  project?: boolean;
}

/** Directory name the server looks for in the project (STDIO); fixed by convention. */
const PROJECT_WORKSPACE_DIR = '.claude-prompts';

export async function init(options: InitOptions): Promise<number> {
  if (options.project && options.path !== undefined) {
    console.error(
      `--project scaffolds ./${PROJECT_WORKSPACE_DIR} and takes no path; use 'cpm init ${options.path}' for a custom location`,
    );
    return 1;
  }
  const targetPath = options.project
    ? join(process.cwd(), PROJECT_WORKSPACE_DIR)
    : (options.path ?? '.');
  const result = initWorkspace(targetPath);

  if (result.success && !options.noValidate) {
    const workspacePath = resolve(targetPath);
    const promptsDir = resolveResourceDir(workspacePath, 'prompts');
    const promptEntries = discoverResourcePaths(promptsDir, 'prompt.yaml', true);
    for (const prompt of promptEntries) {
      const validation = validateResourceFile(
        'prompts',
        declaredResourceId(prompt),
        prompt.file,
      );
      if (!validation.valid) {
        rmSync(join(workspacePath, 'resources'), { recursive: true, force: true });
        printValidationFailure(validation, {
          json: options.json,
          action: `init workspace '${workspacePath}'`,
          rolledBack: true,
        });
        return 1;
      }
    }
  }

  // Generate the workspace config alongside resources
  let configCreated = false;
  let configPath: string | undefined;
  if (result.success) {
    const configResult = initConfig(targetPath);
    configCreated = configResult.created;
    configPath = configResult.configPath;
    if (!configResult.success) {
      console.error(`Warning: ${configResult.message}`);
    }
  }

  if (options.json) {
    output({ ...result, configCreated }, { json: true });
  } else {
    console.log(result.message);
    if (configCreated && configPath) {
      console.log(`Created ${basename(configPath)} with default settings`);
    }
    if (options.project && result.success) {
      console.log(
        `Resources placed in ${PROJECT_WORKSPACE_DIR}/ load above the user workspace and the bundled ones whenever the server runs in this project (STDIO).`,
      );
    }
  }

  return result.success ? 0 : 1;
}
