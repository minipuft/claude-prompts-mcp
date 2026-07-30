import { join } from 'node:path';
import { loadYamlFileSync } from '@cli-shared/index.js';
import { resolveWorkspace, resolveResourceDir, discoverResourcePaths } from '../lib/workspace.js';
import { output } from '../lib/output.js';
import { TYPE_MAP, TYPE_CONFIG } from '../lib/types.js';

interface InspectOptions {
  workspace?: string;
  json: boolean;
  type?: string;
  id?: string;
}

export async function inspect(options: InspectOptions): Promise<number> {
  const resolvedType = options.type ? TYPE_MAP[options.type] : undefined;

  if (!resolvedType) {
    console.error(
      `Usage: cpm inspect <prompt|gate|framework|style> <id>\n` +
        (options.type ? `Unknown type: ${options.type}` : 'Resource type is required.'),
    );
    return 1;
  }

  if (!options.id) {
    console.error('Usage: cpm inspect <prompt|gate|framework|style> <id>\nResource ID is required.');
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);

  let baseDir: string;
  try {
    baseDir = resolveResourceDir(workspace, resolvedType);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const config = TYPE_CONFIG[resolvedType];
  const resources = discoverResourcePaths(baseDir, config.entryFile, config.nested);

  const match = resources.find((r) => r.id === options.id);

  if (!match) {
    console.error(`${resolvedType.slice(0, -1)} '${options.id}' not found.`);
    return 1;
  }

  const filePath = join(match.dir, config.entryFile);
  const data = loadYamlFileSync<Record<string, unknown>>(filePath);

  if (!data) {
    console.error(`Failed to load: ${filePath}`);
    return 1;
  }

  output(data, { json: options.json });
  return 0;
}
