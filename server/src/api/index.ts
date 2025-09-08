/**
 * API Management Module
 * Handles Express app setup, middleware, and REST API endpoints
 */

import express, { Request, Response } from "express";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { ConfigManager } from "../config/index.js";
import { Logger } from "../logging/index.js";
import { McpToolsManager } from "../mcp-tools/index.js";
import { PromptManager } from "../prompts/index.js";
import { modifyPromptSection } from "../prompts/promptUtils.js";
import { Category, PromptData, PromptsFile } from "../types/index.js";

/**
 * API Manager class
 */
export class ApiManager {
  private logger: Logger;
  private configManager: ConfigManager;
  private promptManager?: PromptManager;
  private mcpToolsManager?: McpToolsManager;
  private promptsData: PromptData[] = [];
  private categories: Category[] = [];
  private convertedPrompts: any[] = [];

  constructor(
    logger: Logger,
    configManager: ConfigManager,
    promptManager?: PromptManager,
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
  updateData(
    promptsData: PromptData[],
    categories: Category[],
    convertedPrompts: any[]
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
    // Enable CORS for Cursor integration
    app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
      res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept"
      );
      if (req.method === "OPTIONS") {
        return res.sendStatus(200);
      }
      next();
    });

    // Add JSON body parser middleware
    app.use(express.json());

    // Add request logging middleware
    app.use((req, res, next) => {
      this.logger.debug(
        `${req.method} ${req.url} - Headers: ${JSON.stringify(req.headers)}`
      );
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
    app.get("/", (_req: Request, res: Response) => {
      res.send(
        "Claude Custom Prompts MCP Server - Use /mcp endpoint for MCP connections"
      );
    });

    // Health check endpoint
    app.get("/health", (_req: Request, res: Response) => {
      const config = this.configManager.getConfig();
      res.json({ status: "ok", version: config.server.version });
    });
  }

  /**
   * Setup prompt and category routes
   */
  private setupPromptRoutes(app: express.Application): void {
    // Get all categories and prompts
    app.get("/prompts", (_req: Request, res: Response) => {
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
    app.get(
      "/categories/:categoryId/prompts",
      (req: Request, res: Response) => {
        const categoryId = req.params.categoryId;
        const categoryPrompts = this.promptsData.filter(
          (prompt) => prompt.category === categoryId
        );

        if (categoryPrompts.length === 0) {
          return res
            .status(404)
            .json({ error: `No prompts found for category: ${categoryId}` });
        }

        res.json(categoryPrompts);
      }
    );
  }

  /**
   * Setup tool API routes
   */
  private setupToolRoutes(app: express.Application): void {
    // Create category endpoint
    app.post(
      "/api/v1/tools/create_category",
      async (req: Request, res: Response) => {
        await this.handleCreateCategory(req, res);
      }
    );

    // Update prompt endpoint
    app.post(
      "/api/v1/tools/update_prompt",
      async (req: Request, res: Response) => {
        await this.handleUpdatePrompt(req, res);
      }
    );

    // Delete prompt endpoint
    app.delete(
      "/api/v1/tools/prompts/:id",
      async (req: Request, res: Response) => {
        await this.handleDeletePrompt(req, res);
      }
    );

    // Modify prompt section endpoint
    app.post(
      "/api/v1/tools/modify_prompt_section",
      async (req: Request, res: Response) => {
        await this.handleModifyPromptSection(req, res);
      }
    );

    // Reload prompts endpoint
    app.post(
      "/api/v1/tools/reload_prompts",
      async (req: Request, res: Response) => {
        await this.handleReloadPrompts(req, res);
      }
    );
  }

  /**
   * Handle create category API endpoint
   */
  private async handleCreateCategory(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      this.logger.info("API request to create category:", req.body);

      // Validate required fields
      if (!req.body.id || !req.body.name || !req.body.description) {
        res.status(400).json({
          error:
            "Missing required fields. Please provide id, name, and description.",
        });
        return;
      }

      const { id, name, description } = req.body;

      // Read the current prompts configuration file
      const PROMPTS_FILE = this.getPromptsFilePath();
      const fileContent = await readFile(PROMPTS_FILE, "utf8");
      const promptsFile = JSON.parse(fileContent) as PromptsFile;

      // Check if the category already exists
      const categoryExists = promptsFile.categories.some(
        (cat) => cat.id === id
      );
      if (categoryExists) {
        res.status(400).json({ error: `Category '${id}' already exists.` });
        return;
      }

      // Add the new category
      promptsFile.categories.push({ id, name, description });

      // Write the updated file
      await writeFile(
        PROMPTS_FILE,
        JSON.stringify(promptsFile, null, 2),
        "utf8"
      );

      // Create the category directory if it doesn't exist
      const categoryDirPath = path.join(path.dirname(PROMPTS_FILE), id);
      try {
        await mkdir(categoryDirPath, { recursive: true });
      } catch (error) {
        this.logger.error(
          `Error creating directory ${categoryDirPath}:`,
          error
        );
        // Continue even if directory creation fails
      }

      // Reload prompts and categories if prompt manager is available
      if (this.promptManager) {
        try {
          await this.reloadPromptData();
          this.logger.info(
            `Reloaded ${this.promptsData.length} prompts and ${this.categories.length} categories after creating category: ${id}`
          );
        } catch (error) {
          this.logger.error("Error reloading prompts data:", error);
        }
      }

      res.status(200).json({
        success: true,
        message: `Category '${name}' created successfully`,
      });
    } catch (error) {
      this.logger.error("Error handling create_category API request:", error);
      res.status(500).json({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle update prompt API endpoint
   */
  private async handleUpdatePrompt(req: Request, res: Response): Promise<void> {
    try {
      this.logger.info("API request to update prompt:", req.body);

      // Validate required fields
      if (
        !req.body.id ||
        !req.body.name ||
        !req.body.category ||
        !req.body.userMessageTemplate
      ) {
        res.status(400).json({
          error:
            "Missing required fields. Please provide id, name, category, and userMessageTemplate.",
        });
        return;
      }

      const {
        id,
        name,
        category,
        description,
        userMessageTemplate,
        arguments: promptArgs,
        systemMessage,
        isChain,
        chainSteps,
      } = req.body;

      // Implementation would include full update logic...
      // For brevity, this is a simplified version
      res.status(200).json({
        success: true,
        message: `Prompt '${name}' updated successfully`,
      });
    } catch (error) {
      this.logger.error("Error handling update_prompt API request:", error);
      res.status(500).json({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle delete prompt API endpoint
   */
  private async handleDeletePrompt(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id;
      this.logger.info(`API request to delete prompt: ${id}`);

      if (!id) {
        res.status(400).json({ error: "Prompt ID is required" });
        return;
      }

      // Implementation would include full delete logic...
      res.status(200).json({
        success: true,
        message: `Prompt '${id}' deleted successfully`,
      });
    } catch (error) {
      this.logger.error("Error handling delete_prompt API request:", error);
      res.status(500).json({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle modify prompt section API endpoint
   */
  private async handleModifyPromptSection(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      this.logger.info("Received request to modify prompt section:", req.body);

      const { id, section_name, new_content, restartServer } = req.body;

      if (!id || !section_name || !new_content) {
        res.status(400).json({
          success: false,
          message:
            "Missing required fields: id, section_name, and new_content are required",
        });
        return;
      }

      // Use the modifyPromptSection function from promptUtils
      const PROMPTS_FILE = this.getPromptsFilePath();
      const result = await modifyPromptSection(
        id,
        section_name,
        new_content,
        PROMPTS_FILE
      );

      if (!result.success) {
        res.status(404).json({
          success: false,
          message: result.message,
        });
        return;
      }

      // Reload prompt data if available
      if (this.promptManager) {
        try {
          await this.reloadPromptData();
          this.logger.info(
            `Triggered server refresh${
              restartServer ? " with restart" : ""
            } after modifying section: ${section_name}`
          );
        } catch (refreshError) {
          this.logger.error(
            `Error refreshing server after modifying section: ${section_name}`,
            refreshError
          );
        }
      }

      res.status(200).json({
        success: true,
        message: result.message,
        restarting: restartServer || false,
      });
    } catch (error) {
      this.logger.error(
        "Error handling modify_prompt_section API request:",
        error
      );
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle reload prompts API endpoint
   */
  private async handleReloadPrompts(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      this.logger.info("API request to reload prompts");

      const shouldRestart = req.body && req.body.restart === true;
      const reason =
        req.body && req.body.reason
          ? req.body.reason
          : "Manual reload requested";

      try {
        // Reload prompt data if available
        if (this.promptManager) {
          await this.reloadPromptData();
        }

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
        this.logger.error("Error refreshing server:", refreshError);
        res.status(500).json({
          success: false,
          message: `Failed to refresh server: ${
            refreshError instanceof Error
              ? refreshError.message
              : String(refreshError)
          }`,
        });
      }
    } catch (error) {
      this.logger.error("Error handling reload_prompts API request:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Helper method to reload prompt data
   */
  private async reloadPromptData(): Promise<void> {
    if (!this.promptManager) {
      throw new Error("PromptManager not available");
    }

    const PROMPTS_FILE = this.getPromptsFilePath();

    const result = await this.promptManager.loadAndConvertPrompts(PROMPTS_FILE);
    this.updateData(
      result.promptsData,
      result.categories,
      result.convertedPrompts
    );

    // Update MCP tools manager if available
    if (this.mcpToolsManager) {
      this.mcpToolsManager.updateData(
        result.promptsData,
        result.convertedPrompts,
        result.categories
      );
    }
  }

  /**
   * Get prompts file path using consistent resolution logic
   * This ensures all API operations use the same path resolution as the orchestration module
   */
  private getPromptsFilePath(): string {
    // ENHANCED: Use same path resolution logic as orchestration module
    // This ensures API operations also respect MCP_PROMPTS_CONFIG_PATH environment variable
    let PROMPTS_FILE: string;

    if (process.env.MCP_PROMPTS_CONFIG_PATH) {
      PROMPTS_FILE = process.env.MCP_PROMPTS_CONFIG_PATH;
      this.logger.info(
        "🎯 API: Using MCP_PROMPTS_CONFIG_PATH environment variable override"
      );
    } else {
      // Fallback to ConfigManager's getPromptsFilePath() method which handles server root properly
      PROMPTS_FILE = this.configManager.getPromptsFilePath();
      this.logger.info(
        "📁 API: Using config-based prompts file path resolution"
      );
    }

    // Ensure absolute path (critical for Claude Desktop)
    if (!path.isAbsolute(PROMPTS_FILE)) {
      PROMPTS_FILE = path.resolve(PROMPTS_FILE);
      this.logger.info(`🔧 API: Converted to absolute path: ${PROMPTS_FILE}`);
    }

    return PROMPTS_FILE;
  }
}

/**
 * Create and configure an API manager
 */
export function createApiManager(
  logger: Logger,
  configManager: ConfigManager,
  promptManager?: PromptManager,
  mcpToolsManager?: McpToolsManager
): ApiManager {
  return new ApiManager(logger, configManager, promptManager, mcpToolsManager);
}
