// @lifecycle canonical - Defines HTTP API routes for the MCP server.
/**
 * API Management Module
 * Handles Express app setup, middleware, and REST API endpoints
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

import express, { Request, Response } from 'express';

import { ApiSecurityBoundary } from './api-security.js';
import { PromptAuthorityApi } from './prompt-authority-api.js';
import { McpToolRouter } from '../tools/index.js';
import { validateCategoryName } from '../tools/resource-manager/prompt/utils/validation.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { Category, PromptData } from '#modules/prompts/types.js';
import type { ConfigManager, Logger, ToolResponse } from '#shared/types/index.js';
import type { ResourceManagerInput } from '../tools/resource-manager/core/types.js';

import { PromptAssetManager } from '#modules/prompts/index.js';
import {
  buildPromptCatalogDetail,
  buildPromptCatalogSummary,
} from '#modules/prompts/prompt-catalog.js';
import { reloadPromptData as reloadPromptDataFromDisk } from '#modules/prompts/prompt-refresh-service.js';
import { resolveContainedPath } from '#shared/utils/path-containment.js';

/**
 * API Manager class
 */
export class ApiRouter {
  private logger: Logger;
  private configManager: ConfigManager;
  private promptManager: PromptAssetManager | undefined;
  private mcpToolsManager: McpToolRouter | undefined;
  private promptsData: PromptData[] = [];
  private categories: Category[] = [];
  private convertedPrompts: ConvertedPrompt[] = [];
  private readonly security: ApiSecurityBoundary;
  private readonly promptAuthority: PromptAuthorityApi;

  constructor(
    logger: Logger,
    configManager: ConfigManager,
    promptManager?: PromptAssetManager,
    mcpToolsManager?: McpToolRouter,
    options: {
      catalogReadToken?: string | null;
      catalogWriteToken?: string | null;
      allowedOrigins?: readonly string[];
    } = {}
  ) {
    this.logger = logger;
    this.configManager = configManager;
    this.promptManager = promptManager;
    this.mcpToolsManager = mcpToolsManager;
    this.security = new ApiSecurityBoundary({
      readToken: options.catalogReadToken,
      writeToken: options.catalogWriteToken,
      allowedOrigins: options.allowedOrigins,
    });
    this.promptAuthority = new PromptAuthorityApi({
      logger,
      getPrompts: () => this.convertedPrompts,
      runAction: (input) => this.runResourceManagerAction(input),
    });
  }

  /**
   * Update data references
   */
  updateData(
    promptsData: PromptData[],
    categories: Category[],
    convertedPrompts: ConvertedPrompt[]
  ): void {
    this.promptsData = promptsData;
    this.categories = categories;
    this.convertedPrompts = convertedPrompts;
  }

  /**
   * Create and configure Express application
   */
  createApp(): express.Application {
    const app = express();

    // Security runs before JSON parsing so unauthorized writes never consume request bodies.
    this.security.register(app);

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
    // Add JSON body parser middleware
    app.use(express.json({ limit: '1mb' }));

    // Add request logging middleware
    app.use((req, _res, next) => {
      const sanitizedHeaders = { ...req.headers };
      delete sanitizedHeaders.authorization;
      delete sanitizedHeaders.cookie;
      this.logger.debug(`${req.method} ${req.url} - Headers: ${JSON.stringify(sanitizedHeaders)}`);
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
        prompts: this.convertedPrompts.map(buildPromptCatalogSummary),
      };
      res.json(result);
    });

    // This compatibility API is not authenticated, so detail stays metadata-only. An authenticated
    // adapter may project buildPromptCatalogDetail when executable content is required.
    app.get('/prompts/:promptId', (req: Request, res: Response) => {
      const promptIdParam = req.params['promptId'];
      const promptId = Array.isArray(promptIdParam) ? promptIdParam[0] : promptIdParam;
      const prompt = this.convertedPrompts.find((candidate) => candidate.id === promptId);

      if (prompt === undefined) {
        return res.status(404).json({ error: `Prompt not found: ${promptId}` });
      }

      return res.json(buildPromptCatalogSummary(prompt));
    });

    /**
     * The catalog COLLECTION the agent-workbench prompt authority lists from.
     *
     * `GET /api/v1/catalog/prompts` with `{ prompts: [...] }` is what
     * `promptAuthorityHttp.listPrompts` requires: anything else — including a 404 — becomes
     * `PromptAuthorityUnavailableError('catalog_unavailable')`, which the workbench projects as an
     * empty catalog with `state: 'unavailable'`. Downstream, t3code's workflow catalog then shows
     * no prompts at all.
     *
     * Only the item route below existed, so every per-prompt call worked while the listing did not
     * — the shape that makes this read as "the client broke" rather than "one route is missing".
     * `api-security.ts` already guards this prefix with the read token, and `app.use` on a path
     * covers the collection as well as its children, so this inherits that gate.
     *
     * Summaries, not details: a listing names no prompt, so it must not hand back every prompt's
     * instruction body (`33da6227`). `buildPromptCatalogSummary` already carries every field the
     * workbench projects — id, name, category, description, arguments, composerInputArgument,
     * executionType, revision.
     */
    app.get('/api/v1/catalog/prompts', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ prompts: this.convertedPrompts.map(buildPromptCatalogSummary) });
    });

    // Executable prompt content is reserved for authenticated server-side catalog adapters.
    app.get('/api/v1/catalog/prompts/:promptId', (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');

      const promptIdParam = req.params['promptId'];
      const promptId = Array.isArray(promptIdParam) ? promptIdParam[0] : promptIdParam;
      const prompt = this.convertedPrompts.find((candidate) => candidate.id === promptId);

      if (prompt === undefined) {
        return res.status(404).json({ error: `Prompt not found: ${promptId}` });
      }

      return res.json(buildPromptCatalogDetail(prompt));
    });

    this.promptAuthority.register(app);

    // Get prompts by category
    app.get('/categories/:categoryId/prompts', (req: Request, res: Response) => {
      const categoryIdParam = req.params['categoryId'];
      const categoryId = Array.isArray(categoryIdParam) ? categoryIdParam[0] : categoryIdParam;
      const categoryPrompts = this.convertedPrompts
        .filter((prompt) => prompt.category === categoryId)
        .map(buildPromptCatalogSummary);

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

      if (!req.body.id || !req.body.name || !req.body.description) {
        res.status(400).json({
          error: 'Missing required fields. Please provide id, name, and description.',
        });
        return;
      }

      const { id, name } = req.body;

      // Categories are directory-based — create the category directory.
      //
      // `id` arrives straight off the HTTP body. This is the same unvalidated-segment defect the
      // three MCP writers carried, on a surface the type-by-type fix did not reach — found by
      // enumerating every file that resolves a resource root and writes, which is what
      // `validate:contained-resource-writes` now does on every run.
      const promptsDir = this.configManager.getPromptsDirectory();
      let categoryDirPath: string;
      try {
        validateCategoryName(id);
        categoryDirPath = resolveContainedPath(promptsDir, id);
      } catch (error) {
        // Generic to the client, specific to the log — the message names absolute server paths.
        this.logger.warn(
          `Rejected create_category with an unusable id: ${error instanceof Error ? error.message : String(error)}`
        );
        res.status(400).json({ error: 'Invalid category id.' });
        return;
      }

      if (existsSync(categoryDirPath)) {
        res.status(400).json({ error: `Category '${id}' already exists.` });
        return;
      }

      await mkdir(categoryDirPath, { recursive: true });

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

      const actionArgs: ResourceManagerInput = {
        resource_type: 'prompt',
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

      const toolResponse = await this.runResourceManagerAction(actionArgs);
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
      const idParam = req.params['id'];
      const id = Array.isArray(idParam) ? idParam[0] : idParam;
      this.logger.info(`API request to delete prompt: ${id}`);

      if (!id) {
        res.status(400).json({ error: 'Prompt ID is required' });
        return;
      }

      const actionArgs: ResourceManagerInput = {
        resource_type: 'prompt',
        action: 'delete',
        id,
        full_restart: req.body?.['restartServer'] === true,
      };

      const toolResponse = await this.runResourceManagerAction(actionArgs);
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
      throw new Error('Prompt assets not available');
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

  private async runResourceManagerAction(args: ResourceManagerInput): Promise<ToolResponse> {
    if (!this.mcpToolsManager) {
      throw new Error('MCP Tools Manager not available');
    }
    const handler = this.mcpToolsManager.getResourceManagerHandler?.();
    if (!handler) {
      throw new Error('Resource manager handler not available');
    }
    return handler(args as unknown as Record<string, unknown>, {});
  }

  private extractToolResponseMessage(response: ToolResponse): string {
    if (response.content.length === 0) {
      return response.isError ? 'Resource manager reported an error' : 'Operation completed';
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
export function createApiRouter(
  logger: Logger,
  configManager: ConfigManager,
  promptManager?: PromptAssetManager,
  mcpToolsManager?: McpToolRouter
): ApiRouter {
  return new ApiRouter(logger, configManager, promptManager, mcpToolsManager, {
    catalogReadToken: process.env['MCP_CATALOG_READ_TOKEN'],
    catalogWriteToken: process.env['MCP_CATALOG_WRITE_TOKEN'],
    allowedOrigins: (process.env['MCP_HTTP_ALLOWED_ORIGINS'] ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  });
}
