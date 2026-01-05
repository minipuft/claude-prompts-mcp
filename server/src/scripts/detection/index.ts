// @lifecycle canonical - Barrel exports for scripts/detection module.
/**
 * Script Tools Detection Module
 *
 * Contains the smart detection service for matching user input to tools.
 */

export {
  ToolDetectionService,
  createToolDetectionService,
  getDefaultToolDetectionService,
  resetDefaultToolDetectionService,
  type ToolDetectionConfig,
} from './tool-detection-service.js';
