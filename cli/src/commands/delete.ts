import { resourceRoot } from '@cli-shared/resource-operations.js';
import { deleteResource } from '@cli-shared/resource-scaffold.js';
import { resolveWorkspace, findResource, scanReferences } from '../lib/workspace.js';
import { output, icons, color } from '../lib/output.js';
import { TYPE_MAP, historyRef, singularName } from '../lib/types.js';

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

  // What goes: the prompt's own directory, or — for a single-file prompt — that file alone. Never
  // the directory around a single file, which is a category or a chain holding other prompts.
  const target = resourceRoot(match);

  if (!options.force) {
    const msg = `Would delete ${singularName(type)} '${options.id}' at ${target}\nUse --force (-f) to confirm deletion.`;
    if (options.json) {
      output({ error: 'Deletion requires --force flag', path: target }, { json: true });
    } else {
      console.error(msg);
    }
    return 1;
  }

  const result = deleteResource(match, historyRef(type, match.id));

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
