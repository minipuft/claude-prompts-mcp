/**
 * Contract Adapters
 *
 * Utilities to convert SSOT tool contracts into shapes used by action-metadata
 * and (optionally) tool registration. Kept standalone so runtime integration
 * can opt in incrementally without touching existing hand-written descriptors.
 */
import { z } from 'zod';
import type { ToolContract } from './types.js';
import type { ParameterDescriptor, CommandDescriptor } from '../action-metadata/definitions/types.js';
/**
 * Convert SSOT parameters to action-metadata parameter descriptors.
 */
export declare function contractToParameterDescriptors<TParam extends string>(contract: ToolContract): ParameterDescriptor<TParam>[];
/**
 * Convert SSOT commands to action-metadata command descriptors.
 */
export declare function contractToCommandDescriptors(contract: ToolContract): CommandDescriptor[];
/**
 * Build a Zod object schema from a contract. This is intentionally conservative
 * and handles the common primitive/enumerated shapes used in tool inputs.
 */
export declare function contractToZodObject(contract: ToolContract): z.ZodObject<Record<string, z.ZodTypeAny>>;
