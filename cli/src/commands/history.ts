import { loadHistory, formatHistoryTable } from '@cli-shared/index.js';
import { resolveWorkspace, findResource } from '../lib/workspace.js';
import { output } from '../lib/output.js';
import { TYPE_MAP, singularName } from '../lib/types.js';

interface HistoryOptions {
  workspace?: string;
  json: boolean;
  type?: string;
  id?: string;
  limit?: string;
}

export async function history(options: HistoryOptions): Promise<number> {
  const type = options.type ? TYPE_MAP[options.type] : undefined;

  if (!type) {
    console.error(
      `Usage: cpm history <prompt|gate|framework|style> <id>\n` +
        (options.type ? `Unknown type: ${options.type}` : 'Resource type is required.'),
    );
    return 1;
  }

  if (!options.id) {
    console.error('Usage: cpm history <prompt|gate|framework|style> <id>\nResource ID is required.');
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type, options.id);

  if (!match) {
    console.error(`${singularName(type)} '${options.id}' not found.`);
    return 1;
  }

  const historyData = loadHistory(match.dir);

  if (historyData === null || historyData.versions.length === 0) {
    if (options.json) {
      output({ id: options.id, versions: [] }, { json: true });
    } else {
      console.log(`No version history for ${singularName(type)} '${options.id}'.`);
    }
    return 0;
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 10;

  if (options.json) {
    output(historyData, { json: true });
  } else {
    console.log(formatHistoryTable(historyData, limit));
  }
  return 0;
}
