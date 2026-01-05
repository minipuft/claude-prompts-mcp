// @lifecycle canonical - Defines HTTP API routes for the MCP server.
/**
 * API Management Module
 * Handles Express app setup, middleware, and REST API endpoints
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import express, { Request, Response } from 'express';

import { ConfigManager } from '../config/index.js';
import { Logger } from '../logging/index.js';
import { McpToolsManager, PromptManagerActionArgs } from '../mcp-tools/index.js';
import { PromptAssetManager } from '../prompts/index.js';
import { reloadPromptData as reloadPromptDataFromDisk } from '../prompts/prompt-refresh-service.js';
import { modifyPromptSection, safeWriteFile } from '../prompts/promptUtils.js';
import { Category, PromptData, PromptsFile, ToolResponse } from '../types/index.js';

/**
 * API Manager class
 */
export class ApiManager {
  private logger: Logger;
  private configManager: ConfigManager;
  private promptManager: PromptAssetManager | undefined;
  private mcpToolsManager: McpToolsManager | undefined;
  private promptsData: PromptData[] = [];
  private categories: Category[] = [];
  private convertedPrompts: any[] = [];

  constructor(
    logger: Logger,
    configManager: ConfigManager,
    promptManager?: PromptAssetManager,
    mcpToolsManager?: McpToolsManager
  ) {
    this.logger = logger;
    this.configManager = configManager;
    this.promptManager = promptManager;
    this.mcpToolsManager = mcpToolsManager;
  }

  /**
   * Update data references
   */
  updateData(promptsData: PromptData[], categories: Category[], convertedPrompts: any[]): void {
    this.promptsData = promptsData;
    this.categories = categories;
    this.convertedPrompts = convertedPrompts;
  }

  /**
   * Create and configure Express application
   */
  createApp(): express.Application {
    const app = express();

    // Setup middleware
    this.setupMiddleware(app);

    // Setup routes
    this.setupRoutes(app);

    return app;
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(app: express.Application): void {
    // Enable CORS for Cursor integration
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      return next();
    });

    // Add JSON body parser middleware
    app.use(express.json());

    // Add request logging middleware
    app.use((req, res, next) => {
      this.logger.debug(`${req.method} ${req.url} - Headers: ${JSON.stringify(req.headers)}`);
      next();
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(app: express.Application): void {
    // Basic routes
    this.setupBasicRoutes(app);

    // Prompt and category routes
    this.setupPromptRoutes(app);

    // Tool API routes
    this.setupToolRoutes(app);
  }

  /**
   * Setup basic routes (home, health)
   */
  private setupBasicRoutes(app: express.Application): void {
    app.get('/', (_req: Request, res: Response) => {
      res.send('Claude Custom Prompts MCP Server - Use /mcp endpoint for MCP connections');
    });

    // Health check endpoint
    app.get('/health', (_req: Request, res: Response) => {
      const config = this.configManager.getConfig();
      res.json({ status: 'ok', version: config.server.version });
    });
  }

  /**
   * Setup prompt and category routes
   */
  private setupPromptRoutes(app: express.Application): void {
    // Get all categories and prompts
    app.get('/prompts', (_req: Request, res: Response) => {
      const result = {
        categories: this.categories,
        prompts: this.promptsData.map((prompt) => ({
          id: prompt.id,
          name: prompt.name,
          category: prompt.category,
          description: prompt.description,
          arguments: prompt.arguments,
        })),
      };
      res.json(result);
    });

    // Get prompts by category
    app.get('/categories/:categoryId/prompts', (req: Request, res: Response) => {
      const categoryId = req.params['categoryId'];
      const categoryPrompts = this.promptsData.filter((prompt) => prompt.category === categoryId);

      if (categoryPrompts.length === 0) {
        return res.status(404).json({ error: `No prompts found for category: ${categoryId}` });
      }

      return res.json(categoryPrompts);
    });
  }

  /**
   * Setup tool API routes
   */
  private setupToolRoutes(app: express.Application): void {
    // Create category endpoint
    app.post('/api/v1/tools/create_category', async (req: Request, res: Response) => {
      await this.handleCreateCategory(req, res);
    });

    // Update prompt endpoint
    app.post('/api/v1/tools/update_prompt', async (req: Request, res: Response) => {
      await this.handleUpdatePrompt(req, res);
    });

    // Delete prompt endpoint
    app.delete('/api/v1/tools/prompts/:id', async (req: Request, res: Response) => {
      await this.handleDeletePrompt(req, res);
    });

    // Reload prompts endpoint
    app.post('/api/v1/tools/reload_prompts', async (req: Request, res: Response) => {
      await this.handleReloadPrompts(req, res);
    });
  }

  /**
   * Handle create category API endpoint
   */
  private async handleCreateCategory(req: Request, res: Response): Promise<void> {
    try {
      this.logger.info('API request to create category:', req.body);

      // Validate required fields
      if (!req.body.id || !req.body.name || !req.body.description) {
        res.status(400).json({
          error: 'Missing required fields. Please provide id, name, and description.',
        });
        return;
      }

      const { id, name, description } = req.body;

      // Read the current prompts configuration file
      const PROMPTS_FILE = this.configManager.getResolvedPromptsFilePath();
      const fileContent = await readFile(PROMPTS_FILE, 'utf8');
      const promptsFile = JSON.parse(fileContent) as PromptsFile;

      // Check if the category already exists
      const categoryExists = promptsFile.categories.some((cat) => cat.id === id);
      if (categoryExists) {
        res.status(400).json({ error: `Category '${id}' already exists.` });
        return;
      }

      // Add the new category
      promptsFile.categories.push({ id, name, description });

      // Write the updated file
      await safeWriteFile(PROMPTS_FILE, JSON.stringify(promptsFile, null, 2), 'utf8');

      // Create the category directory if it doesn't exist
      const categoryDirPath = path.join(path.dirname(PROMPTS_FILE), id);
      try {
        await mkdir(categoryDirPath, { recursive: true });
      } catch (error) {
        this.logger.error(`Error creating directory ${categoryDirPath}:`, error);
        // Continue even if directory creation fails
      }

      try {
        await this.reloadPromptData();
        this.logger.info(
          `Reloaded ${this.promptsData.length} prompts and ${this.categories.length} categories after creating category: ${id}`
        );
      } catch (error) {
        this.logger.error('Error reloading prompts data:', error);
      }

      res.status(200).json({
        success: true,
        message: `Category '${name}' created successfully`,
      });
    } catch (error) {
      this.logger.error('Error handling create_category API request:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle update prompt API endpoint
   */
  private async handleUpdatePrompt(req: Request, res: Response): Promise<void> {
    try {
      this.logger.info('API request to update prompt:', req.body);

      const { id, name, category, userMessageTemplate } = req.body;
      if (!id || !name || !category || !userMessageTemplate) {
        res.status(400).json({
          error:
            'Missing required fields. Please provide id, name, category, and userMessageTemplate.',
        });
        return;
      }

      const promptArgs = req.body['arguments'];
      const gateConfiguration = req.body['gateConfiguration'] ?? req.body['gate_configuration'];

      const actionArgs: PromptManagerActionArgs = {
        action: 'update',
        id,
        name,
        category,
        description: req.body['description'],
        user_message_template: userMessageTemplate,
        system_message: req.body['systemMessage'],
        arguments: promptArgs,
        chain_steps: req.body['chainSteps'],
        is_chain: req.body['isChain'],
        gate_configuration: gateConfiguration,
        full_restart: req.body['restartServer'] === true,
      };

      const toolResponse = await this.runPromptManagerAction(actionArgs);
      const message = this.extractToolResponseMessage(toolResponse);

      await this.reloadPromptData();

      if (toolResponse.isError) {
        res.status(500).json({ success: false, message });
        return;
      }

      res.status(200).json({
        success: true,
        message,
      });
    } catch (error) {
      this.logger.error('Error handling update_prompt API request:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle delete prompt API endpoint
   */
  private async handleDeletePrompt(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params['id'];
      this.logger.info(`API request to delete prompt: ${id}`);

      if (!id) {
        res.status(400).json({ error: 'Prompt ID is required' });
        return;
      }

      const actionArgs: PromptManagerActionArgs = {
        action: 'delete',
        id,
        full_restart: req.body?.['restartServer'] === true,
      };

      const toolResponse = await this.runPromptManagerAction(actionArgs);
      const message = this.extractToolResponseMessage(toolResponse);

      if (!toolResponse.isError) {
        await this.reloadPromptData();
      }

      if (toolResponse.isError) {
        res.status(500).json({ success: false, message });
        return;
      }

      res.status(200).json({
        success: true,
        message,
      });
    } catch (error) {
      this.logger.error('Error handling delete_prompt API request:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle reload prompts API endpoint
   */
  private async handleReloadPrompts(req: Request, res: Response): Promise<void> {
    try {
      this.logger.info('API request to reload prompts');

      const shouldRestart = req.body?.restart === true;
      const reason = req.body?.reason ? req.body.reason : 'Manual reload requested';

      try {
        await this.reloadPromptData();

        if (shouldRestart) {
          res.status(200).json({
            success: true,
            message: `Successfully refreshed the server with ${this.promptsData.length} prompts and ${this.categories.length} categories. Server is now restarting.`,
            data: {
              promptsCount: this.promptsData.length,
              categoriesCount: this.categories.length,
              convertedPromptsCount: this.convertedPrompts.length,
              restarting: true,
            },
          });
        } else {
          res.status(200).json({
            success: true,
            message: `Successfully refreshed the server with ${this.promptsData.length} prompts and ${this.categories.length} categories`,
            data: {
              promptsCount: this.promptsData.length,
              categoriesCount: this.categories.length,
              convertedPromptsCount: this.convertedPrompts.length,
            },
          });
        }
      } catch (refreshError) {
        this.logger.error('Error refreshing server:', refreshError);
        res.status(500).json({
          success: false,
          message: `Failed to refresh server: ${
            refreshError instanceof Error ? refreshError.message : String(refreshError)
          }`,
        });
      }
    } catch (error) {
      this.logger.error('Error handling reload_prompts API request:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  /**
   * Helper method to reload prompt data
   */
  private async reloadPromptData(): Promise<void> {
    const promptManager = this.promptManager;
    if (!promptManager) {
      throw new Error('PromptManager not available');
    }

    const reloadOptions: Parameters<typeof reloadPromptDataFromDisk>[0] = {
      configManager: this.configManager,
      promptManager,
    };
    if (this.mcpToolsManager) {
      reloadOptions.mcpToolsManager = this.mcpToolsManager;
    }

    const result = await reloadPromptDataFromDisk(reloadOptions);

    this.updateData(result.promptsData, result.categories, result.convertedPrompts);
  }

  private async runPromptManagerAction(args: PromptManagerActionArgs): Promise<ToolResponse> {
    if (!this.mcpToolsManager) {
      throw new Error('MCP Tools Manager not available');
    }
    return this.mcpToolsManager.runPromptManagerAction(args);
  }

  private extractToolResponseMessage(response: ToolResponse): string {
    if (response.content.length === 0) {
      return response.isError ? 'Prompt manager reported an error' : 'Operation completed';
    }

    return response.content
      .map((entry) => entry.text)
      .join('\n')
      .trim();
  }
}

/**
 * Create and configure an API manager
 */
export function createApiManager(
  logger: Logger,
  configManager: ConfigManager,
  promptManager?: PromptAssetManager,
  mcpToolsManager?: McpToolsManager
): ApiManager {
  return new ApiManager(logger, configManager, promptManager, mcpToolsManager);
}
