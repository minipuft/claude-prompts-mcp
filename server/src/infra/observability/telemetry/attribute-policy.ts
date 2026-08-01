// @lifecycle canonical - Attribute allowlist, redaction, and cardinality enforcement for telemetry.
/**
 * Attribute Policy Enforcer
 *
 * Enforces acceptance criteria #3 (no high-cardinality IDs in metric labels)
 * and #4 (no raw payload data in default telemetry attributes/events).
 *
 * Architecture: OOP shell (class with DI) + FP internals (pure filter/map functions).
 */

import { EXCLUDED_ATTRIBUTES, SAFE_BUSINESS_ATTRIBUTES } from './types.js';

import type { TelemetryAttributePolicy } from '#shared/types/index.js';
import type { Attributes, AttributeValue } from '@opentelemetry/api';

// ===== Pure Functions =====

/**
 * Determine if an attribute key is in the always-excluded set.
 * These contain raw commands, responses, prompt bodies, etc.
 */
function isExcludedAttribute(key: string): boolean {
  return (EXCLUDED_ATTRIBUTES as readonly string[]).includes(key);
}

/**
 * Determine if an attribute key is in the safe business-context set.
 */
function isSafeBusinessAttribute(key: string): boolean {
  return (SAFE_BUSINESS_ATTRIBUTES as readonly string[]).includes(key);
}

/**
 * Determine if an attribute key is in the custom allowlist.
 */
function isInCustomAllowlist(key: string, allowlist: string[] | undefined): boolean {
  if (!allowlist || allowlist.length === 0) return false;
  return allowlist.includes(key);
}

/**
 * Coerce a value to a safe OTel attribute value.
 * OTel attributes support: string, number, boolean, and arrays thereof.
 */
function toSafeAttributeValue(value: unknown): AttributeValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    // OTel supports homogeneous arrays of primitives
    if (value.every((v) => typeof v === 'string')) return value;
    if (value.every((v) => typeof v === 'number')) return value;
    if (value.every((v) => typeof v === 'boolean')) return value;
    // Mixed arrays: stringify
    return value.map(String);
  }
  // Objects: stringify
  return String(value);
}

/**
 * Redact a value — replaces with a redaction marker.
 * Used for attributes that exist but should not carry raw content.
 */
function redact(): string {
  return '[REDACTED]';
}

// ===== Service Class =====

/**
 * Enforces attribute policy rules for all telemetry emission.
 *
 * Rules:
 * 1. Excluded attributes are ALWAYS removed (raw payloads).
 * 2. Business-context attributes pass if policy.businessContext is true.
 * 3. Custom allowlist attributes pass regardless of business-context flag.
 * 4. `cpm.command.raw` passes ONLY if policy.rawCommands is explicitly true.
 * 5. `cpm.user_response.raw` passes ONLY if policy.rawResponses is explicitly true.
 * 6. Unknown `cpm.*` attributes are dropped by default.
 * 7. Non-`cpm.*` attributes (OTel semantic conventions) pass through.
 */
export class AttributePolicyEnforcer {
  private readonly policy: TelemetryAttributePolicy;

  constructor(policy: TelemetryAttributePolicy) {
    this.policy = policy;
  }

  /**
   * Filter and sanitize attributes according to the active policy.
   * Returns a new object — does not mutate input.
   */
  sanitize(attrs: Record<string, unknown>): Attributes {
    const result: Attributes = {};

    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined) continue;

      const safeValue = this.evaluateAttribute(key, value);
      if (safeValue !== undefined) {
        result[key] = safeValue;
      }
    }

    return result;
  }

  /**
   * Check if a single attribute key would be allowed by the current policy.
   */
  isAllowed(key: string): boolean {
    return this.evaluateAttribute(key, 'probe') !== undefined;
  }

  // ===== Private Pure Methods =====

  /**
   * Evaluate a single attribute against policy rules.
   * Returns the safe value, or undefined if the attribute should be dropped.
   */
  private evaluateAttribute(key: string, value: unknown): AttributeValue | undefined {
    // Rule 7: Non-cpm attributes (OTel conventions like http.*, rpc.*) pass through
    if (!key.startsWith('cpm.')) {
      return toSafeAttributeValue(value);
    }

    // Rule 4: Raw command text — only if explicitly enabled
    if (key === 'cpm.command.raw') {
      return this.policy.rawCommands === true ? toSafeAttributeValue(value) : undefined;
    }

    // Rule 5: Raw user response — only if explicitly enabled
    if (key === 'cpm.user_response.raw') {
      return this.policy.rawResponses === true ? toSafeAttributeValue(value) : undefined;
    }

    // Rule 1: Always-excluded attributes (prompt bodies, model output, etc.)
    if (isExcludedAttribute(key)) {
      return undefined;
    }

    // Rule 3: Custom allowlist takes priority over business-context flag
    if (isInCustomAllowlist(key, this.policy.allowlist)) {
      return toSafeAttributeValue(value);
    }

    // Rule 2: Safe business-context attributes
    if (isSafeBusinessAttribute(key)) {
      return this.policy.businessContext !== false ? toSafeAttributeValue(value) : undefined;
    }

    // Rule 6: Unknown cpm.* attributes — drop by default
    return undefined;
  }
}

/**
 * Build a redacted copy of attributes for diagnostic/debug output.
 * Replaces sensitive values with [REDACTED] instead of dropping them.
 */
export function redactAttributes(attrs: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (isExcludedAttribute(key)) {
      result[key] = redact();
    } else {
      result[key] = String(value);
    }
  }
  return result;
}
