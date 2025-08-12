/**
 * Workflow Management Tools
 * Provides MCP tools for workflow execution and management
 */

import { Logger } from "../logging/index.js";
import { WorkflowEngine } from "../orchestration/workflow-engine.js";
import { PromptExecutor } from "../orchestration/prompt-executor.js";
import { ToolResponse } from "../types/index.js";
import { handleError } from "../utils/errorHandling.js";

/**
 * Workflow management tools for MCP
 */
export class WorkflowManagementTools {
  private logger: Logger;
  private workflowEngine: WorkflowEngine;
  private promptExecutor: PromptExecutor;

  constructor(
    logger: Logger,
    workflowEngine: WorkflowEngine,
    promptExecutor: PromptExecutor
  ) {
    this.logger = logger;
    this.workflowEngine = workflowEngine;
    this.promptExecutor = promptExecutor;
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(args: {
    workflowId: string;
    inputs?: Record<string, any>;
    options?: {
      stepConfirmation?: boolean;
      gateValidation?: boolean;
      timeout?: number;
    };
  }): Promise<ToolResponse> {
    try {
      this.logger.info(`Executing workflow: ${args.workflowId}`);
      
      const result = await this.promptExecutor.executeWorkflow(
        args.workflowId,
        args.inputs || {}
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              workflowId: result.workflowId,
              executionId: result.executionId,
              status: result.status,
              duration: result.endTime - result.startTime,
              stepResults: Object.keys(result.stepResults).length,
              finalResult: result.finalResult,
              error: result.error
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      const { message } = handleError(error, 'executeWorkflow', this.logger);
      return {
        content: [
          {
            type: "text",
            text: `Error executing workflow: ${message}`
          }
        ],
        isError: true
      };
    }
  }

  /**
   * List available workflows
   */
  async listWorkflows(): Promise<ToolResponse> {
    try {
      const workflows = this.workflowEngine.listWorkflows();
      
      const workflowSummaries = workflows.map(workflow => ({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        stepCount: workflow.steps.length,
        hasGates: !!(workflow.gates && workflow.gates.length > 0),
        runtimeTargets: workflow.metadata.runtime,
        tags: workflow.metadata.tags
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              totalWorkflows: workflows.length,
              workflows: workflowSummaries
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      const { message } = handleError(error, 'listWorkflows', this.logger);
      return {
        content: [
          {
            type: "text",
            text: `Error listing workflows: ${message}`
          }
        ],
        isError: true
      };
    }
  }

  /**
   * Get workflow details
   */
  async getWorkflowDetails(args: { workflowId: string }): Promise<ToolResponse> {
    try {
      const workflow = this.workflowEngine.getWorkflow(args.workflowId);
      
      if (!workflow) {
        return {
          content: [
            {
              type: "text",
              text: `Workflow not found: ${args.workflowId}`
            }
          ],
          isError: true
        };
      }

      const workflowDetails = {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        metadata: workflow.metadata,
        steps: workflow.steps.map(step => ({
          id: step.id,
          name: step.name,
          type: step.type,
          dependencies: step.dependencies,
          timeout: step.timeout,
          retries: step.retries,
          config: step.config
        })),
        dependencyGraph: workflow.dependencies,
        retryPolicy: workflow.retryPolicy,
        gates: workflow.gates?.map(gate => ({
          id: gate.id,
          type: gate.type,
          appliesTo: gate.appliesTo,
          requirements: gate.requirements.length,
          failureAction: gate.failureAction
        })) || []
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(workflowDetails, null, 2)
          }
        ]
      };
    } catch (error) {
      const { message } = handleError(error, 'getWorkflowDetails', this.logger);
      return {
        content: [
          {
            type: "text",
            text: `Error getting workflow details: ${message}`
          }
        ],
        isError: true
      };
    }
  }

  /**
   * Get workflow execution status
   */
  async getWorkflowStatus(): Promise<ToolResponse> {
    try {
      const activeExecutions = this.workflowEngine.getActiveExecutions();
      const executorStats = this.promptExecutor.getExecutorStats();
      
      const status = {
        activeExecutions: activeExecutions.length,
        executionIds: activeExecutions,
        workflowsRegistered: executorStats.workflowsAvailable,
        totalPrompts: executorStats.totalPrompts,
        conversationStats: executorStats.conversationStats
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2)
          }
        ]
      };
    } catch (error) {
      const { message } = handleError(error, 'getWorkflowStatus', this.logger);
      return {
        content: [
          {
            type: "text",
            text: `Error getting workflow status: ${message}`
          }
        ],
        isError: true
      };
    }
  }

  /**
   * Validate a workflow definition
   */
  async validateWorkflow(args: { workflowId: string }): Promise<ToolResponse> {
    try {
      const workflow = this.workflowEngine.getWorkflow(args.workflowId);
      
      if (!workflow) {
        return {
          content: [
            {
              type: "text",
              text: `Workflow not found: ${args.workflowId}`
            }
          ],
          isError: true
        };
      }

      // Re-validate the workflow (this will check for any issues)
      const validationResult = await (this.workflowEngine as any).validateWorkflow(workflow);
      
      const result = {
        workflowId: args.workflowId,
        valid: validationResult.valid,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
        dependencyValidation: validationResult.dependencyValidation
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      const { message } = handleError(error, 'validateWorkflow', this.logger);
      return {
        content: [
          {
            type: "text",
            text: `Error validating workflow: ${message}`
          }
        ],
        isError: true
      };
    }
  }
}

/**
 * Create workflow management tools
 */
export function createWorkflowManagementTools(
  logger: Logger,
  workflowEngine: WorkflowEngine,
  promptExecutor: PromptExecutor
): WorkflowManagementTools {
  return new WorkflowManagementTools(logger, workflowEngine, promptExecutor);
}