// @lifecycle canonical - Projects canonical prompt governance over authenticated HTTP.
import { z } from 'zod/v4';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { Logger, ToolResponse } from '#shared/types/index.js';
import type { ResourceManagerInput } from '../tools/resource-manager/core/types.js';
import type { Application, Request, Response } from 'express';

import { buildPromptCatalogDetail } from '#modules/prompts/prompt-catalog.js';

const promptIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_-]+$/);
const versionSchema = z.coerce.number().int().nonnegative();
const promptArgumentSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(['string', 'number', 'boolean', 'object', 'array']).optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    validation: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const patchSchema = z
  .object({
    field: z.enum(['user_message_template', 'system_message']),
    old_string: z.string().min(1),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  })
  .strict();
const mutationFields = {
  expected_version: versionSchema,
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  description: z.string().optional(),
  user_message_template: z.string().optional(),
  system_message: z.string().optional(),
  arguments: z.array(promptArgumentSchema).optional(),
  argument_updates: z.array(promptArgumentSchema).optional(),
  composer: z
    .object({ inputArgument: z.string().min(1) })
    .strict()
    .optional(),
  chain_steps: z.array(z.record(z.string(), z.unknown())).optional(),
  gate_configuration: z.record(z.string(), z.unknown()).optional(),
  patch: z.array(patchSchema).min(1).optional(),
} as const;
const previewSchema = z.object(mutationFields).strict();
const applySchema = z.object({ ...mutationFields, confirmed: z.literal(true) }).strict();
const rollbackSchema = z
  .object({ version: versionSchema, expected_version: versionSchema, confirmed: z.literal(true) })
  .strict();
const historyQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const compareQuerySchema = z
  .object({ from_version: versionSchema, to_version: versionSchema })
  .strict();

interface PromptAuthorityDependencies {
  logger: Logger;
  getPrompts: () => ConvertedPrompt[];
  runAction: (input: ResourceManagerInput) => Promise<ToolResponse>;
}

/** Authenticated JSON projection over the canonical resource-manager prompt authority. */
export class PromptAuthorityApi {
  constructor(private readonly dependencies: PromptAuthorityDependencies) {}

  register(app: Application): void {
    app.get('/api/v1/authority/prompts/:promptId', (req, res) => void this.detail(req, res));
    app.get(
      '/api/v1/authority/prompts/:promptId/history',
      (req, res) => void this.history(req, res)
    );
    app.get(
      '/api/v1/authority/prompts/:promptId/compare',
      (req, res) => void this.compare(req, res)
    );
    app.post(
      '/api/v1/authority/prompts/:promptId/preview',
      (req, res) => void this.preview(req, res)
    );
    app.post('/api/v1/authority/prompts/:promptId/apply', (req, res) => void this.apply(req, res));
    app.post(
      '/api/v1/authority/prompts/:promptId/rollback',
      (req, res) => void this.rollback(req, res)
    );
  }

  private async detail(req: Request, res: Response): Promise<void> {
    const id = this.decodeId(req, res);
    if (id === null) return;
    const prompt = this.dependencies.getPrompts().find((candidate) => candidate.id === id);
    if (prompt === undefined) return this.error(res, 404, 'not_found', 'Prompt not found');
    const history = await this.run({ resource_type: 'prompt', action: 'history', id, limit: 1 });
    if (history === null)
      return this.error(res, 503, 'authority_unavailable', 'Prompt authority unavailable');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      prompt: buildPromptCatalogDetail(prompt),
      current_version: numberField(history, 'current_version'),
    });
  }

  private async history(req: Request, res: Response): Promise<void> {
    const id = this.decodeId(req, res);
    if (id === null) return;
    const query = historyQuerySchema.safeParse(req.query);
    if (!query.success) return this.invalid(res, query.error);
    await this.respondWithAction(res, {
      resource_type: 'prompt',
      action: 'history',
      id,
      limit: query.data.limit,
    });
  }

  private async compare(req: Request, res: Response): Promise<void> {
    const id = this.decodeId(req, res);
    if (id === null) return;
    const query = compareQuerySchema.safeParse(req.query);
    if (!query.success) return this.invalid(res, query.error);
    await this.respondWithAction(res, {
      resource_type: 'prompt',
      action: 'compare',
      id,
      ...query.data,
    });
  }

  /**
   * Render what `apply` would write, without writing it.
   *
   * Route and method renamed from `dry-run` when the tool parameter behind them was replaced by
   * `action: 'preview'` (P2.2). Leaving the HTTP path on the old spelling would have kept the
   * removed vocabulary alive on the one surface an operator reads most often.
   */
  private async preview(req: Request, res: Response): Promise<void> {
    const id = this.decodeId(req, res);
    if (id === null) return;
    const body = previewSchema.safeParse(req.body);
    if (!body.success) return this.invalid(res, body.error);
    await this.respondWithAction(res, {
      resource_type: 'prompt',
      action: 'preview',
      preview_action: 'update',
      id,
      ...body.data,
    });
  }

  private async apply(req: Request, res: Response): Promise<void> {
    const id = this.decodeId(req, res);
    if (id === null) return;
    const body = applySchema.safeParse(req.body);
    if (!body.success) return this.invalid(res, body.error);
    const { confirmed: _confirmed, ...mutation } = body.data;
    await this.respondWithAction(res, {
      resource_type: 'prompt',
      action: 'update',
      id,
      ...mutation,
    });
  }

  private async rollback(req: Request, res: Response): Promise<void> {
    const id = this.decodeId(req, res);
    if (id === null) return;
    const body = rollbackSchema.safeParse(req.body);
    if (!body.success) return this.invalid(res, body.error);
    const current = await this.run({ resource_type: 'prompt', action: 'history', id, limit: 1 });
    if (current === null)
      return this.error(res, 503, 'authority_unavailable', 'Prompt authority unavailable');
    if (numberField(current, 'current_version') !== body.data.expected_version) {
      return this.error(res, 409, 'conflict', 'Prompt revision changed; refresh before retrying');
    }
    await this.respondWithAction(res, {
      resource_type: 'prompt',
      action: 'rollback',
      id,
      version: body.data.version,
      confirm: true,
    });
  }

  private async respondWithAction(res: Response, input: ResourceManagerInput): Promise<void> {
    const result = await this.runResponse(input);
    if (result === null)
      return this.error(res, 503, 'authority_unavailable', 'Prompt authority unavailable');
    if (result.isError === true) {
      const conflict = result.structuredContent?.['conflict'] === true;
      return this.error(
        res,
        conflict ? 409 : 422,
        conflict ? 'conflict' : 'rejected',
        conflict ? 'Prompt revision changed; refresh before retrying' : 'Prompt operation rejected'
      );
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(result.structuredContent ?? { action: input.action, completed: true });
  }

  private async run(input: ResourceManagerInput): Promise<Record<string, unknown> | null> {
    const response = await this.runResponse(input);
    return response?.structuredContent ?? null;
  }

  private async runResponse(input: ResourceManagerInput): Promise<ToolResponse | null> {
    try {
      return await this.dependencies.runAction(input);
    } catch (error) {
      this.dependencies.logger.error('Prompt authority action failed', {
        action: input.action,
        id: input.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private decodeId(req: Request, res: Response): string | null {
    const raw = req.params['promptId'];
    const parsed = promptIdSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
    if (!parsed.success) {
      this.invalid(res, parsed.error);
      return null;
    }
    return parsed.data;
  }

  private invalid(res: Response, error: z.ZodError): void {
    this.dependencies.logger.warn('Prompt authority request rejected', {
      fields: error.issues.map((issue) => issue.path.join('.')),
    });
    this.error(res, 400, 'bad_request', 'Request validation failed');
  }

  private error(res: Response, status: number, code: string, message: string): void {
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({ error: { code, message } });
  }
}

function numberField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : 0;
}
