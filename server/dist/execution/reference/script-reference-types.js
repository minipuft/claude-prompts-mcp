// @lifecycle canonical - Type definitions for inline script reference resolution.
/**
 * Script Reference Resolution Types
 *
 * Types for resolving {{script:id}} template references.
 * Enables inline script execution where templates can invoke
 * pre-registered scripts and inline their JSON output.
 *
 * Syntax variants:
 * - {{script:analyzer}}                 - Full JSON output
 * - {{script:analyzer.field}}           - Extract specific field
 * - {{script:analyzer key='value'}}     - Pass inline arguments
 */
/**
 * Default options for script reference resolution.
 */
export const DEFAULT_SCRIPT_RESOLUTION_OPTIONS = {
    scriptTimeout: 5000,
    prettyPrint: false,
};
//# sourceMappingURL=script-reference-types.js.map