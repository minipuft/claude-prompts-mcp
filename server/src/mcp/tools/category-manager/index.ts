// @lifecycle canonical - Category tool handler MCP entrypoint for category CRUD operations.
/**
 * Category Tool Handler MCP Tool
 *
 * Thin routing layer for prompt-category lifecycle management.
 * Domain logic delegated to services:
 * - CategoryLifecycleProcessor: create, update, delete, reload
 * - CategoryDiscoveryProcessor: list, inspect
 * - CategoryVersioningProcessor: history, rollback, compare
 * - CategoryFileWriter: `category.yaml` I/O with transactions and write-time validation
 *
 * Deliberately narrower than the gate and framework entrypoints, and there is no
 * `services/index.ts` barrel beside the four services above. Everything else in this module is
 * reached by its defining path, which is what CLAUDE.md §Module organization asks for; a barrel
 * re-exporting names nobody imports through it is dead surface `npx knip` has to be told to
 * ignore. The input and dependency types live in `core/types.js` and every consumer imports them
 * from there.
 */

export { CategoryToolHandler, createCategoryToolHandler } from './core/manager.js';
