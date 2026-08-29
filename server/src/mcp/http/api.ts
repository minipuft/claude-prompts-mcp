// @lifecycle canonical - Defines HTTP API routes for the MCP server.
/**
 * API Management Module
 * Handles Express app setup, middleware, and REST API endpoints
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'path';

import express, { Request, Response } from 'express';

import { McpToolRouter } from '../tools/index.js';

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

/*
 * Loopback origins only. A browser page served from anywhere else has no business
 * driving a local MCP server, and every non-browser client (which is most MCP
 * clients) sends no Origin header at all and is unaffected by this list.
 */
const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost',
  'https://localhost',
  'http://127.0.0.1',
  'https://127.0.0.1',
  'http://[::1]',
  'https://[::1]',
];

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
  private catalogReadToken: string | null;
  private toolsWriteToken: string | null;
  private allowedOrigins: Set<string>;

  constructor(
    logger: Logger,
    configManager: ConfigManager,
    promptManager?: PromptAssetManager,
    mcpToolsManager?: McpToolRouter,
    options: {
      catalogReadToken?: string | null;
      toolsWriteToken?: string | null;
      allowedOrigins?: readonly string[];
    } = {}
  ) {
    this.logger = logger;
    this.configManager = configManager;
    this.promptManager = promptManager;
    this.mcpToolsManager = mcpToolsManager;
    const catalogReadToken = options.catalogReadToken?.trim();
    this.catalogReadToken =
      catalogReadToken === undefined || catalogReadToken.length === 0 ? null : catalogReadToken;

    /*
     * A SEPARATE token from the read token, deliberately. The catalog token is held by
     * read-only adapters that render prompt content; letting that same string delete a
     * prompt would hand every reader the destructive surface too. Least privilege costs
     * one env var here.
     */
    const toolsWriteToken = options.toolsWriteToken?.trim();
    this.toolsWriteToken =
      toolsWriteToken === undefined || toolsWriteToken.length === 0 ? null : toolsWriteToken;

    this.allowedOrigins = new Set(
      (options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS).map((origin) =>
        origin.trim().toLowerCase().replace(/\/$/, '')
      )
    );
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
    /*
     * Origin validation runs FIRST, ahead of CORS and ahead of any token check, and it
     * wraps the whole app — so `/mcp`, `/health` and the REST routes are all covered and
     * a hostile page is refused before a credential is read.
     *
     * This is the DNS rebinding control, and CORS is not a substitute for it: under
     * rebinding the attacker repoints their own domain at 127.0.0.1, so the browser
     * treats the request as SAME-ORIGIN, sends no preflight, and any CORS policy is
     * never consulted. That is why the MCP Streamable HTTP transport makes Origin
     * validation a MUST rather than a recommendation.
     *
     * Comparing Origin against Host would not work either — the attacker owns the
     * hostname the browser resolved, so both headers carry their domain and the check
     * would admit exactly the request it exists to stop. Only an expected-origin list
     * separates the cases.
     *
     * A request with NO Origin passes. Browsers always set it; most MCP clients are not
     * browsers. Rejecting its absence would break every CLI client while stopping
     * nothing, since an attacker who can set arbitrary headers is not in a browser and
     * is not subject to this control at all.
     */
    app.use((req, res, next) => {
      const origin = req.header('origin');
      if (origin !== undefined && !this.isAllowedOrigin(origin)) {
        this.logger.warn(`[api] rejected cross-origin request from ${origin} to ${req.url}`);
        return res.status(403).json({ error: 'Origin not allowed' });
      }

      if (origin !== undefined) {
        // Echo the specific allowed origin rather than `*`; a wildcard cannot carry
        // credentials and tells every caller it is welcome.
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
        res.header(
          'Access-Control-Allow-Headers',
          'Origin, X-Requested-With, Content-Type, Accept, Authorization'
        );
      }

      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      return next();
    });

    // Add JSON body parser middleware
    app.use(express.json());

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

    // Executable prompt content is reserved for authenticated server-side catalog adapters.
    app.get('/api/v1/catalog/prompts/:promptId', (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');

      if (this.catalogReadToken === null) {
        return res.status(503).json({ error: 'Catalog detail endpoint is unavailable' });
      }
      if (!this.hasValidCatalogReadToken(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const promptIdParam = req.params['promptId'];
      const promptId = Array.isArray(promptIdParam) ? promptIdParam[0] : promptIdParam;
      const prompt = this.convertedPrompts.find((candidate) => candidate.id === promptId);

      if (prompt === undefined) {
        return res.status(404).json({ error: `Prompt not found: ${promptId}` });
      }

      return res.json(buildPromptCatalogDetail(prompt));
    });

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

  /** Origin matches on scheme+host+port; the port-less defaults admit any port on loopback. */
  private isAllowedOrigin(origin: string): boolean {
    const normalized = origin.trim().toLowerCase().replace(/\/$/, '');
    if (this.allowedOrigins.has(normalized)) return true;

    // `http://localhost:3000` matches the `http://localhost` default.
    try {
      const url = new URL(normalized);
      return this.allowedOrigins.has(`${url.protocol}//${url.hostname}`);
    } catch {
      return false;
    }
  }

  /** Constant-time bearer comparison against a configured token. */
  private hasValidBearer(req: Request, expected: string | null): boolean {
    if (expected === null) return false;

    const authorization = req.header('authorization');
    if (authorization?.startsWith('Bearer ') !== true) return false;

    const candidate = authorization.slice('Bearer '.length).trim();
    if (candidate.length === 0) return false;

    const expectedDigest = createHash('sha256').update(expected).digest();
    const candidateDigest = createHash('sha256').update(candidate).digest();
    return timingSafeEqual(expectedDigest, candidateDigest);
  }

  /**
   * Gate for the four mutating tool routes. Fails closed exactly like the catalog
   * route: an unconfigured token is a refusal, not an open door.
   */
  private requireToolsWriteToken(req: Request, res: Response): boolean {
    res.setHeader('Cache-Control', 'no-store');

    if (this.toolsWriteToken === null) {
      res.status(503).json({ error: 'Tool write endpoints are unavailable' });
      return false;
    }
    if (!this.hasValidBearer(req, this.toolsWriteToken)) {
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  private hasValidCatalogReadToken(req: Request): boolean {
    const authorization = req.header('authorization');
    if (authorization?.startsWith('Bearer ') !== true) return false;

    const candidate = authorization.slice('Bearer '.length).trim();
    if (candidate.length === 0 || this.catalogReadToken === null) return false;

    const expectedDigest = createHash('sha256').update(this.catalogReadToken).digest();
    const candidateDigest = createHash('sha256').update(candidate).digest();
    return timingSafeEqual(expectedDigest, candidateDigest);
  }

  /**
   * Setup tool API routes
   */
  private setupToolRoutes(app: express.Application): void {
    /*
     * Every route below MUTATES server-owned resources — create, update, delete, reload.
     * They were previously reachable with no credential at all, while the read-only
     * catalog route required a bearer token: a posture where reading a template was
     * harder than deleting one. Authentication runs before the handler, so a refused
     * request never reaches `resource_manager`.
     */
    // Create category endpoint
    app.post('/api/v1/tools/create_category', async (req: Request, res: Response) => {
      if (!this.requireToolsWriteToken(req, res)) return;
      await this.handleCreateCategory(req, res);
    });

    // Update prompt endpoint
    app.post('/api/v1/tools/update_prompt', async (req: Request, res: Response) => {
      if (!this.requireToolsWriteToken(req, res)) return;
      await this.handleUpdatePrompt(req, res);
    });

    // Delete prompt endpoint
    app.delete('/api/v1/tools/prompts/:id', async (req: Request, res: Response) => {
      if (!this.requireToolsWriteToken(req, res)) return;
      await this.handleDeletePrompt(req, res);
    });

    // Reload prompts endpoint
    app.post('/api/v1/tools/reload_prompts', async (req: Request, res: Response) => {
      if (!this.requireToolsWriteToken(req, res)) return;
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

      // Categories are directory-based — create the category directory
      const promptsDir = this.configManager.getPromptsDirectory();
      const categoryDirPath = path.join(promptsDir, id);

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
  const configuredOrigins = process.env['MCP_HTTP_ALLOWED_ORIGINS']
    ?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return new ApiRouter(logger, configManager, promptManager, mcpToolsManager, {
    catalogReadToken: process.env['MCP_CATALOG_READ_TOKEN'],
    toolsWriteToken: process.env['MCP_TOOLS_WRITE_TOKEN'],
    // Naming any origin REPLACES the loopback defaults rather than adding to them, so an
    // operator publishing under a real hostname states the full policy in one place.
    ...(configuredOrigins !== undefined && configuredOrigins.length > 0
      ? { allowedOrigins: configuredOrigins }
      : {}),
  });
}
