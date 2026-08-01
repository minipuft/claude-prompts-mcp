import { compareVersions } from '@cli-shared/index.js';
import { resolveWorkspace, findResource } from '../lib/workspace.js';
import { output } from '../lib/output.js';
import { TYPE_MAP, singularName } from '../lib/types.js';

interface CompareOptions {
  workspace?: string;
  json: boolean;
  type?: string;
  id?: string;
  from?: string;
  to?: string;
}

export async function compare(options: CompareOptions): Promise<number> {
  const type = options.type ? TYPE_MAP[options.type] : undefined;

  if (!type) {
    console.error(
      `Usage: cpm compare <prompt|gate|framework|style> <id> <from> <to>\n` +
        (options.type ? `Unknown type: ${options.type}` : 'Resource type is required.'),
    );
    return 1;
  }

  if (!options.id || !options.from || !options.to) {
    console.error(
      'Usage: cpm compare <prompt|gate|framework|style> <id> <from> <to>\nResource ID and both version numbers are required.',
    );
    return 1;
  }

  const fromVersion = parseInt(options.from, 10);
  const toVersion = parseInt(options.to, 10);

  if (isNaN(fromVersion) || isNaN(toVersion) || fromVersion < 1 || toVersion < 1) {
    console.error('Version numbers must be positive integers.');
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type, options.id);

  if (!match) {
    console.error(`${singularName(type)} '${options.id}' not found.`);
    return 1;
  }

  const result = compareVersions(match.dir, fromVersion, toVersion);

  if (!result.success) {
    console.error(result.error ?? 'Comparison failed.');
    return 1;
  }

  if (options.json) {
    output({ from: result.from, to: result.to }, { json: true });
    return 0;
  }

  // Human-readable diff
  const fromSnap = result.from!.snapshot;
  const toSnap = result.to!.snapshot;
  const allKeys = new Set([...Object.keys(fromSnap), ...Object.keys(toSnap)]);

  const lines: string[] = [];
  lines.push(`Version ${fromVersion} -> Version ${toVersion}`);
  lines.push('');

  for (const key of [...allKeys].sort()) {
    const fromVal = JSON.stringify(fromSnap[key]);
    const toVal = JSON.stringify(toSnap[key]);

    if (fromVal === undefined && toVal !== undefined) {
      lines.push(`+ ${key}: ${toVal}`);
    } else if (fromVal !== undefined && toVal === undefined) {
      lines.push(`- ${key}: ${fromVal}`);
    } else if (fromVal !== toVal) {
      lines.push(`  ${key}: ${fromVal}  ->  ${toVal}`);
    }
  }

  if (lines.length === 2) {
    lines.push('  (no differences)');
  }

  console.log(lines.join('\n'));
  return 0;
}
