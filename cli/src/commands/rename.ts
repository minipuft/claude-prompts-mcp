import { renameResource, runValidatedMutation } from '@cli-shared/index.js';
import { resolveWorkspace, findResource, scanReferences } from '../lib/workspace.js';
import { output, icons, color } from '../lib/output.js';
import { TYPE_MAP, TYPE_CONFIG, singularName } from '../lib/types.js';
import { printValidationFailure } from '../lib/resource-validation.js';

interface RenameOptions {
  workspace?: string;
  json: boolean;
  type?: string;
  oldId?: string;
  newId?: string;
  noValidate?: boolean;
}

export async function rename(options: RenameOptions): Promise<number> {
  const type = options.type ? TYPE_MAP[options.type] : undefined;

  if (!type) {
    console.error(
      `Usage: cpm rename <prompt|gate|framework|style> <old-id> <new-id>\n` +
        (options.type ? `Unknown type: ${options.type}` : 'Resource type is required.'),
    );
    return 1;
  }

  if (!options.oldId || !options.newId) {
    console.error(
      'Usage: cpm rename <prompt|gate|framework|style> <old-id> <new-id>\nBoth old and new IDs are required.',
    );
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type, options.oldId);

  if (!match) {
    console.error(`${singularName(type)} '${options.oldId}' not found.`);
    return 1;
  }

  // Check target doesn't already exist
  const existing = findResource(workspace, type, options.newId);
  if (existing) {
    console.error(`${singularName(type)} '${options.newId}' already exists.`);
    return 1;
  }

  const config = TYPE_CONFIG[type];
  const mutation = runValidatedMutation({
    resourceType: type,
    resourceId: options.oldId,
    resourceDir: match.dir,
    entryFile: config.entryFile,
    validate: !options.noValidate,
    mutate: () => renameResource(match.dir, config.entryFile, options.oldId!, options.newId!),
  });

  if (!mutation.success) {
    if (mutation.validation) {
      printValidationFailure(mutation.validation, {
        json: options.json,
        action: `rename ${singularName(type)} '${options.oldId}'`,
        rolledBack: mutation.rolledBack,
      });
      return 1;
    }
    console.error(mutation.error ?? mutation.operation.error ?? 'Rename failed.');
    return 1;
  }
  const result = mutation.operation;

  const refs = scanReferences(workspace, options.oldId!);

  if (options.json) {
    output({ id: options.newId, oldId: options.oldId, type: singularName(type), oldDir: result.oldDir, newDir: result.newDir, references: refs }, { json: true });
  } else {
    console.log(`Renamed ${singularName(type)} '${options.oldId}' -> '${options.newId}'`);
    if (refs.length > 0) {
      console.error(`\n${icons.warn()} References to '${options.oldId}' found (${refs.length}):`);
      for (const ref of refs) {
        console.error(`  ${ref.file}:${ref.line}  ${color(ref.content, 'dim')}`);
      }
    }
  }
  return 0;
}
