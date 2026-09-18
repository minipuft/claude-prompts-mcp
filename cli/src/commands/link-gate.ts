import { linkGate, runValidatedMutation } from '@cli-shared/index.js';
import { resolveWorkspace, findResource } from '../lib/workspace.js';
import { output } from '../lib/output.js';
import { printValidationFailure } from '../lib/resource-validation.js';

interface LinkGateOptions {
  workspace?: string;
  json: boolean;
  promptId?: string;
  gateId?: string;
  remove?: boolean;
  noValidate?: boolean;
}

export async function linkGateCmd(options: LinkGateOptions): Promise<number> {
  if (!options.promptId || !options.gateId) {
    console.error(
      'Usage: cpm link-gate <prompt-id> <gate-id> [--remove]\nBoth prompt ID and gate ID are required.',
    );
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);
  const promptMatch = findResource(workspace, 'prompts', options.promptId);

  if (!promptMatch) {
    console.error(`Prompt '${options.promptId}' not found.`);
    return 1;
  }

  // Validate gate exists on add (skip on remove — gate may already be deleted)
  if (!options.remove) {
    const gateMatch = findResource(workspace, 'gates', options.gateId);
    if (!gateMatch) {
      console.error(`Gate '${options.gateId}' not found.`);
      return 1;
    }
  }

  const mutation = runValidatedMutation({
    resourceType: 'prompts',
    location: promptMatch,
    validate: !options.noValidate,
    mutate: () => linkGate(promptMatch.file, options.gateId!, options.remove),
  });

  if (!mutation.success) {
    if (mutation.validation) {
      printValidationFailure(mutation.validation, {
        json: options.json,
        action: `${options.remove ? 'unlink' : 'link'} gate '${options.gateId}'`,
        rolledBack: mutation.rolledBack,
      });
      return 1;
    }
    console.error(mutation.error ?? mutation.operation.error ?? 'Link-gate failed.');
    return 1;
  }
  const result = mutation.operation;

  const verb = result.action === 'removed' ? 'Unlinked' : 'Linked';

  if (options.json) {
    output({ promptId: options.promptId, gateId: options.gateId, action: result.action, include: result.include }, { json: true });
  } else {
    console.log(`${verb} gate '${options.gateId}' ${result.action === 'removed' ? 'from' : 'to'} prompt '${options.promptId}'`);
  }
  return 0;
}
