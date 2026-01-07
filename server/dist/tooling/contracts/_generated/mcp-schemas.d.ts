import { z } from 'zod';
/**
 * Zod schema for prompt_engine MCP tool
 * Generated from contract version 1
 */
export declare const promptEngineSchema: z.ZodObject<{
    /** Prompt ID to expand. Format: >>prompt_id key="value" | Chains: >>s1 --> >>s2 | Modifiers first: @Framework :: "criteria" %clean/%lean */
    command: z.ZodOptional<z.ZodString>;
    /** Resume token (chain-{prompt} or chain-{prompt}#runNumber). RESUME: chain_id + user_response only. Omit command. */
    chain_id: z.ZodOptional<z.ZodString>;
    /** Your completed output from executing the previous step. Paste your work here when resuming a chain. Use with chain_id; do not include command when resuming. */
    user_response: z.ZodOptional<z.ZodString>;
    /** Gate review verdict with flexible format support. Primary: 'GATE_REVIEW: PASS|FAIL - reason'. Also accepts: 'GATE PASS - reason', 'GATE_REVIEW: FAIL: reason', 'PASS - reason' (minimal). */
    gate_verdict: z.ZodOptional<z.ZodString>;
    /** User choice after gate retry limit exhaustion. 'retry' resets attempt count for another try, 'skip' bypasses the failed gate and continues, 'abort' stops chain execution entirely. */
    gate_action: z.ZodOptional<z.ZodEnum<["retry", "skip", "abort"]>>;
    /** Quality gates for output validation. Three formats supported:  **1. Registered IDs** (strings): Use predefined gates like 'code-quality', 'research-quality'.  **2. Quick Gates** (RECOMMENDED for LLM-generated validation): `{name, description}` - Create named, domain-specific checks on the fly. Example: `{name: 'Source Quality', description: 'All sources must be official docs'}`.  **3. Full Definitions**: Complete schema with severity, criteria[], pass_criteria[], guidance for production workflows. */
    gates: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string;
    }, {
        name: string;
        description: string;
    }>, z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        criteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        severity: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>;
        type: z.ZodOptional<z.ZodEnum<["validation", "guidance"]>>;
        scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
        template: z.ZodOptional<z.ZodString>;
        pass_criteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        guidance: z.ZodOptional<z.ZodString>;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
        target_step_number: z.ZodOptional<z.ZodNumber>;
        apply_to_steps: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    }, "strip", z.ZodTypeAny, {
        guidance?: string | undefined;
        source?: "manual" | "automatic" | "analysis" | undefined;
        type?: "validation" | "guidance" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        description?: string | undefined;
        template?: string | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
        pass_criteria?: string[] | undefined;
        scope?: "execution" | "session" | "chain" | "step" | undefined;
        context?: Record<string, unknown> | undefined;
        target_step_number?: number | undefined;
        apply_to_steps?: number[] | undefined;
    }, {
        guidance?: string | undefined;
        source?: "manual" | "automatic" | "analysis" | undefined;
        type?: "validation" | "guidance" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        description?: string | undefined;
        template?: string | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
        pass_criteria?: string[] | undefined;
        scope?: "execution" | "session" | "chain" | "step" | undefined;
        context?: Record<string, unknown> | undefined;
        target_step_number?: number | undefined;
        apply_to_steps?: number[] | undefined;
    }>]>, "many">>;
    /** Restart chain from step 1, ignoring cached state. */
    force_restart: z.ZodOptional<z.ZodBoolean>;
    /** Execution options forwarded downstream. */
    options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    /** Prompt ID to expand. Format: >>prompt_id key="value" | Chains: >>s1 --> >>s2 | Modifiers first: @Framework :: "criteria" %clean/%lean */
    command: z.ZodOptional<z.ZodString>;
    /** Resume token (chain-{prompt} or chain-{prompt}#runNumber). RESUME: chain_id + user_response only. Omit command. */
    chain_id: z.ZodOptional<z.ZodString>;
    /** Your completed output from executing the previous step. Paste your work here when resuming a chain. Use with chain_id; do not include command when resuming. */
    user_response: z.ZodOptional<z.ZodString>;
    /** Gate review verdict with flexible format support. Primary: 'GATE_REVIEW: PASS|FAIL - reason'. Also accepts: 'GATE PASS - reason', 'GATE_REVIEW: FAIL: reason', 'PASS - reason' (minimal). */
    gate_verdict: z.ZodOptional<z.ZodString>;
    /** User choice after gate retry limit exhaustion. 'retry' resets attempt count for another try, 'skip' bypasses the failed gate and continues, 'abort' stops chain execution entirely. */
    gate_action: z.ZodOptional<z.ZodEnum<["retry", "skip", "abort"]>>;
    /** Quality gates for output validation. Three formats supported:  **1. Registered IDs** (strings): Use predefined gates like 'code-quality', 'research-quality'.  **2. Quick Gates** (RECOMMENDED for LLM-generated validation): `{name, description}` - Create named, domain-specific checks on the fly. Example: `{name: 'Source Quality', description: 'All sources must be official docs'}`.  **3. Full Definitions**: Complete schema with severity, criteria[], pass_criteria[], guidance for production workflows. */
    gates: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string;
    }, {
        name: string;
        description: string;
    }>, z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        criteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        severity: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>;
        type: z.ZodOptional<z.ZodEnum<["validation", "guidance"]>>;
        scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
        template: z.ZodOptional<z.ZodString>;
        pass_criteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        guidance: z.ZodOptional<z.ZodString>;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
        target_step_number: z.ZodOptional<z.ZodNumber>;
        apply_to_steps: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    }, "strip", z.ZodTypeAny, {
        guidance?: string | undefined;
        source?: "manual" | "automatic" | "analysis" | undefined;
        type?: "validation" | "guidance" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        description?: string | undefined;
        template?: string | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
        pass_criteria?: string[] | undefined;
        scope?: "execution" | "session" | "chain" | "step" | undefined;
        context?: Record<string, unknown> | undefined;
        target_step_number?: number | undefined;
        apply_to_steps?: number[] | undefined;
    }, {
        guidance?: string | undefined;
        source?: "manual" | "automatic" | "analysis" | undefined;
        type?: "validation" | "guidance" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        description?: string | undefined;
        template?: string | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
        pass_criteria?: string[] | undefined;
        scope?: "execution" | "session" | "chain" | "step" | undefined;
        context?: Record<string, unknown> | undefined;
        target_step_number?: number | undefined;
        apply_to_steps?: number[] | undefined;
    }>]>, "many">>;
    /** Restart chain from step 1, ignoring cached state. */
    force_restart: z.ZodOptional<z.ZodBoolean>;
    /** Execution options forwarded downstream. */
    options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    /** Prompt ID to expand. Format: >>prompt_id key="value" | Chains: >>s1 --> >>s2 | Modifiers first: @Framework :: "criteria" %clean/%lean */
    command: z.ZodOptional<z.ZodString>;
    /** Resume token (chain-{prompt} or chain-{prompt}#runNumber). RESUME: chain_id + user_response only. Omit command. */
    chain_id: z.ZodOptional<z.ZodString>;
    /** Your completed output from executing the previous step. Paste your work here when resuming a chain. Use with chain_id; do not include command when resuming. */
    user_response: z.ZodOptional<z.ZodString>;
    /** Gate review verdict with flexible format support. Primary: 'GATE_REVIEW: PASS|FAIL - reason'. Also accepts: 'GATE PASS - reason', 'GATE_REVIEW: FAIL: reason', 'PASS - reason' (minimal). */
    gate_verdict: z.ZodOptional<z.ZodString>;
    /** User choice after gate retry limit exhaustion. 'retry' resets attempt count for another try, 'skip' bypasses the failed gate and continues, 'abort' stops chain execution entirely. */
    gate_action: z.ZodOptional<z.ZodEnum<["retry", "skip", "abort"]>>;
    /** Quality gates for output validation. Three formats supported:  **1. Registered IDs** (strings): Use predefined gates like 'code-quality', 'research-quality'.  **2. Quick Gates** (RECOMMENDED for LLM-generated validation): `{name, description}` - Create named, domain-specific checks on the fly. Example: `{name: 'Source Quality', description: 'All sources must be official docs'}`.  **3. Full Definitions**: Complete schema with severity, criteria[], pass_criteria[], guidance for production workflows. */
    gates: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string;
    }, {
        name: string;
        description: string;
    }>, z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        criteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        severity: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>;
        type: z.ZodOptional<z.ZodEnum<["validation", "guidance"]>>;
        scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
        template: z.ZodOptional<z.ZodString>;
        pass_criteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        guidance: z.ZodOptional<z.ZodString>;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
        target_step_number: z.ZodOptional<z.ZodNumber>;
        apply_to_steps: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    }, "strip", z.ZodTypeAny, {
        guidance?: string | undefined;
        source?: "manual" | "automatic" | "analysis" | undefined;
        type?: "validation" | "guidance" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        description?: string | undefined;
        template?: string | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
        pass_criteria?: string[] | undefined;
        scope?: "execution" | "session" | "chain" | "step" | undefined;
        context?: Record<string, unknown> | undefined;
        target_step_number?: number | undefined;
        apply_to_steps?: number[] | undefined;
    }, {
        guidance?: string | undefined;
        source?: "manual" | "automatic" | "analysis" | undefined;
        type?: "validation" | "guidance" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        description?: string | undefined;
        template?: string | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
        pass_criteria?: string[] | undefined;
        scope?: "execution" | "session" | "chain" | "step" | undefined;
        context?: Record<string, unknown> | undefined;
        target_step_number?: number | undefined;
        apply_to_steps?: number[] | undefined;
    }>]>, "many">>;
    /** Restart chain from step 1, ignoring cached state. */
    force_restart: z.ZodOptional<z.ZodBoolean>;
    /** Execution options forwarded downstream. */
    options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.ZodTypeAny, "passthrough">>;
export type promptEngineInput = z.infer<typeof promptEngineSchema>;
/**
 * Zod schema for resource_manager MCP tool
 * Generated from contract version 1
 */
export declare const resourceManagerSchema: z.ZodObject<{
    /** Type of resource to manage. Routes to appropriate handler. */
    resource_type: z.ZodEnum<["prompt", "gate", "methodology"]>;
    /** Operation to perform. Type-specific: analyze_type/guide (prompt), switch (methodology). Versioning: history/rollback/compare (all types). */
    action: z.ZodEnum<["create", "update", "delete", "reload", "list", "inspect", "analyze_type", "analyze_gates", "guide", "switch", "history", "rollback", "compare"]>;
    /** Resource identifier. Required for create, update, delete, inspect, reload, switch. */
    id: z.ZodOptional<z.ZodString>;
    /** Human-friendly name for the resource (create/update). */
    name: z.ZodOptional<z.ZodString>;
    /** Resource description explaining its purpose (create/update). */
    description: z.ZodOptional<z.ZodString>;
    /** Filter list to enabled resources only. Default: true. */
    enabled_only: z.ZodOptional<z.ZodBoolean>;
    /** Safety confirmation for delete operation. */
    confirm: z.ZodOptional<z.ZodBoolean>;
    /** Audit reason for reload/delete/switch operations. */
    reason: z.ZodOptional<z.ZodString>;
    /** [Prompt] Category tag for the prompt. */
    category: z.ZodOptional<z.ZodString>;
    /** [Prompt] Prompt body/template with Nunjucks placeholders. */
    user_message_template: z.ZodOptional<z.ZodString>;
    /** [Prompt] Optional system message for the prompt. */
    system_message: z.ZodOptional<z.ZodString>;
    /** [Prompt] Argument definitions for the prompt. */
    arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodString;
        description: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: string;
        name: string;
        description: string;
    }, {
        type: string;
        name: string;
        description: string;
    }>, "many">>;
    /** [Prompt] Chain steps definition for multi-step prompts. */
    chain_steps: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Prompt] Script tools to create with the prompt. Each tool creates files in tools/{id}/ subdirectory. Required: id, name, script. Optional: description, runtime (python|node|shell|auto), schema (JSON Schema object), trigger (schema_match|explicit|always|never), confirm, strict, timeout. */
    tools: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Prompt] Gate configuration: include (array), exclude (array), framework_gates (boolean). */
    gate_configuration: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Prompt] Hint for execution type on creation. */
    execution_hint: z.ZodOptional<z.ZodEnum<["single", "chain"]>>;
    /** [Prompt] Targeted update section. */
    section: z.ZodOptional<z.ZodEnum<["name", "description", "system_message", "user_message_template", "arguments", "chain_steps"]>>;
    /** [Prompt] Content for targeted section updates. */
    section_content: z.ZodOptional<z.ZodString>;
    /** [Prompt] List filter query. */
    filter: z.ZodOptional<z.ZodString>;
    /** [Prompt] Output format for list/inspect. */
    format: z.ZodOptional<z.ZodEnum<["table", "json", "text"]>>;
    /** [Prompt] Inspect detail level. */
    detail: z.ZodOptional<z.ZodEnum<["summary", "full"]>>;
    /** [Prompt] Search query for filtering (list action). */
    search_query: z.ZodOptional<z.ZodString>;
    /** [Gate] Gate type: validation (pass/fail) or guidance (advisory). Default: validation. */
    gate_type: z.ZodOptional<z.ZodEnum<["validation", "guidance"]>>;
    /** [Gate] Gate guidance content - the criteria or instructions. */
    guidance: z.ZodOptional<z.ZodString>;
    /** [Gate] Structured pass criteria definitions. */
    pass_criteria: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Gate] Activation rules: prompt_categories, frameworks, explicit_request. */
    activation: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Gate] Retry configuration: max_attempts, improvement_hints. */
    retry_config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Methodology] Methodology type identifier. Use action:'list' to see registered methodologies. */
    methodology: z.ZodOptional<z.ZodString>;
    /** [Methodology] System prompt guidance injected when active. */
    system_prompt_guidance: z.ZodOptional<z.ZodString>;
    /** [Methodology] Phase definitions and advanced fields. Core: id, name, description. Advanced fields (methodology_gates, processing_steps, execution_steps, etc.) are also accepted. */
    phases: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Methodology] Gate configuration: include, exclude arrays. */
    gates: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Methodology] Tool description overlays when active. */
    tool_descriptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Methodology] Whether the methodology is enabled. */
    enabled: z.ZodOptional<z.ZodBoolean>;
    /** [Methodology] For switch: persist the change to config. Default: false. */
    persist: z.ZodOptional<z.ZodBoolean>;
    /** [Versioning] Target version number for rollback action. */
    version: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Starting version number for compare action. */
    from_version: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Ending version number for compare action. */
    to_version: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Max versions to return in history. Default: 10. */
    limit: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Skip auto-versioning on update. Default: false. */
    skip_version: z.ZodOptional<z.ZodBoolean>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    /** Type of resource to manage. Routes to appropriate handler. */
    resource_type: z.ZodEnum<["prompt", "gate", "methodology"]>;
    /** Operation to perform. Type-specific: analyze_type/guide (prompt), switch (methodology). Versioning: history/rollback/compare (all types). */
    action: z.ZodEnum<["create", "update", "delete", "reload", "list", "inspect", "analyze_type", "analyze_gates", "guide", "switch", "history", "rollback", "compare"]>;
    /** Resource identifier. Required for create, update, delete, inspect, reload, switch. */
    id: z.ZodOptional<z.ZodString>;
    /** Human-friendly name for the resource (create/update). */
    name: z.ZodOptional<z.ZodString>;
    /** Resource description explaining its purpose (create/update). */
    description: z.ZodOptional<z.ZodString>;
    /** Filter list to enabled resources only. Default: true. */
    enabled_only: z.ZodOptional<z.ZodBoolean>;
    /** Safety confirmation for delete operation. */
    confirm: z.ZodOptional<z.ZodBoolean>;
    /** Audit reason for reload/delete/switch operations. */
    reason: z.ZodOptional<z.ZodString>;
    /** [Prompt] Category tag for the prompt. */
    category: z.ZodOptional<z.ZodString>;
    /** [Prompt] Prompt body/template with Nunjucks placeholders. */
    user_message_template: z.ZodOptional<z.ZodString>;
    /** [Prompt] Optional system message for the prompt. */
    system_message: z.ZodOptional<z.ZodString>;
    /** [Prompt] Argument definitions for the prompt. */
    arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodString;
        description: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: string;
        name: string;
        description: string;
    }, {
        type: string;
        name: string;
        description: string;
    }>, "many">>;
    /** [Prompt] Chain steps definition for multi-step prompts. */
    chain_steps: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Prompt] Script tools to create with the prompt. Each tool creates files in tools/{id}/ subdirectory. Required: id, name, script. Optional: description, runtime (python|node|shell|auto), schema (JSON Schema object), trigger (schema_match|explicit|always|never), confirm, strict, timeout. */
    tools: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Prompt] Gate configuration: include (array), exclude (array), framework_gates (boolean). */
    gate_configuration: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Prompt] Hint for execution type on creation. */
    execution_hint: z.ZodOptional<z.ZodEnum<["single", "chain"]>>;
    /** [Prompt] Targeted update section. */
    section: z.ZodOptional<z.ZodEnum<["name", "description", "system_message", "user_message_template", "arguments", "chain_steps"]>>;
    /** [Prompt] Content for targeted section updates. */
    section_content: z.ZodOptional<z.ZodString>;
    /** [Prompt] List filter query. */
    filter: z.ZodOptional<z.ZodString>;
    /** [Prompt] Output format for list/inspect. */
    format: z.ZodOptional<z.ZodEnum<["table", "json", "text"]>>;
    /** [Prompt] Inspect detail level. */
    detail: z.ZodOptional<z.ZodEnum<["summary", "full"]>>;
    /** [Prompt] Search query for filtering (list action). */
    search_query: z.ZodOptional<z.ZodString>;
    /** [Gate] Gate type: validation (pass/fail) or guidance (advisory). Default: validation. */
    gate_type: z.ZodOptional<z.ZodEnum<["validation", "guidance"]>>;
    /** [Gate] Gate guidance content - the criteria or instructions. */
    guidance: z.ZodOptional<z.ZodString>;
    /** [Gate] Structured pass criteria definitions. */
    pass_criteria: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Gate] Activation rules: prompt_categories, frameworks, explicit_request. */
    activation: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Gate] Retry configuration: max_attempts, improvement_hints. */
    retry_config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Methodology] Methodology type identifier. Use action:'list' to see registered methodologies. */
    methodology: z.ZodOptional<z.ZodString>;
    /** [Methodology] System prompt guidance injected when active. */
    system_prompt_guidance: z.ZodOptional<z.ZodString>;
    /** [Methodology] Phase definitions and advanced fields. Core: id, name, description. Advanced fields (methodology_gates, processing_steps, execution_steps, etc.) are also accepted. */
    phases: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Methodology] Gate configuration: include, exclude arrays. */
    gates: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Methodology] Tool description overlays when active. */
    tool_descriptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Methodology] Whether the methodology is enabled. */
    enabled: z.ZodOptional<z.ZodBoolean>;
    /** [Methodology] For switch: persist the change to config. Default: false. */
    persist: z.ZodOptional<z.ZodBoolean>;
    /** [Versioning] Target version number for rollback action. */
    version: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Starting version number for compare action. */
    from_version: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Ending version number for compare action. */
    to_version: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Max versions to return in history. Default: 10. */
    limit: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Skip auto-versioning on update. Default: false. */
    skip_version: z.ZodOptional<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    /** Type of resource to manage. Routes to appropriate handler. */
    resource_type: z.ZodEnum<["prompt", "gate", "methodology"]>;
    /** Operation to perform. Type-specific: analyze_type/guide (prompt), switch (methodology). Versioning: history/rollback/compare (all types). */
    action: z.ZodEnum<["create", "update", "delete", "reload", "list", "inspect", "analyze_type", "analyze_gates", "guide", "switch", "history", "rollback", "compare"]>;
    /** Resource identifier. Required for create, update, delete, inspect, reload, switch. */
    id: z.ZodOptional<z.ZodString>;
    /** Human-friendly name for the resource (create/update). */
    name: z.ZodOptional<z.ZodString>;
    /** Resource description explaining its purpose (create/update). */
    description: z.ZodOptional<z.ZodString>;
    /** Filter list to enabled resources only. Default: true. */
    enabled_only: z.ZodOptional<z.ZodBoolean>;
    /** Safety confirmation for delete operation. */
    confirm: z.ZodOptional<z.ZodBoolean>;
    /** Audit reason for reload/delete/switch operations. */
    reason: z.ZodOptional<z.ZodString>;
    /** [Prompt] Category tag for the prompt. */
    category: z.ZodOptional<z.ZodString>;
    /** [Prompt] Prompt body/template with Nunjucks placeholders. */
    user_message_template: z.ZodOptional<z.ZodString>;
    /** [Prompt] Optional system message for the prompt. */
    system_message: z.ZodOptional<z.ZodString>;
    /** [Prompt] Argument definitions for the prompt. */
    arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodString;
        description: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: string;
        name: string;
        description: string;
    }, {
        type: string;
        name: string;
        description: string;
    }>, "many">>;
    /** [Prompt] Chain steps definition for multi-step prompts. */
    chain_steps: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Prompt] Script tools to create with the prompt. Each tool creates files in tools/{id}/ subdirectory. Required: id, name, script. Optional: description, runtime (python|node|shell|auto), schema (JSON Schema object), trigger (schema_match|explicit|always|never), confirm, strict, timeout. */
    tools: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Prompt] Gate configuration: include (array), exclude (array), framework_gates (boolean). */
    gate_configuration: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Prompt] Hint for execution type on creation. */
    execution_hint: z.ZodOptional<z.ZodEnum<["single", "chain"]>>;
    /** [Prompt] Targeted update section. */
    section: z.ZodOptional<z.ZodEnum<["name", "description", "system_message", "user_message_template", "arguments", "chain_steps"]>>;
    /** [Prompt] Content for targeted section updates. */
    section_content: z.ZodOptional<z.ZodString>;
    /** [Prompt] List filter query. */
    filter: z.ZodOptional<z.ZodString>;
    /** [Prompt] Output format for list/inspect. */
    format: z.ZodOptional<z.ZodEnum<["table", "json", "text"]>>;
    /** [Prompt] Inspect detail level. */
    detail: z.ZodOptional<z.ZodEnum<["summary", "full"]>>;
    /** [Prompt] Search query for filtering (list action). */
    search_query: z.ZodOptional<z.ZodString>;
    /** [Gate] Gate type: validation (pass/fail) or guidance (advisory). Default: validation. */
    gate_type: z.ZodOptional<z.ZodEnum<["validation", "guidance"]>>;
    /** [Gate] Gate guidance content - the criteria or instructions. */
    guidance: z.ZodOptional<z.ZodString>;
    /** [Gate] Structured pass criteria definitions. */
    pass_criteria: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Gate] Activation rules: prompt_categories, frameworks, explicit_request. */
    activation: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Gate] Retry configuration: max_attempts, improvement_hints. */
    retry_config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Methodology] Methodology type identifier. Use action:'list' to see registered methodologies. */
    methodology: z.ZodOptional<z.ZodString>;
    /** [Methodology] System prompt guidance injected when active. */
    system_prompt_guidance: z.ZodOptional<z.ZodString>;
    /** [Methodology] Phase definitions and advanced fields. Core: id, name, description. Advanced fields (methodology_gates, processing_steps, execution_steps, etc.) are also accepted. */
    phases: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    /** [Methodology] Gate configuration: include, exclude arrays. */
    gates: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Methodology] Tool description overlays when active. */
    tool_descriptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** [Methodology] Whether the methodology is enabled. */
    enabled: z.ZodOptional<z.ZodBoolean>;
    /** [Methodology] For switch: persist the change to config. Default: false. */
    persist: z.ZodOptional<z.ZodBoolean>;
    /** [Versioning] Target version number for rollback action. */
    version: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Starting version number for compare action. */
    from_version: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Ending version number for compare action. */
    to_version: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Max versions to return in history. Default: 10. */
    limit: z.ZodOptional<z.ZodNumber>;
    /** [Versioning] Skip auto-versioning on update. Default: false. */
    skip_version: z.ZodOptional<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">>;
export type resourceManagerInput = z.infer<typeof resourceManagerSchema>;
/**
 * Zod schema for system_control MCP tool
 * Generated from contract version 1
 */
export declare const systemControlSchema: z.ZodObject<{
    /** The operation to perform: status (runtime overview), framework (switch/enable/disable methodologies), gates (manage quality gates), analytics (usage metrics), config (view/modify settings), maintenance (restart), guide (get recommendations), session (manage execution sessions). */
    action: z.ZodEnum<["status", "framework", "gates", "analytics", "config", "maintenance", "guide", "injection", "session"]>;
    /** Sub-command for the selected action (e.g., framework switch/list/enable/disable; gates enable/disable/status/health/list; session list/clear/inspect). */
    operation: z.ZodOptional<z.ZodString>;
    /** Target session ID or chain ID for session operations. */
    session_id: z.ZodOptional<z.ZodString>;
    /** Target framework for switch operations. Use system_control(action:'framework', operation:'list') to see available frameworks. */
    framework: z.ZodOptional<z.ZodString>;
    /** Audit reason for framework/gate toggles or admin actions. */
    reason: z.ZodOptional<z.ZodString>;
    /** When true, gate/framework enable/disable changes are also written to config.json. */
    persist: z.ZodOptional<z.ZodBoolean>;
    /** Include detailed output (status/analytics/framework/gate reports). */
    show_details: z.ZodOptional<z.ZodBoolean>;
    /** Include recorded history where supported. */
    include_history: z.ZodOptional<z.ZodBoolean>;
    /** Guide topic when requesting guidance. */
    topic: z.ZodOptional<z.ZodString>;
    /** Filter gates by keyword (matches ID, name, or description). Use with gates:list action. */
    search_query: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    /** The operation to perform: status (runtime overview), framework (switch/enable/disable methodologies), gates (manage quality gates), analytics (usage metrics), config (view/modify settings), maintenance (restart), guide (get recommendations), session (manage execution sessions). */
    action: z.ZodEnum<["status", "framework", "gates", "analytics", "config", "maintenance", "guide", "injection", "session"]>;
    /** Sub-command for the selected action (e.g., framework switch/list/enable/disable; gates enable/disable/status/health/list; session list/clear/inspect). */
    operation: z.ZodOptional<z.ZodString>;
    /** Target session ID or chain ID for session operations. */
    session_id: z.ZodOptional<z.ZodString>;
    /** Target framework for switch operations. Use system_control(action:'framework', operation:'list') to see available frameworks. */
    framework: z.ZodOptional<z.ZodString>;
    /** Audit reason for framework/gate toggles or admin actions. */
    reason: z.ZodOptional<z.ZodString>;
    /** When true, gate/framework enable/disable changes are also written to config.json. */
    persist: z.ZodOptional<z.ZodBoolean>;
    /** Include detailed output (status/analytics/framework/gate reports). */
    show_details: z.ZodOptional<z.ZodBoolean>;
    /** Include recorded history where supported. */
    include_history: z.ZodOptional<z.ZodBoolean>;
    /** Guide topic when requesting guidance. */
    topic: z.ZodOptional<z.ZodString>;
    /** Filter gates by keyword (matches ID, name, or description). Use with gates:list action. */
    search_query: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    /** The operation to perform: status (runtime overview), framework (switch/enable/disable methodologies), gates (manage quality gates), analytics (usage metrics), config (view/modify settings), maintenance (restart), guide (get recommendations), session (manage execution sessions). */
    action: z.ZodEnum<["status", "framework", "gates", "analytics", "config", "maintenance", "guide", "injection", "session"]>;
    /** Sub-command for the selected action (e.g., framework switch/list/enable/disable; gates enable/disable/status/health/list; session list/clear/inspect). */
    operation: z.ZodOptional<z.ZodString>;
    /** Target session ID or chain ID for session operations. */
    session_id: z.ZodOptional<z.ZodString>;
    /** Target framework for switch operations. Use system_control(action:'framework', operation:'list') to see available frameworks. */
    framework: z.ZodOptional<z.ZodString>;
    /** Audit reason for framework/gate toggles or admin actions. */
    reason: z.ZodOptional<z.ZodString>;
    /** When true, gate/framework enable/disable changes are also written to config.json. */
    persist: z.ZodOptional<z.ZodBoolean>;
    /** Include detailed output (status/analytics/framework/gate reports). */
    show_details: z.ZodOptional<z.ZodBoolean>;
    /** Include recorded history where supported. */
    include_history: z.ZodOptional<z.ZodBoolean>;
    /** Guide topic when requesting guidance. */
    topic: z.ZodOptional<z.ZodString>;
    /** Filter gates by keyword (matches ID, name, or description). Use with gates:list action. */
    search_query: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export type systemControlInput = z.infer<typeof systemControlSchema>;
