/**
 * Lightweight Gate Definition Schema
 *
 * Provides runtime validation for gate definitions loaded from disk.
 * Permissive to avoid rejecting legacy fields but enforces required keys.
 */
import { type SchemaValidationResult } from '../../utils/schema-validator.js';
import type { LightweightGateDefinition } from '../types.js';
export declare function validateLightweightGateDefinition(value: unknown): SchemaValidationResult<LightweightGateDefinition>;
