import type { ToolMetadata, SystemControlMetadataData } from './types.js';
export declare const SYSTEM_CONTROL_ACTION_IDS: readonly ["status", "framework", "gates", "analytics", "config", "maintenance", "guide", "injection", "session"];
export type SystemControlActionId = (typeof SYSTEM_CONTROL_ACTION_IDS)[number];
export declare const systemControlMetadata: ToolMetadata<SystemControlMetadataData>;
