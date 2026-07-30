// @lifecycle canonical - Methodology and style overlay resolution for tool descriptions.
/**
 * Tool Description Overlays
 *
 * Pure functions for preloading methodology/style descriptions and building
 * overlay-applied tool description configs. No class state — all dependencies
 * passed as parameters.
 *
 * Extracted from ToolDescriptionLoader to separate overlay resolution from
 * base description loading and event management.
 */

import {
  getDefaultRuntimeLoader,
  createGenericGuide,
} from '../../engine/frameworks/methodology/index.js';
import { getDefaultStyleDefinitionLoader } from '../../modules/formatting/core/style-definition-loader.js';

import type { FrameworkToolDescriptions } from '../../engine/frameworks/types/index.js';
import type { StyleToolDescriptionYaml } from '../../modules/formatting/core/style-schema.js';
import type { Logger, ToolDescription, ToolDescriptionsConfig } from '../../shared/types/index.js';

/**
 * Normalize methodology keys for consistent lookup (case-insensitive)
 */
export function normalizeMethodologyKey(methodology?: string): string | undefined {
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
 * Pre-load all methodology tool descriptions from YAML definitions.
 * Returns a Map keyed by normalized methodology/framework ID.
 */
export function preloadMethodologyDescriptions(
  logger: Logger
): Map<string, FrameworkToolDescriptions> {
  const result = new Map<string, FrameworkToolDescriptions>();

  try {
    const loader = getDefaultRuntimeLoader();
    const methodologyIds = loader.discoverMethodologies();

    for (const id of methodologyIds) {
      const definition = loader.loadMethodology(id);
      if (!definition) continue;

      const guide = createGenericGuide(definition);
      const descriptions = guide.getToolDescriptions?.() || {};
      const methodologyKey = normalizeMethodologyKey(guide.type);
      const frameworkKey = normalizeMethodologyKey(guide.frameworkId);

      if (methodologyKey) {
        result.set(methodologyKey, descriptions);
      }

      if (frameworkKey) {
        result.set(frameworkKey, descriptions);
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
 * Build active tool description config by applying methodology overlays to base config.
 */
export function buildActiveConfig(
  baseConfig: ToolDescriptionsConfig,
  activeContext: {
    activeFramework?: string;
    activeMethodology?: string;
    frameworkSystemEnabled?: boolean;
  },
  frameworkDescriptions: Map<string, FrameworkToolDescriptions>,
  dynamicDescriptionsEnabled: boolean
): ToolDescriptionsConfig {
  const methodologyKey = normalizeMethodologyKey(
    activeContext.activeMethodology ?? activeContext.activeFramework
  );

  const tools: Record<string, ToolDescription> = {};
  for (const [name, description] of Object.entries(baseConfig.tools)) {
    const baseDescription = cloneToolDescription(description);

    if (dynamicDescriptionsEnabled && methodologyKey) {
      const frameworkDescs = frameworkDescriptions.get(methodologyKey);
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
  if (activeContext.activeMethodology) {
    generatedConfig.activeMethodology = activeContext.activeMethodology;
  }

  return generatedConfig;
}
