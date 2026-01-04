/**
 * Resource Manager Router
 *
 * Routes resource_manager requests to the appropriate handler
 * based on the resource_type parameter.
 */
import type { ResourceManagerInput, ResourceManagerDependencies } from './types.js';
import type { ToolResponse } from '../../../types/index.js';
/**
 * ResourceManagerRouter routes requests to the appropriate handler
 */
export declare class ResourceManagerRouter {
    private readonly logger;
    private readonly promptManager;
    private readonly gateManager;
    private readonly frameworkManager;
    constructor(deps: ResourceManagerDependencies);
    /**
     * Handle a resource_manager request
     */
    handleAction(args: ResourceManagerInput, context: Record<string, unknown>): Promise<ToolResponse>;
    /**
     * Validate that an action is valid for a resource type
     */
    private validateActionForResourceType;
    /**
     * Route to prompt manager
     */
    private routeToPromptManager;
    /**
     * Route to gate manager
     */
    private routeToGateManager;
    /**
     * Route to framework manager
     */
    private routeToFrameworkManager;
    /**
     * Create an error response
     */
    private createErrorResponse;
}
/**
 * Create a ResourceManagerRouter instance
 */
export declare function createResourceManagerRouter(deps: ResourceManagerDependencies): ResourceManagerRouter;
