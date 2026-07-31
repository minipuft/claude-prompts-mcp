// @lifecycle canonical - Framework and style overlay resolution for tool descriptions.
/**
 * Tool Description Overlays
 *
 * Pure functions for preloading framework/style descriptions and building
 * overlay-applied tool description configs. No class state — all dependencies
 * passed as parameters.
 *
 * Extracted from ToolDescriptionLoader to separate overlay resolution from
 * base description loading and event management.
 */

import {
  getDefaultRuntimeLoader,
  createGenericGuide,
} from '../../engine/frameworks/definitions/index.js';
import { getDefaultStyleDefinitionLoader } from '../../modules/formatting/core/style-definition-loader.js';

import type { FrameworkToolDescriptions } from '../../engine/frameworks/types/index.js';
import type { StyleToolDescriptionYaml } from '../../modules/formatting/core/style-schema.js';
import type { Logger, ToolDescription, ToolDescriptionsConfig } from '../../shared/types/index.js';

/**
 * Normalize framework keys for consistent lookup (case-insensitive)
 */
export function normalizeFrameworkKey(methodology?: string): string | undefined {
  if (!methodology) return undefined;
  return methodology.trim().toUpperCase();
}

/**
 * Deep-clone a ToolDescription to prevent shared-reference mutation.
 */
export function cloneToolDescription(description: ToolDescription): ToolDescription {
  const cloned: ToolDescription = { ...description };

  if (description.parameters) {
    cloned.parameters = { ...description.parameters };
  }

  if (description.frameworkAware) {
    const frameworkAware = { ...description.frameworkAware };

    if (description.frameworkAware.methodologies) {
      frameworkAware.methodologies = { ...description.frameworkAware.methodologies };
    }
    if (description.frameworkAware.parametersEnabled) {
      frameworkAware.parametersEnabled = { ...description.frameworkAware.parametersEnabled };
    }
    if (description.frameworkAware.parametersDisabled) {
      frameworkAware.parametersDisabled = { ...description.frameworkAware.parametersDisabled };
    }
    if (description.frameworkAware.frameworkParameters) {
      frameworkAware.frameworkParameters = {
        ...description.frameworkAware.frameworkParameters,
      };
    }

    cloned.frameworkAware = frameworkAware;
  }

  return cloned;
}

/**
 * Pre-load all framework tool descriptions from YAML definitions.
 * Returns a Map keyed by normalized framework ID.
 */
export function preloadFrameworkDescriptions(
  logger: Logger
): Map<string, FrameworkToolDescriptions> {
  const result = new Map<string, FrameworkToolDescriptions>();

  try {
    const loader = getDefaultRuntimeLoader();
    const frameworkIds = loader.discoverFrameworks();

    for (const id of frameworkIds) {
      const definition = loader.loadFramework(id);
      if (!definition) continue;

      const guide = createGenericGuide(definition);
      const descriptions = guide.getToolDescriptions?.() || {};
      // Each guide is registered under BOTH its type and its id, so a later lookup succeeds
      // whichever of the two the caller happens to hold.
      const typeKey = normalizeFrameworkKey(guide.type);
      const idKey = normalizeFrameworkKey(guide.frameworkId);

      if (typeKey) {
        result.set(typeKey, descriptions);
      }

      if (idKey) {
        result.set(idKey, descriptions);
      }
    }

    logger.info(`Pre-loaded tool descriptions for ${result.size} methodologies from YAML (SOT)`);
  } catch (error) {
    logger.error(
      `Failed to pre-load methodology descriptions: ${error instanceof Error ? error.message : String(error)}`
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
 * Build active tool description config by applying framework overlays to base config.
 */
export function buildActiveConfig(
  baseConfig: ToolDescriptionsConfig,
  activeContext: {
    activeFramework?: string;
    activeFrameworkType?: string;
    frameworkSystemEnabled?: boolean;
  },
  frameworkDescriptions: Map<string, FrameworkToolDescriptions>,
  dynamicDescriptionsEnabled: boolean
): ToolDescriptionsConfig {
  const frameworkKey = normalizeFrameworkKey(
    activeContext.activeFrameworkType ?? activeContext.activeFramework
  );

  const tools: Record<string, ToolDescription> = {};
  for (const [name, description] of Object.entries(baseConfig.tools)) {
    const baseDescription = cloneToolDescription(description);

    if (dynamicDescriptionsEnabled && frameworkKey) {
      const frameworkDescs = frameworkDescriptions.get(frameworkKey);
      const frameworkTool = frameworkDescs?.[name as keyof FrameworkToolDescriptions] || undefined;

      if (frameworkTool?.description) {
        baseDescription.description = frameworkTool.description;
      }

      if (frameworkTool?.parameters) {
        baseDescription.parameters = {
          ...baseDescription.parameters,
          ...frameworkTool.parameters,
        };
      }

      if (frameworkTool?.responseFormat) {
        baseDescription.description = weaveResponseFormat(
          baseDescription.description,
          frameworkTool.responseFormat
        );
      }
    }

    tools[name] = baseDescription;
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
