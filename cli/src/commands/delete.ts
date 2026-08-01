import { deleteResourceDir } from '@cli-shared/index.js';
import { resolveWorkspace, findResource, scanReferences } from '../lib/workspace.js';
import { output, icons, color } from '../lib/output.js';
import { TYPE_MAP, singularName } from '../lib/types.js';

interface DeleteOptions {
  workspace?: string;
  json: boolean;
  type?: string;
  id?: string;
  force: boolean;
}

export async function del(options: DeleteOptions): Promise<number> {
  const type = options.type ? TYPE_MAP[options.type] : undefined;

  if (!type) {
    console.error(
      `Usage: cpm delete <prompt|gate|framework|style> <id> --force\n` +
        (options.type ? `Unknown type: ${options.type}` : 'Resource type is required.'),
    );
    return 1;
  }

  if (!options.id) {
    console.error('Usage: cpm delete <prompt|gate|framework|style> <id> --force\nResource ID is required.');
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type, options.id);

  if (!match) {
    const msg = `${singularName(type)} '${options.id}' not found.`;
    if (options.json) {
      output({ error: msg }, { json: true });
    } else {
      console.error(msg);
    }
    return 1;
  }

  if (!options.force) {
    const msg = `Would delete ${singularName(type)} '${options.id}' at ${match.dir}\nUse --force (-f) to confirm deletion.`;
    if (options.json) {
      output({ error: 'Deletion requires --force flag', path: match.dir }, { json: true });
    } else {
      console.error(msg);
    }
    return 1;
  }

  const result = deleteResourceDir(match.dir);

  if (!result.success) {
    const msg = result.error ?? 'Unknown error';
    if (options.json) {
      output({ error: msg }, { json: true });
    } else {
      console.error(`Failed to delete: ${msg}`);
    }
    return 1;
  }

  const refs = scanReferences(workspace, options.id);

  if (options.json) {
    output({ id: options.id, type: singularName(type), deleted: true, danglingReferences: refs }, { json: true });
  } else {
    console.log(`Deleted ${singularName(type)} '${options.id}'`);
    if (refs.length > 0) {
      console.error(`\n${icons.warn()} Dangling references to '${options.id}' (${refs.length}):`);
      for (const ref of refs) {
        console.error(`  ${ref.file}:${ref.line}  ${color(ref.content, 'dim')}`);
      }
    }
  }
  return 0;
}
