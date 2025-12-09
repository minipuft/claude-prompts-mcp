// @lifecycle canonical - Utility helpers for identifying and validating chain prompts.
/**
 * Chain Utility Functions
 *
 * Provides helper functions for chain detection and validation.
 * MIGRATION: Simplified to support only markdown-embedded chains.
 * Modular chain functions are deprecated but maintained for compatibility.
 *
 *  of Chain System Migration (2025-01-30)
 */

import * as path from 'node:path';

import { ValidationError } from './errorHandling.js';
// REMOVED: All types from deleted chain-scaffolding.ts
// Modular chain system has been completely deprecated

const CHAIN_ID_PATTERN = /^[a-z0-9_-]+$/i;

function isPathInside(basePath: string, targetPath: string): boolean {
  const relative = path.relative(basePath, targetPath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function normalizeChainId(chainId: string): string {
  if (typeof chainId !== 'string') {
    throw new ValidationError('Chain ID must be a string');
  }

  const normalized = chainId.trim();

  if (normalized.length === 0) {
    throw new ValidationError('Chain ID is required');
  }

  if (!CHAIN_ID_PATTERN.test(normalized)) {
    throw new ValidationError(
      `Invalid chain ID "${normalized}": only letters, numbers, hyphen, and underscore are allowed`
    );
  }

  return normalized;
}

// ===== Utility-Specific Type Definitions =====
// Types used specifically by utility functions that don't exist in canonical chain types

/**
 * ChainStep interface for utility functions
 */
export interface ChainStep {
  promptId: string;
  stepName: string;
  executionType?: 'single' | 'chain';
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  dependencies?: string[];
}

// Import ConvertedPrompt from execution domain instead of redefining
import type { ConvertedPrompt } from '../execution/types.js';

/**
 * Determines if a prompt is a chain based on the presence of chain steps
 * Replaces the redundant isChain boolean property
 */
export function isChainPrompt(prompt: ConvertedPrompt): boolean {
  return (prompt.chainSteps?.length || 0) > 0;
}

/**
 * Get the number of steps in a chain prompt
 */
export function getChainStepCount(prompt: ConvertedPrompt): number {
  return prompt.chainSteps?.length || 0;
}

/**
 * Validate that chain steps are properly formed
 */
export function validateChainSteps(steps: ChainStep[]): boolean {
  if (!steps || steps.length === 0) {
    return false;
  }

  return steps.every(
    (step) =>
      step.promptId &&
      step.stepName &&
      typeof step.promptId === 'string' &&
      typeof step.stepName === 'string'
  );
}

/**
 * Check if a prompt has valid chain steps
 * Combines presence check with validation
 */
export function hasValidChainSteps(prompt: ConvertedPrompt): boolean {
  const steps = prompt.chainSteps;
  return steps ? validateChainSteps(steps) : false;
}

/**
 * Get chain information summary for a prompt
 */
export function getChainInfo(prompt: ConvertedPrompt): {
  isChain: boolean;
  stepCount: number;
  isValid: boolean;
} {
  const steps = prompt.chainSteps;
  return {
    isChain: isChainPrompt(prompt),
    stepCount: getChainStepCount(prompt),
    isValid: steps ? validateChainSteps(steps) : false,
  };
}

// ===== REMOVED: Modular Chain Detection and Management =====
// ChainType enum and detectChainType() function removed
// All chain detection now uses isChainPrompt() and chainSteps property

/**
 * Check if a prompt is a chain with valid steps (replaces legacy isMonolithicChain)
 */
export function isValidChain(prompt: ConvertedPrompt): boolean {
  return isChainPrompt(prompt) && hasValidChainSteps(prompt);
}

// Modular chain system fully removed
// All chain management now uses markdown-embedded chainSteps property
