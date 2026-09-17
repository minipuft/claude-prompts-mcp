// @lifecycle canonical - Framework and style overlay resolution for tool descriptions.
/**
 * Tool Description Overlays
 *
 * Pure functions for preloading framework/style descriptions and composing them onto the
 * contract's tool descriptions. No class state — all dependencies passed as parameters.
 *
 * Extracted from ToolDescriptionLoader to separate overlay resolution from
 * base description loading and event management.
 *
 * COMPOSITION, NOT REPLACEMENT. A framework's `toolDescriptions` entry is guidance appended
 * after the contract's own text; it can no longer stand in for it. The contract
 * (`tooling/contracts/*.json`) owns every fact a client needs to call a tool correctly — the
 * action list, the resource types, the syntax. When a framework's text replaced the contract's,
 * each framework carried its own copy of those facts, and nothing updated the copies: measured
 * 2026-09-16, four bundled frameworks described `resource_manager` with 7 of its 15 actions,
 * CAGEERF (the default) among them. `validate:framework-tool-descriptions` checks that the
 * guidance restates none of those lists and that {@link composeToolDescription} keeps the
 * contract text first.
 */

import type {
  FrameworkToolDescription,
  FrameworkToolDescriptions,
} from '#engine/frameworks/types/index.js';
import type { StyleToolDescriptionYaml } from '#modules/formatting/core/style-schema.js';
import type {
  Logger,
  ToolDescription,
  ToolDescriptionsConfig,
  ToolParameter,
} from '#shared/types/index.js';

import {
  getDefaultRuntimeLoader,
  createGenericGuide,
} from '#engine/frameworks/definitions/index.js';
import { getDefaultStyleDefinitionLoader } from '#modules/formatting/core/style-definition-loader.js';

/**
 * One framework's tool guidance, with the name it is shown under.
 *
 * `label` is the framework's `type` (e.g. `CAGEERF`, `ReACT`) — the spelling a client types after
 * `@`/`^` — so the server, not each framework's prose, decides how the guidance is introduced.
 */
export interface FrameworkToolOverlay {
  label: string;
  tools: FrameworkToolDescriptions;
}

/**
 * Normalize framework keys for consistent lookup (case-insensitive)
 */
export function normalizeFrameworkKey(framework?: string): string | undefined {
  if (!framework) return undefined;
  return framework.trim().toUpperCase();
}

/**
 * Deep-clone a ToolDescription to prevent shared-reference mutation.
 */
export function cloneToolDescription(description: ToolDescription): ToolDescription {
  const cloned: ToolDescription = { ...description };

  if (description.parameters) {
    cloned.parameters = { ...description.parameters };
  }

  return cloned;
}

/** The text of a parameter entry, whichever of its two shapes it was declared in. */
export function parameterText(parameter: ToolParameter | string | undefined): string | undefined {
  return typeof parameter === 'string' ? parameter : parameter?.description;
}

/**
 * Append a framework's guidance to contract text under the server-owned label.
 *
 * Empty guidance leaves the contract text untouched, so a framework that says nothing for a tool
 * serves exactly what a framework-less server serves.
 */
function appendFrameworkGuidance(
  contractText: string,
  label: string,
  guidance: string | undefined
): string {
  const trimmed = guidance?.trim();
  if (!trimmed) return contractText;
  const heading = `ACTIVE FRAMEWORK [${label}]: ${trimmed}`;
  return contractText ? `${contractText.trimEnd()}\n\n${heading}` : heading;
}

/**
 * The description a client sees for one tool: the contract's text, then the framework's guidance,
 * then any response-format guidance. The contract text always comes first and is never altered.
 */
export function composeToolDescription(
  contractText: string,
  overlay: FrameworkToolDescription | undefined,
  label: string
): string {
  const withGuidance = appendFrameworkGuidance(contractText, label, overlay?.description);
  return overlay?.responseFormat
    ? weaveResponseFormat(withGuidance, overlay.responseFormat)
    : withGuidance;
}

/**
 * The description a client sees for one parameter: the contract's text, then the framework's
 * guidance for that parameter.
 */
export function composeParameterDescription(
  contractText: string | undefined,
  overlay: FrameworkToolDescription | undefined,
  parameterName: string,
  label: string
): string | undefined {
  const guidance = parameterText(overlay?.parameters?.[parameterName]);
  if (contractText === undefined && !guidance?.trim()) return undefined;
  return appendFrameworkGuidance(contractText ?? '', label, guidance);
}

/**
 * Pre-load all framework tool descriptions from YAML definitions.
 * Returns a Map keyed by normalized framework type AND id.
 */
export function preloadFrameworkDescriptions(logger: Logger): Map<string, FrameworkToolOverlay> {
  const result = new Map<string, FrameworkToolOverlay>();

  try {
    const loader = getDefaultRuntimeLoader();
    const frameworkIds = loader.discoverFrameworks();

    for (const id of frameworkIds) {
      const definition = loader.loadFramework(id);
      if (!definition) continue;

      const guide = createGenericGuide(definition);
      const overlay: FrameworkToolOverlay = {
        label: guide.type || guide.frameworkId,
        tools: guide.getToolDescriptions?.() || {},
      };
      // Each guide is registered under BOTH its type and its id, so a later lookup succeeds
      // whichever of the two the caller happens to hold.
      const typeKey = normalizeFrameworkKey(guide.type);
      const idKey = normalizeFrameworkKey(guide.frameworkId);

      if (typeKey) {
        result.set(typeKey, overlay);
      }

      if (idKey) {
        result.set(idKey, overlay);
      }
    }

    logger.info(`Pre-loaded tool descriptions for ${result.size} frameworks from YAML (SOT)`);
  } catch (error) {
    logger.error(
      `Failed to pre-load framework descriptions: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return result;
}

/**
 * Pre-load style tool descriptions for responseFormat overlay.
 * Returns a Map keyed by lowercase style ID.
 */
export function preloadStyleDescriptions(
  logger: Logger
): Map<string, Record<string, StyleToolDescriptionYaml>> {
  const result = new Map<string, Record<string, StyleToolDescriptionYaml>>();

  try {
    const loader = getDefaultStyleDefinitionLoader();
    const styleIds = loader.discoverStyles();

    for (const id of styleIds) {
      const definition = loader.loadStyle(id);
      const toolDescs = definition?.toolDescriptions;
      if (toolDescs == null) continue;
      result.set(id.toLowerCase(), toolDescs);
    }

    logger.info(`Pre-loaded tool descriptions for ${result.size} styles from YAML`);
  } catch (error) {
    logger.error(
      `Failed to pre-load style descriptions: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return result;
}

/**
 * Weave responseFormat guidance into tool description text.
 * Appended as a dedicated section so the LLM reads it before invocation.
 */
export function weaveResponseFormat(description: string, responseFormat: string): string {
  if (description.includes(responseFormat)) {
    return description;
  }
  return `${description}\n\n**Response Format:** ${responseFormat}`;
}

/**
 * Compose one tool's contract entry with a framework overlay, description and parameters alike.
 */
function composeToolEntry(
  contractEntry: ToolDescription,
  toolName: string,
  framework: FrameworkToolOverlay | undefined
): ToolDescription {
  const composed = cloneToolDescription(contractEntry);
  const overlay = framework?.tools[toolName as keyof FrameworkToolDescriptions];
  if (!framework || !overlay) return composed;

  composed.description = composeToolDescription(
    contractEntry.description,
    overlay,
    framework.label
  );

  const parameterNames = new Set([
    ...Object.keys(contractEntry.parameters ?? {}),
    ...Object.keys(overlay.parameters ?? {}),
  ]);
  const parameters: Record<string, ToolParameter | string> = {};
  for (const name of parameterNames) {
    const contractParameter = contractEntry.parameters?.[name];
    const text = composeParameterDescription(
      parameterText(contractParameter),
      overlay,
      name,
      framework.label
    );
    if (text === undefined) continue;
    parameters[name] =
      typeof contractParameter === 'object' ? { ...contractParameter, description: text } : text;
  }
  composed.parameters = parameters;

  return composed;
}

/**
 * Build active tool description config by composing framework overlays onto the base config.
 */
export function buildActiveConfig(
  baseConfig: ToolDescriptionsConfig,
  activeContext: {
    activeFramework?: string;
    activeFrameworkType?: string;
    frameworkSystemEnabled?: boolean;
  },
  frameworkDescriptions: Map<string, FrameworkToolOverlay>,
  dynamicDescriptionsEnabled: boolean
): ToolDescriptionsConfig {
  const frameworkKey = normalizeFrameworkKey(
    activeContext.activeFrameworkType ?? activeContext.activeFramework
  );
  const framework =
    dynamicDescriptionsEnabled && frameworkKey
      ? frameworkDescriptions.get(frameworkKey)
      : undefined;

  const tools: Record<string, ToolDescription> = {};
  for (const [name, description] of Object.entries(baseConfig.tools)) {
    tools[name] = composeToolEntry(description, name, framework);
  }

  const generatedConfig: ToolDescriptionsConfig = {
    ...baseConfig,
    tools,
    generatedAt: new Date().toISOString(),
    generatedFrom: baseConfig.generatedFrom ?? 'contracts',
  };

  if (activeContext.activeFramework) {
    generatedConfig.activeFramework = activeContext.activeFramework;
  }
  if (activeContext.activeFrameworkType) {
    generatedConfig.activeFrameworkType = activeContext.activeFrameworkType;
  }

  return generatedConfig;
}
