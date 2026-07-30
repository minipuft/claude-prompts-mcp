import { join } from 'node:path';
import { loadYamlFileSync } from '@cli-shared/index.js';
import { resolveWorkspace, resolveResourceDir, discoverResourcePaths } from '../lib/workspace.js';
import { output } from '../lib/output.js';
import { TYPE_MAP, TYPE_CONFIG } from '../lib/types.js';

interface ListOptions {
  workspace?: string;
  json: boolean;
  type?: string;
}

export async function list(options: ListOptions): Promise<number> {
  const type = options.type ? TYPE_MAP[options.type] : undefined;

  if (!type) {
    console.error(
      `Usage: cpm list <prompts|gates|frameworks|styles>\n` +
        (options.type ? `Unknown type: ${options.type}` : 'Resource type is required.'),
    );
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);

  let baseDir: string;
  try {
    baseDir = resolveResourceDir(workspace, type);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const config = TYPE_CONFIG[type];
  const resources = discoverResourcePaths(baseDir, config.entryFile, config.nested);

  const items: Record<string, unknown>[] = [];

  for (const { id, dir } of resources) {
    const filePath = join(dir, config.entryFile);
    const data = loadYamlFileSync<Record<string, unknown>>(filePath);

    items.push({
      id,
      name: data?.['name'] ?? id,
      ...(type === 'prompts' ? { category: data?.['category'] ?? '' } : {}),
      description: truncate(String(data?.['description'] ?? ''), 60),
    });
  }

  if (items.length === 0) {
    if (options.json) {
      output([], { json: true });
    } else {
      console.log(`No ${type} found.`);
    }
    return 0;
  }

  output(items, { json: options.json });
  return 0;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}
