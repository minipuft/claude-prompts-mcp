// @lifecycle canonical - Category read-only operations: list, inspect.
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { CATEGORY_YAML_FILENAME, readCategoryYamlDocument } from './category-file-writer.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { CategoryResourceContext } from '../core/context.js';
import type { CategoryManagerInput } from '../core/types.js';

import {
  discoverCategoryDirectories,
  discoverYamlPromptsInCategory,
} from '#modules/prompts/category-maintenance.js';

/** One contributing prompt root, in the precedence order the catalog loader applies. */
interface CategoryRoot {
  readonly path: string;
  readonly label: 'bundled' | 'primary' | 'overlay';
}

/** What one category looks like once every root has been walked. */
interface CategoryView {
  readonly id: string;
  /** The root whose declaration wins, or `undefined` when no root declares one. */
  readonly declaringRoot: string | undefined;
  readonly declarationPath: string | undefined;
  /** Prompt count across every root that holds this category. */
  readonly promptCount: number;
  /** Every root holding a directory for this id, lowest precedence first. */
  readonly roots: readonly string[];
}

export class CategoryDiscoveryProcessor {
  constructor(private readonly ctx: CategoryResourceContext) {}

  async handleList(_args: CategoryManagerInput): Promise<ToolResponse> {
    const views = this.collectViews();

    if (views.length === 0) {
      return this.success(
        `📋 No categories found\n\n` +
          `Use resource_manager(resource_type:"category", action:"create", ...) to add one.`
      );
    }

    const declared = views.filter((view) => view.declarationPath !== undefined).length;
    const lines = views
      .map((view) => {
        // `📄` vs `📁` is the only distinction this listing makes, and it is the one that
        // matters: whether the category's name and description are AUTHORED or derived from its
        // directory name. A count of prompts says nothing about that.
        const icon = view.declarationPath !== undefined ? '📄' : '📁';
        const suffix =
          view.declarationPath !== undefined
            ? ''
            : ` — no ${CATEGORY_YAML_FILENAME}; name and description derived from the id`;
        return `  ${icon} ${view.id} (${view.promptCount} prompt(s))${suffix}`;
      })
      .join('\n');

    return this.success(
      `📋 Categories (${views.length} total)\n\n` +
        `${lines}\n\n` +
        `📊 ${declared} declare a ${CATEGORY_YAML_FILENAME}; ${views.length - declared} do not.\n` +
        `Writable root: ${this.writableRoot()}`
    );
  }

  async handleInspect(args: CategoryManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (id === undefined || id.length === 0) {
      return this.error('Category ID is required for inspect action');
    }

    const view = this.collectViews().find((candidate) => candidate.id === id);
    if (view === undefined) {
      return this.error(`Category '${id}' not found`);
    }

    const declared =
      view.declarationPath !== undefined
        ? await readCategoryYamlDocument(view.declarationPath, this.ctx.logger)
        : undefined;

    // P4.11 — every field below is read from the DOCUMENT and rendered only when the document
    // declares it. The loaded `Category` cannot be the source: `loader.ts` resolves `name` to
    // `formatCategoryName(id)` and `description` to `Prompts in the <id> category` when the file
    // declares neither, and `registerWithMcp`/`mcpPromptMode` to global defaults — so the loaded
    // object can never distinguish an authored value from a derived one, and an `inspect` built
    // on it would report defaults as though someone had chosen them.
    const detail = [
      `  - ID: ${view.id}`,
      `  - Prompts: ${view.promptCount}`,
      `  - Roots: ${view.roots.join(', ')}`,
      ...this.describeDeclaration(view, declared),
    ];

    return this.success(`🗂️ Category: ${view.id}\n\n📋 Details:\n${detail.join('\n')}`);
  }

  private describeDeclaration(
    view: CategoryView,
    declared: Record<string, unknown> | undefined
  ): string[] {
    if (declared === undefined) {
      return [
        `  - Declaration: none`,
        `  - Name and description are DERIVED from the directory name at load; nothing is ` +
          `authored. Use action:"create" to declare them.`,
      ];
    }

    const lines = [`  - Declaration: ${view.declarationPath}`];

    // A divergence the loader cannot report and an operator cannot otherwise see: the catalog
    // names a category by its DIRECTORY and never reads the `id` key, so a file declaring another
    // id is served under a name it does not claim. `validateCategorySchema` refuses it on write;
    // a hand-authored file that predates the writer reaches here instead.
    const declaredId = declared['id'];
    if (typeof declaredId === 'string' && declaredId !== view.id) {
      lines.push(
        `  - ⚠️ The file declares id '${declaredId}', which is not the directory name. The ` +
          `loader uses the directory, so this category is served as '${view.id}'.`
      );
    }

    if (view.declaringRoot !== undefined && view.declaringRoot !== this.writableRoot()) {
      lines.push(
        `  - Source Root: ${view.declaringRoot} (read-only here) — an update writes your own ` +
          `copy under ${this.writableRoot()}, which then takes precedence`
      );
    }

    for (const [key, label] of [
      ['name', 'Name'],
      ['description', 'Description'],
      ['registerWithMcp', 'Register With MCP'],
      ['mcpPromptMode', 'MCP Prompt Mode'],
    ] as const) {
      const value = declared[key];
      if (value !== undefined && value !== null) {
        lines.push(`  - ${label}: ${String(value)}`);
      }
    }

    return lines;
  }

  private writableRoot(): string {
    return this.ctx.configManager.getResolvedPromptsDirectory();
  }

  /**
   * Every category across every contributing root, resolved by precedence.
   *
   * Reads the filesystem rather than the loaded `Category[]`, for the reason `handleInspect`
   * states: the loaded array has already substituted derived values for absent ones. It walks
   * the SAME root set the catalog loader does (`loadPromptsAcrossRoots`), in the same precedence
   * order, so a listing here and the served catalog cannot disagree about which categories exist.
   */
  private collectViews(): CategoryView[] {
    const primary = this.writableRoot();
    const bundled = this.ctx.configManager.getBundledResourceDirectory('prompts');

    // Lowest precedence first, so a later root's declaration simply overwrites the recorded one.
    const roots: CategoryRoot[] = [];
    if (bundled !== undefined && path.resolve(bundled) !== path.resolve(primary)) {
      roots.push({ path: bundled, label: 'bundled' });
    }
    roots.push({ path: primary, label: 'primary' });
    for (const overlay of this.ctx.configManager.getOverlayResourceDirectories(
      'prompts',
      primary
    )) {
      roots.push({ path: overlay, label: 'overlay' });
    }

    const byId = new Map<string, { view: CategoryView; promptCount: number }>();

    for (const root of roots) {
      for (const id of discoverCategoryDirectories(root.path)) {
        const categoryDir = path.join(root.path, id);
        const yamlPath = path.join(categoryDir, CATEGORY_YAML_FILENAME);
        const declares = existsSync(yamlPath);
        const prompts = discoverYamlPromptsInCategory(categoryDir).length;
        const existing = byId.get(id);

        byId.set(id, {
          promptCount: (existing?.promptCount ?? 0) + prompts,
          view: {
            id,
            declaringRoot: declares ? root.path : existing?.view.declaringRoot,
            declarationPath: declares ? yamlPath : existing?.view.declarationPath,
            promptCount: 0,
            roots: [...(existing?.view.roots ?? []), root.path],
          },
        });
      }
    }

    return [...byId.values()]
      .map(({ view, promptCount }) => ({ ...view, promptCount }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private success(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: false };
  }

  private error(text: string): ToolResponse {
    return { content: [{ type: 'text', text: `❌ ${text}` }], isError: true };
  }
}
