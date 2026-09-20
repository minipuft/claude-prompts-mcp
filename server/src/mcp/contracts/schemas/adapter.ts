// @lifecycle canonical - Adapters to build metadata descriptors from SSOT contracts.
/**
 * Contract Adapters
 *
 * Utilities to convert SSOT tool contracts into shapes used by action-metadata
 * and (optionally) tool registration. Kept standalone so runtime integration
 * can opt in incrementally without touching existing hand-written descriptors.
 */
import type { ToolContract, ParameterDefinition } from './types.js';
import type { ParameterDescriptor, CommandDescriptor } from '../../metadata/definitions/types.js';

// Map SSOT status to action-metadata status vocabulary.
function mapStatus(status: ParameterDefinition['status']): ParameterDescriptor<string>['status'] {
  if (status === 'deprecated') return 'deprecated';
  if (status === 'hidden') return 'hidden';
  if (status === 'needs-validation') return 'needs-validation';
  if (status === 'experimental') return 'experimental';
  return 'working';
}

/**
 * Convert SSOT parameters to action-metadata parameter descriptors.
 */
export function contractToParameterDescriptors<TParam extends string>(
  contract: ToolContract
): ParameterDescriptor<TParam>[] {
  return contract.parameters
    .filter((param) => param.status !== 'hidden')
    .map((param) => ({
      name: param.name as TParam,
      status: mapStatus(param.status),
      description: param.description,
    }));
}

/**
 * Convert SSOT commands to action-metadata command descriptors.
 */
export function contractToCommandDescriptors(contract: ToolContract): CommandDescriptor[] {
  return (contract.commands ?? []).map((cmd) => ({
    id: cmd.id,
    status: mapStatus(cmd.status ?? 'working'),
    description: cmd.summary,
    issues: [],
  }));
}
