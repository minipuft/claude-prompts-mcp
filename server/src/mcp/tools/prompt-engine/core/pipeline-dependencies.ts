// @lifecycle canonical - Typed dependency interface for PipelineBuilder.
/**
 * Typed dependency bag consumed by PipelineBuilder.
 *
 * Replaces lambda closures over PromptExecutor fields with an explicit,
 * typed interface. Direct values are immutable at build time; supplier
 * functions capture mutable state accessed during pipeline execution.
 */

import type { ChainSessionRouter } from './chain-session-router.js';
import type { ChainOperatorExecutor } from '../../../../engine/execution/operators/chain-operator-executor.js';
import type { ParsingSystem } from '../../../../engine/execution/parsers/index.js';
import type { ExecutionPlanner } from '../../../../engine/execution/planning/execution-planner.js';
import type { PromptReferenceResolver } from '../../../../engine/execution/reference/prompt-reference-resolver.js';
import type { ScriptReferenceResolver } from '../../../../engine/execution/reference/script-reference-resolver.js';
import type { ConvertedPrompt } from '../../../../engine/execution/types.js';
import type { FrameworkManager } from '../../../../engine/frameworks/framework-manager.js';
import type { FrameworkValidator } from '../../../../engine/frameworks/framework-validator.js';
import type { PromptGuidanceService } from '../../../../engine/frameworks/prompt-guidance/index.js';
import type { LightweightGateSystem } from '../../../../engine/gates/core/index.js';
import type { GateManager } from '../../../../engine/gates/gate-manager.js';
import type { GateGuidanceRenderer } from '../../../../engine/gates/guidance/GateGuidanceRenderer.js';
import type { GateReferenceResolver } from '../../../../engine/gates/services/gate-reference-resolver.js';
import type { ExecutionRecordStore } from '../../../../modules/chains/execution-record-store.js';
import type { StyleManager } from '../../../../modules/formatting/index.js';
import type {
  Logger,
  MetricsCollector,
  HookRegistryPort,
  McpNotificationEmitterPort,
  ToolResponse,
  ConfigManager,
  ChainSessionService,
} from '../../../../shared/types/index.js';
import type { ResponseFormatter } from '../processors/response-formatter.js';

/** Narrow view of McpToolsManager consumed by PipelineBuilder. */
export interface PipelineMcpToolsAccess {
  getResourceManagerHandler?: () =>
    | ((args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>)
    | null;
}

export interface PipelineDependencies {
  // ── Core Infrastructure ──
  logger: Logger;
  serverRoot: string;
  configManager: ConfigManager;

  // ── Parsing & Planning ──
  parsingSystem: ParsingSystem;
  executionPlanner: ExecutionPlanner;

  // ── Session Management ──
  chainSessionManager: ChainSessionService;
  chainSessionRouter: ChainSessionRouter | null;

  // ── Execution log (Tier 5) — null when DB not yet wired ──
  executionRecordStore: ExecutionRecordStore | null;

  // ── Gate System ──
  lightweightGateSystem: LightweightGateSystem;
  gateManager: GateManager;
  gateReferenceResolver: GateReferenceResolver;
  gateGuidanceRenderer: GateGuidanceRenderer;

  // ── Execution ──
  chainOperatorExecutor: ChainOperatorExecutor;
  responseFormatter: ResponseFormatter;
  referenceResolver: PromptReferenceResolver | undefined;
  scriptReferenceResolver: ScriptReferenceResolver | undefined;

  // ── Framework (optional, set via setters on PromptExecutor) ──
  frameworkManager: FrameworkManager | undefined;
  frameworkValidator: FrameworkValidator | null;
  promptGuidanceService: PromptGuidanceService | null;
  styleManager: StyleManager | null;

  // ── Optional Infrastructure ──
  hookRegistry: HookRegistryPort | undefined;
  notificationEmitter: McpNotificationEmitterPort | undefined;
  mcpToolsManager: PipelineMcpToolsAccess | undefined;

  // ── Suppliers for mutable state accessed during pipeline execution ──
  getFrameworkStateEnabled: () => boolean;
  getAnalyticsService: () => MetricsCollector | undefined;
  getConvertedPrompts: () => ConvertedPrompt[];

  // ── Tool routing callback ──
  routeToTool: (
    targetTool: string,
    params: Record<string, unknown>,
    originalCommand: string
  ) => Promise<ToolResponse>;
}
