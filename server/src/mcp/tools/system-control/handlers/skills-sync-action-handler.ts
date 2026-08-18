// @lifecycle canonical - Handler for skills-sync operations exposed through system_control.
import {
  createConsolidatedSkillsSync,
  SKILLS_SYNC_OPERATIONS,
  type SkillsSyncOperation,
} from '../../skills-sync.js';
import { ActionHandler } from '../core/action-handler-base.js';

import type { ResourceType } from '#modules/skills-sync/service.js';
import type { ToolResponse } from '#shared/types/index.js';

/**
 * Arguments this action reads off the `system_control` envelope.
 *
 * Declared rather than taking the sibling handlers' `args: any`: every field
 * below is forwarded verbatim to the service, so an untyped bag here would put
 * the only unchecked hop on the path that writes files.
 */
interface SkillsSyncActionArgs {
  operation?: string;
  client?: string;
  scope?: 'user' | 'project';
  resource_type?: ResourceType;
  id?: string;
  prune?: boolean;
  dry_run?: boolean;
  output?: string;
  file?: string;
  category?: string;
  preview?: boolean;
  force?: boolean;
}

function isSkillsSyncOperation(value: string): value is SkillsSyncOperation {
  return (SKILLS_SYNC_OPERATIONS as readonly string[]).includes(value);
}

/**
 * Routes `system_control action="skills_sync"` to the skills-sync service.
 *
 * Folded in here rather than shipped as a fourth MCP tool: an exported skill is a
 * projection of a prompt, not a resource type of its own, and a fourth tool
 * permanently widens the surface a major version protects (plan ruling Q3).
 *
 * Thin by design. It owns argument shaping and nothing else -- the operations
 * live in `ConsolidatedSkillsSync`, and `clone` reaches canonical resources
 * through the lifecycle processors rather than writing them here.
 */
export class SkillsSyncActionHandler extends ActionHandler {
  async execute(args: SkillsSyncActionArgs): Promise<ToolResponse> {
    const operation = args.operation ?? 'status';

    if (!isSkillsSyncOperation(operation)) {
      throw new Error(
        `Unknown skills_sync operation: ${operation}. ` +
          `Valid operations: ${SKILLS_SYNC_OPERATIONS.join(', ')}`
      );
    }

    // The database is what makes manifests persist. Without it export still
    // writes skills but drops every manifest row, leaving diff and prune blind --
    // the state this subsystem sat in for as long as it went unregistered.
    const skillsSync = createConsolidatedSkillsSync(this.logger, this.context.databasePort);

    return await skillsSync.handleAction({
      operation,
      client: args.client,
      scope: args.scope,
      resource_type: args.resource_type,
      id: args.id,
      prune: args.prune,
      dry_run: args.dry_run,
      output: args.output,
      file: args.file,
      category: args.category,
      preview: args.preview,
      force: args.force,
    });
  }
}
