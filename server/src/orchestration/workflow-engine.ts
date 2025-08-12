/**
 * Workflow Engine Module
 * Handles workflow execution, dependency resolution, and step orchestration
 */

import { Logger } from "../logging/index.js";
import { 
  Workflow, 
  WorkflowStep, 
  WorkflowExecutionContext, 
  WorkflowExecutionResult, 
  WorkflowExecutionPlan, 
  WorkflowValidationResult,
  DependencyGraph,
  RuntimeTarget,
  StepResult,
  WorkflowExecutionOptions,
  RetryPolicy,
  ErrorHandling,
  GateDefinition
} from "../types/index.js";
import { 
  PromptError, 
  ValidationError, 
  handleError as utilsHandleError 
} from "../utils/errorHandling.js";
import { GateEvaluator } from "../utils/gateValidation.js";
import { EnhancedGateEvaluator } from "../utils/enhanced-gate-evaluator.js";
import { PromptExecutor } from "./prompt-executor.js";

/**
 * Workflow execution engine
 */
export class WorkflowEngine {
  private logger: Logger;
  private workflows: Map<string, Workflow> = new Map();
  private activeExecutions: Map<string, WorkflowExecutionContext> = new Map();
  private promptExecutor?: PromptExecutor;
  private gateEvaluator?: GateEvaluator;
  private enhancedGateEvaluator?: EnhancedGateEvaluator;

  constructor(logger: Logger, promptExecutor?: PromptExecutor, gateEvaluator?: any) {
    this.logger = logger;
    this.promptExecutor = promptExecutor;
    
    // Support both legacy and enhanced gate evaluators
    if (gateEvaluator && 'getGateRegistry' in gateEvaluator) {
      this.enhancedGateEvaluator = gateEvaluator;
    } else {
      this.gateEvaluator = gateEvaluator;
    }
  }

  /**
   * Set the prompt executor for real prompt execution
   */
  setPromptExecutor(promptExecutor: PromptExecutor): void {
    this.promptExecutor = promptExecutor;
  }

  /**
   * Set the gate evaluator for real gate validation
   */
  setGateEvaluator(gateEvaluator: GateEvaluator): void {
    this.gateEvaluator = gateEvaluator;
  }

  /**
   * Register a workflow definition
   */
  async registerWorkflow(workflow: Workflow): Promise<void> {
    const validationResult = await this.validateWorkflow(workflow);
    if (!validationResult.valid) {
      throw new ValidationError(
        `Workflow validation failed: ${validationResult.errors.join(", ")}`
      );
    }

    this.workflows.set(workflow.id, workflow);
    this.logger.info(`Registered workflow: ${workflow.id} (${workflow.name})`);
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    inputs: Record<string, any>,
    options: WorkflowExecutionOptions = {},
    runtime: RuntimeTarget = 'server'
  ): Promise<WorkflowExecutionResult> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new PromptError(`Workflow not found: ${workflowId}`);
    }

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    // Create execution context
    const context: WorkflowExecutionContext = {
      workflow,
      inputs,
      stepResults: {},
      startTime,
      runtime,
      options
    };

    this.activeExecutions.set(executionId, context);

    try {
      this.logger.info(`Starting workflow execution: ${workflowId} (${executionId})`);
      
      // Create execution plan
      const plan = await this.createExecutionPlan(workflow);
      this.logger.debug(`Execution plan created for ${workflowId}:`, plan);

      // Execute steps according to plan
      const stepResults: Record<string, StepResult> = {};
      
      for (const stepId of plan.executionOrder) {
        const step = workflow.steps.find(s => s.id === stepId);
        if (!step) {
          throw new PromptError(`Step not found in workflow: ${stepId}`);
        }

        this.logger.info(`Executing step: ${stepId} (${step.name})`);
        
        try {
          const stepResult = await this.executeStep(step, context);
          stepResults[stepId] = stepResult;
          context.stepResults[stepId] = stepResult.content;
          
          this.logger.debug(`Step ${stepId} completed with status: ${stepResult.status}`);
        } catch (error) {
          const stepResult = await this.handleStepError(step, error, context);
          stepResults[stepId] = stepResult;
          
          if (stepResult.status === 'failed' && step.onError?.action === 'stop') {
            throw error;
          }
        }
      }

      const endTime = Date.now();
      const result: WorkflowExecutionResult = {
        workflowId,
        executionId,
        status: 'completed',
        startTime,
        endTime,
        stepResults,
        finalResult: this.aggregateResults(stepResults)
      };

      this.logger.info(`Workflow execution completed: ${workflowId} (${executionId})`);
      return result;

    } catch (error) {
      const endTime = Date.now();
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.logger.error(`Workflow execution failed: ${workflowId} (${executionId})`, error);
      
      return {
        workflowId,
        executionId,
        status: 'failed',
        startTime,
        endTime,
        stepResults: {},
        error: {
          message: errorMessage,
          code: error instanceof PromptError ? 'PROMPT_ERROR' : 'EXECUTION_ERROR'
        }
      };
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(
    step: WorkflowStep,
    context: WorkflowExecutionContext
  ): Promise<StepResult> {
    const stepStartTime = Date.now();
    
    try {
      // Check dependencies are satisfied
      for (const depId of step.dependencies) {
        if (!context.stepResults[depId]) {
          throw new PromptError(`Dependency not satisfied: ${depId} for step ${step.id}`);
        }
      }

      // Execute step based on type
      let content: string;
      switch (step.type) {
        case 'prompt':
          content = await this.executePromptStep(step, context);
          break;
        case 'tool':
          content = await this.executeToolStep(step, context);
          break;
        case 'gate':
          content = await this.executeGateStep(step, context);
          break;
        case 'condition':
          content = await this.executeConditionStep(step, context);
          break;
        case 'parallel':
          content = await this.executeParallelStep(step, context);
          break;
        default:
          throw new PromptError(`Unknown step type: ${step.type}`);
      }

      return {
        content,
        status: 'completed',
        timestamp: Date.now(),
        metadata: {
          executionTime: Date.now() - stepStartTime,
          stepType: step.type
        }
      };

    } catch (error) {
      this.logger.error(`Step execution failed: ${step.id}`, error);
      throw error;
    }
  }

  /**
   * Execute a prompt step
   */
  private async executePromptStep(
    step: WorkflowStep,
    context: WorkflowExecutionContext
  ): Promise<string> {
    const promptId = step.config.promptId;
    if (!promptId) {
      throw new PromptError(`Prompt ID not specified for step: ${step.id}`);
    }

    if (!this.promptExecutor) {
      // Fallback to placeholder if no prompt executor available
      return `Executed prompt: ${promptId} with inputs: ${JSON.stringify(context.inputs)}`;
    }

    // Build prompt arguments from context inputs and step results
    const promptArgs = this.buildPromptArgs(step, context);
    
    try {
      const result = await this.promptExecutor.runPromptDirectly(promptId, promptArgs);
      this.logger.debug(`Prompt step ${step.id} executed successfully`);
      return result;
    } catch (error) {
      this.logger.error(`Prompt step ${step.id} failed:`, error);
      throw error;
    }
  }

  /**
   * Build prompt arguments from workflow context
   */
  private buildPromptArgs(
    step: WorkflowStep,
    context: WorkflowExecutionContext
  ): Record<string, string> {
    const args: Record<string, string> = {};
    
    // Add workflow inputs
    for (const [key, value] of Object.entries(context.inputs)) {
      args[key] = String(value);
    }
    
    // Add step results from dependencies
    for (const depId of step.dependencies) {
      const depResult = context.stepResults[depId];
      if (depResult) {
        args[`${depId}_result`] = String(depResult);
      }
    }
    
    // Add step-specific parameters
    if (step.config.parameters) {
      for (const [key, value] of Object.entries(step.config.parameters)) {
        args[key] = String(value);
      }
    }
    
    return args;
  }

  /**
   * Execute a tool step
   */
  private async executeToolStep(
    step: WorkflowStep,
    context: WorkflowExecutionContext
  ): Promise<string> {
    const toolName = step.config.toolName;
    if (!toolName) {
      throw new PromptError(`Tool name not specified for step: ${step.id}`);
    }

    // TODO: Integrate with existing MCP tools
    // For now, return a placeholder
    return `Executed tool: ${toolName} with parameters: ${JSON.stringify(step.config.parameters)}`;
  }

  /**
   * Execute a gate step
   */
  private async executeGateStep(
    step: WorkflowStep,
    context: WorkflowExecutionContext
  ): Promise<string> {
    const gateId = step.config.gateId;
    if (!gateId) {
      throw new PromptError(`Gate ID not specified for step: ${step.id}`);
    }

    if (!this.gateEvaluator) {
      // Fallback to placeholder if no gate evaluator available
      return `Executed gate: ${gateId} - validation passed (no evaluator)`;
    }

    // Find the gate definition from the workflow
    const gateDefinition = this.findGateDefinition(gateId, context.workflow);
    if (!gateDefinition) {
      throw new PromptError(`Gate definition not found: ${gateId}`);
    }

    // Get content to validate (usually from the previous step)
    const content = this.getContentForGateValidation(step, context);
    
    try {
      const gateStatus = await this.gateEvaluator.evaluateGate(
        content,
        gateDefinition,
        context.inputs
      );
      
      if (gateStatus.passed) {
        this.logger.debug(`Gate ${gateId} passed validation`);
        return `Gate ${gateId} validation passed`;
      } else {
        const errorMessage = this.gateEvaluator.getRetryMessage([gateStatus]);
        this.logger.warn(`Gate ${gateId} failed validation:`, errorMessage);
        
        // Handle gate failure based on configuration
        if (gateDefinition.failureAction === 'stop') {
          throw new PromptError(`Gate validation failed: ${errorMessage}`);
        } else if (gateDefinition.failureAction === 'retry') {
          // Let the step error handler deal with retries
          throw new PromptError(`Gate validation failed (retry): ${errorMessage}`);
        } else if (gateDefinition.failureAction === 'skip') {
          this.logger.info(`Gate ${gateId} failed but configured to skip`);
          return `Gate ${gateId} failed but skipped: ${errorMessage}`;
        }
        
        return `Gate ${gateId} failed: ${errorMessage}`;
      }
    } catch (error) {
      this.logger.error(`Gate step ${step.id} failed:`, error);
      throw error;
    }
  }

  /**
   * Find gate definition in workflow
   */
  private findGateDefinition(gateId: string, workflow: Workflow): GateDefinition | undefined {
    if (!workflow.gates) return undefined;
    
    return workflow.gates.find(gate => gate.id === gateId);
  }

  /**
   * Get content for gate validation (usually from previous step)
   */
  private getContentForGateValidation(
    step: WorkflowStep,
    context: WorkflowExecutionContext
  ): string {
    // If step has dependencies, use the result from the last dependency
    if (step.dependencies.length > 0) {
      const lastDep = step.dependencies[step.dependencies.length - 1];
      const depResult = context.stepResults[lastDep];
      if (depResult) {
        return String(depResult);
      }
    }
    
    // Fallback to workflow inputs
    if (context.inputs.content) {
      return String(context.inputs.content);
    }
    
    // Last resort: combine all step results
    const allResults = Object.values(context.stepResults).join('\n\n');
    return allResults || '';
  }

  /**
   * Execute a condition step
   */
  private async executeConditionStep(
    step: WorkflowStep,
    context: WorkflowExecutionContext
  ): Promise<string> {
    const condition = step.config.condition;
    if (!condition) {
      throw new PromptError(`Condition not specified for step: ${step.id}`);
    }

    // TODO: Implement condition evaluation
    // For now, return a placeholder
    return `Evaluated condition: ${condition} - result: true`;
  }

  /**
   * Execute a parallel step
   */
  private async executeParallelStep(
    step: WorkflowStep,
    context: WorkflowExecutionContext
  ): Promise<string> {
    // TODO: Implement parallel execution
    // For now, return a placeholder
    return `Executed parallel step: ${step.id}`;
  }

  /**
   * Handle step execution errors
   */
  private async handleStepError(
    step: WorkflowStep,
    error: unknown,
    context: WorkflowExecutionContext
  ): Promise<StepResult> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (step.onError?.action === 'retry' && step.retries && step.retries > 0) {
      // TODO: Implement retry logic
      this.logger.warn(`Retrying step ${step.id} due to error: ${errorMessage}`);
    }

    return {
      content: `Step failed: ${errorMessage}`,
      status: 'failed',
      timestamp: Date.now(),
      metadata: {
        error: errorMessage,
        stepType: step.type
      }
    };
  }

  /**
   * Validate workflow definition
   */
  private async validateWorkflow(workflow: Workflow): Promise<WorkflowValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation
    if (!workflow.id) errors.push("Workflow ID is required");
    if (!workflow.name) errors.push("Workflow name is required");
    if (!workflow.version) errors.push("Workflow version is required");
    if (!workflow.steps || workflow.steps.length === 0) {
      errors.push("Workflow must have at least one step");
    }

    // Validate dependency graph
    const dependencyValidation = this.validateDependencyGraph(workflow.dependencies);
    if (!dependencyValidation.valid) {
      errors.push(...dependencyValidation.cycles.map(cycle => 
        `Dependency cycle detected: ${cycle.join(" -> ")}`
      ));
      errors.push(...dependencyValidation.unreachableNodes.map(node => 
        `Unreachable step: ${node}`
      ));
    }

    // Validate steps
    for (const step of workflow.steps) {
      if (!step.id) errors.push(`Step missing ID: ${step.name}`);
      if (!step.name) errors.push(`Step missing name: ${step.id}`);
      if (!step.type) errors.push(`Step missing type: ${step.id}`);
      
      // Validate step configuration
      switch (step.type) {
        case 'prompt':
          if (!step.config.promptId) {
            errors.push(`Prompt step missing promptId: ${step.id}`);
          }
          break;
        case 'tool':
          if (!step.config.toolName) {
            errors.push(`Tool step missing toolName: ${step.id}`);
          }
          break;
        case 'gate':
          if (!step.config.gateId) {
            errors.push(`Gate step missing gateId: ${step.id}`);
          }
          break;
        case 'condition':
          if (!step.config.condition) {
            errors.push(`Condition step missing condition: ${step.id}`);
          }
          break;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      dependencyValidation
    };
  }

  /**
   * Validate dependency graph for cycles and reachability
   */
  private validateDependencyGraph(graph: DependencyGraph): {
    valid: boolean;
    cycles: string[][];
    unreachableNodes: string[];
  } {
    const cycles = this.detectCycles(graph);
    const unreachableNodes = this.findUnreachableNodes(graph);

    return {
      valid: cycles.length === 0 && unreachableNodes.length === 0,
      cycles,
      unreachableNodes
    };
  }

  /**
   * Detect cycles in dependency graph using DFS
   */
  private detectCycles(graph: DependencyGraph): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const adjacencyList = new Map<string, string[]>();

    // Build adjacency list
    for (const [from, to] of graph.edges) {
      if (!adjacencyList.has(from)) {
        adjacencyList.set(from, []);
      }
      adjacencyList.get(from)!.push(to);
    }

    // DFS to detect cycles
    const dfs = (node: string, path: string[]): void => {
      if (recursionStack.has(node)) {
        // Found a cycle
        const cycleStart = path.indexOf(node);
        cycles.push([...path.slice(cycleStart), node]);
        return;
      }

      if (visited.has(node)) return;

      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = adjacencyList.get(node) || [];
      for (const neighbor of neighbors) {
        dfs(neighbor, path);
      }

      recursionStack.delete(node);
      path.pop();
    };

    for (const node of graph.nodes) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }

  /**
   * Find unreachable nodes in dependency graph
   */
  private findUnreachableNodes(graph: DependencyGraph): string[] {
    const reachable = new Set<string>();
    const adjacencyList = new Map<string, string[]>();

    // Build adjacency list
    for (const [from, to] of graph.edges) {
      if (!adjacencyList.has(from)) {
        adjacencyList.set(from, []);
      }
      adjacencyList.get(from)!.push(to);
    }

    // Find nodes with no incoming edges (start nodes)
    const incomingEdges = new Set<string>();
    for (const [, to] of graph.edges) {
      incomingEdges.add(to);
    }

    const startNodes = graph.nodes.filter(node => !incomingEdges.has(node));

    // DFS from start nodes to find all reachable nodes
    const dfs = (node: string): void => {
      if (reachable.has(node)) return;
      
      reachable.add(node);
      const neighbors = adjacencyList.get(node) || [];
      for (const neighbor of neighbors) {
        dfs(neighbor);
      }
    };

    for (const startNode of startNodes) {
      dfs(startNode);
    }

    return graph.nodes.filter(node => !reachable.has(node));
  }

  /**
   * Create execution plan using topological sort
   */
  private async createExecutionPlan(workflow: Workflow): Promise<WorkflowExecutionPlan> {
    const executionOrder = this.topologicalSort(workflow.dependencies);
    
    // TODO: Implement parallel group detection
    const parallelGroups: string[][] = [];
    
    // TODO: Implement duration estimation
    const estimatedDuration = workflow.steps.length * 1000; // 1 second per step placeholder

    return {
      workflowId: workflow.id,
      executionOrder,
      parallelGroups,
      estimatedDuration,
      validationResults: { valid: true } // Placeholder
    };
  }

  /**
   * Topological sort using Kahn's algorithm
   */
  private topologicalSort(graph: DependencyGraph): string[] {
    const inDegree = new Map<string, number>();
    const adjacencyList = new Map<string, string[]>();
    const result: string[] = [];
    const queue: string[] = [];

    // Initialize in-degree count
    for (const node of graph.nodes) {
      inDegree.set(node, 0);
      adjacencyList.set(node, []);
    }

    // Build adjacency list and calculate in-degrees
    for (const [from, to] of graph.edges) {
      adjacencyList.get(from)!.push(to);
      inDegree.set(to, (inDegree.get(to) || 0) + 1);
    }

    // Find all nodes with no incoming edges
    for (const [node, degree] of inDegree) {
      if (degree === 0) {
        queue.push(node);
      }
    }

    // Process nodes
    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);

      // Reduce in-degree of neighbors
      const neighbors = adjacencyList.get(node) || [];
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (result.length !== graph.nodes.length) {
      throw new ValidationError("Dependency graph contains cycles");
    }

    return result;
  }

  /**
   * Aggregate step results into final result
   */
  private aggregateResults(stepResults: Record<string, StepResult>): any {
    const completedSteps = Object.entries(stepResults)
      .filter(([, result]) => result.status === 'completed')
      .map(([stepId, result]) => ({ stepId, content: result.content }));

    return {
      summary: `Workflow completed with ${completedSteps.length} successful steps`,
      steps: completedSteps
    };
  }

  /**
   * Get workflow by ID
   */
  getWorkflow(workflowId: string): Workflow | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * List all registered workflows
   */
  listWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Get active executions
   */
  getActiveExecutions(): string[] {
    return Array.from(this.activeExecutions.keys());
  }
}

/**
 * Create and configure a workflow engine
 */
export function createWorkflowEngine(
  logger: Logger, 
  promptExecutor?: PromptExecutor, 
  gateEvaluator?: GateEvaluator
): WorkflowEngine {
  return new WorkflowEngine(logger, promptExecutor, gateEvaluator);
}