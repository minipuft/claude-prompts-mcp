// @lifecycle deprecated - Use data-driven YAML definition at methodologies/react/ instead
/**
 * ReACT Methodology Guide (Legacy TypeScript Implementation)
 *
 * @deprecated Use data-driven YAML definition instead.
 *   - Location: methodologies/react/methodology.yaml
 *   - Migration: RuntimeMethodologyLoader loads YAML at runtime
 *   - Removal: v3.0.0
 *
 * This TypeScript class is kept as a fallback for backwards compatibility.
 * The preferred approach is loading methodology definitions from YAML files
 * via RuntimeMethodologyLoader, which provides:
 *   - No build step required
 *   - Hot reload support
 *   - Easier configuration
 *
 * Provides guidance for applying ReACT (Reasoning and Acting) methodology to prompt creation,
 * processing, and execution without hijacking semantic analysis functionality
 */
import { BaseMethodologyGuide, } from '../interfaces.js';
/**
 * ReACT Methodology Guide Implementation
 * Guides the application of ReACT (Reasoning and Acting) principles without replacing semantic analysis
 */
export class ReACTMethodologyGuide extends BaseMethodologyGuide {
    constructor() {
        super(...arguments);
        this.frameworkId = 'react';
        this.frameworkName = 'ReACT Framework';
        this.methodology = 'ReACT';
        this.version = '1.0.0';
    }
    /**
     * Guide prompt creation using ReACT structure
     * Helps users create prompts that follow ReACT methodology
     */
    guidePromptCreation(intent, context) {
        return {
            structureGuidance: {
                systemPromptSuggestions: [
                    'Begin with clear reasoning about the problem',
                    'Define specific actions to take',
                    'Establish observation and feedback mechanisms',
                    'Plan reasoning adjustment based on observations',
                    'Set criteria for cycle completion',
                ],
                userTemplateSuggestions: [
                    'Structure request using Reason-Act-Observe cycles',
                    'Provide clear problem statement for reasoning',
                    'Define specific actions that can be taken',
                    'Specify what observations should be made',
                    'Indicate success criteria for completion',
                ],
                argumentSuggestions: [
                    {
                        name: 'problem',
                        type: 'string',
                        description: 'The problem or challenge to address systematically',
                        methodologyReason: 'ReACT requires clear problem definition for effective reasoning',
                        examples: [
                            'performance optimization',
                            'user experience issue',
                            'technical implementation',
                        ],
                    },
                    {
                        name: 'actions',
                        type: 'array',
                        description: 'Potential actions that can be taken',
                        methodologyReason: 'ReACT methodology emphasizes specific, purposeful actions',
                        examples: ['analyze metrics', 'test hypothesis', 'implement solution'],
                    },
                    {
                        name: 'success_criteria',
                        type: 'string',
                        description: 'Clear criteria for when the objective is achieved',
                        methodologyReason: 'ReACT cycles need defined completion points',
                        examples: ['performance improves by 20%', 'user satisfaction increases', 'tests pass'],
                    },
                ],
            },
            methodologyElements: {
                requiredSections: ['Reason', 'Act', 'Observe'],
                optionalSections: ['Adjust', 'Continue'],
                sectionDescriptions: {
                    Reason: 'Think through the problem systematically and plan approach',
                    Act: 'Take specific, purposeful actions based on reasoning',
                    Observe: 'Analyze results, feedback, and outcomes of actions',
                    Adjust: 'Modify reasoning and approach based on observations',
                    Continue: 'Repeat cycles until objective is achieved',
                },
            },
            qualityGuidance: {
                clarityEnhancements: [
                    'Make reasoning explicit and traceable',
                    'Define actions with clear, measurable outcomes',
                    'Specify what to observe and how to measure results',
                ],
                completenessChecks: [
                    'Ensure reasoning addresses the core problem',
                    'Verify actions are specific and actionable',
                    'Confirm observation mechanisms are defined',
                ],
                specificityImprovements: [
                    'Replace abstract reasoning with concrete analysis steps',
                    'Define specific metrics for observation phase',
                    'Include clear decision points for cycle continuation',
                ],
            },
        };
    }
    /**
     * Guide template processing with ReACT methodology
     */
    guideTemplateProcessing(template, executionType) {
        const reactSteps = [
            {
                id: 'reasoning_phase',
                name: 'Reasoning Phase',
                description: 'Think through the problem systematically and develop approach',
                methodologyBasis: 'ReACT Reasoning phase',
                order: 1,
                required: true,
            },
            {
                id: 'action_planning',
                name: 'Action Planning',
                description: 'Plan specific, purposeful actions based on reasoning',
                methodologyBasis: 'ReACT Action phase',
                order: 2,
                required: true,
            },
            {
                id: 'action_execution',
                name: 'Action Execution',
                description: 'Execute planned actions systematically',
                methodologyBasis: 'ReACT Action phase',
                order: 3,
                required: true,
            },
            {
                id: 'observation_analysis',
                name: 'Observation Analysis',
                description: 'Analyze results, feedback, and outcomes',
                methodologyBasis: 'ReACT Observe phase',
                order: 4,
                required: true,
            },
            {
                id: 'reasoning_adjustment',
                name: 'Reasoning Adjustment',
                description: 'Adjust approach based on observations',
                methodologyBasis: 'ReACT cycle continuation',
                order: 5,
                required: false,
            },
            {
                id: 'cycle_evaluation',
                name: 'Cycle Evaluation',
                description: 'Evaluate if objective is achieved or cycle should continue',
                methodologyBasis: 'ReACT cycle management',
                order: 6,
                required: false,
            },
        ];
        return {
            processingSteps: reactSteps,
            templateEnhancements: {
                systemPromptAdditions: [
                    'Apply ReACT methodology with reasoning-action cycles',
                    'Think systematically before taking actions',
                    'Observe and analyze results after each action',
                    'Adjust approach based on observations',
                ],
                userPromptModifications: [
                    'Structure response using Reason-Act-Observe cycles',
                    'Make reasoning explicit and traceable',
                    'Include observation and adjustment phases',
                ],
                contextualHints: [
                    'Focus on systematic problem-solving approach',
                    'Emphasize learning from action outcomes',
                    'Apply iterative reasoning improvement',
                ],
            },
            executionFlow: {
                preProcessingSteps: [
                    'Validate problem definition clarity',
                    'Confirm available actions are specified',
                    'Verify observation mechanisms are defined',
                ],
                postProcessingSteps: [
                    'Review reasoning-action alignment',
                    'Assess observation completeness',
                    'Evaluate cycle termination criteria',
                ],
                validationSteps: [
                    'Reasoning quality check',
                    'Action specificity verification',
                    'Observation mechanism validation',
                    'Cycle completion assessment',
                ],
            },
        };
    }
    /**
     * Guide execution steps using ReACT methodology
     */
    guideExecutionSteps(prompt, semanticAnalysis) {
        const executionSteps = [
            {
                id: 'systematic_reasoning',
                name: 'Systematic Reasoning',
                action: 'Think through the problem systematically and develop initial approach',
                methodologyPhase: 'Reason',
                dependencies: [],
                expected_output: 'Clear reasoning about problem and planned approach',
            },
            {
                id: 'purposeful_action',
                name: 'Purposeful Action',
                action: 'Take specific, measurable actions based on reasoning',
                methodologyPhase: 'Act',
                dependencies: ['systematic_reasoning'],
                expected_output: 'Concrete actions taken with clear objectives',
            },
            {
                id: 'result_observation',
                name: 'Result Observation',
                action: 'Observe and analyze results, feedback, and outcomes',
                methodologyPhase: 'Observe',
                dependencies: ['purposeful_action'],
                expected_output: 'Detailed analysis of action results and feedback',
            },
            {
                id: 'reasoning_adjustment',
                name: 'Reasoning Adjustment',
                action: 'Adjust reasoning and approach based on observations',
                methodologyPhase: 'Adjust',
                dependencies: ['result_observation'],
                expected_output: 'Updated reasoning and modified approach',
            },
            {
                id: 'cycle_continuation',
                name: 'Cycle Continuation',
                action: 'Determine if objective is achieved or if cycle should continue',
                methodologyPhase: 'Continue',
                dependencies: ['reasoning_adjustment'],
                expected_output: 'Decision on cycle completion or continuation',
            },
        ];
        // Adjust steps based on execution type from semantic analyzer
        const stepEnhancements = {};
        const stepValidation = {};
        if (semanticAnalysis.executionType === 'chain') {
            if (semanticAnalysis.executionCharacteristics.advancedChainFeatures?.requiresAdvancedExecution) {
                // Advanced chains with workflow-like features
                stepEnhancements['reasoning_adjustment'] = [
                    'Define decision points and branching logic',
                    'Plan workflow state transitions based on observations',
                    'Establish error handling for failed actions',
                ];
                stepValidation['reasoning_adjustment'] = [
                    'Decision logic validation',
                    'State transition verification',
                    'Error handling completeness check',
                ];
            }
            else {
                // Basic chains
                stepEnhancements['systematic_reasoning'] = [
                    'Plan reasoning steps in sequence',
                    'Define dependencies between reasoning phases',
                    'Establish clear handoff points between steps',
                ];
                stepValidation['systematic_reasoning'] = [
                    'Step sequence validation',
                    'Dependency chain verification',
                    'Handoff point adequacy check',
                ];
            }
        }
        return {
            stepSequence: executionSteps,
            stepEnhancements,
            stepValidation,
        };
    }
    /**
     * Enhance execution with ReACT methodology
     */
    enhanceWithMethodology(prompt, context) {
        const reactGates = [
            {
                id: 'reasoning_quality',
                name: 'Reasoning Quality',
                description: 'Verify systematic and logical reasoning approach',
                methodologyArea: 'Reason',
                validationCriteria: [
                    'Problem analysis is systematic and thorough',
                    'Reasoning is explicit and traceable',
                    'Approach is logically structured',
                ],
                priority: 'high',
            },
            {
                id: 'action_specificity',
                name: 'Action Specificity',
                description: 'Ensure actions are specific, purposeful, and measurable',
                methodologyArea: 'Act',
                validationCriteria: [
                    'Actions are concrete and specific',
                    'Actions have clear objectives',
                    'Actions are measurable and observable',
                ],
                priority: 'high',
            },
            {
                id: 'observation_completeness',
                name: 'Observation Completeness',
                description: 'Validate comprehensive observation and analysis of results',
                methodologyArea: 'Observe',
                validationCriteria: [
                    'Results are observed systematically',
                    'Feedback is analyzed thoroughly',
                    'Outcomes are measured against objectives',
                ],
                priority: 'high',
            },
            {
                id: 'cycle_effectiveness',
                name: 'Cycle Effectiveness',
                description: 'Assess effectiveness of reasoning-action cycles',
                methodologyArea: 'Continue',
                validationCriteria: [
                    'Cycles show learning and improvement',
                    'Adjustments are based on observations',
                    'Progress toward objective is evident',
                ],
                priority: 'medium',
            },
        ];
        const templateSuggestions = [
            {
                section: 'system',
                type: 'addition',
                description: 'Add ReACT methodology guidance',
                content: 'Apply the ReACT methodology: Reason through the problem systematically, take specific purposeful Actions, Observe results and feedback, then adjust your reasoning based on observations. Continue cycles until the objective is achieved.',
                methodologyJustification: 'Ensures systematic application of reasoning-action cycles',
                impact: 'high',
            },
            {
                section: 'user',
                type: 'structure',
                description: 'Structure response using ReACT cycles',
                content: 'Please structure your response using ReACT cycles: 1) Reasoning about the problem, 2) Specific actions to take, 3) Observations of results, 4) Reasoning adjustments, 5) Continuation decision.',
                methodologyJustification: 'Guides systematic problem-solving through reasoning-action cycles',
                impact: 'medium',
            },
        ];
        return {
            systemPromptGuidance: this.getSystemPromptGuidance(context),
            processingEnhancements: this.guideTemplateProcessing('', 'template').processingSteps,
            methodologyGates: reactGates,
            templateSuggestions,
            enhancementMetadata: this.createEnhancementMetadata(0.85, 'ReACT methodology provides systematic reasoning-action cycles for problem solving'),
        };
    }
    /**
     * Validate methodology compliance
     */
    validateMethodologyCompliance(prompt) {
        const combinedText = this.getCombinedText(prompt);
        const text = combinedText.toLowerCase();
        // Check for ReACT phase presence
        const phases = {
            reason: /reason|think|analy|consider|approach/i.test(text),
            act: /act|action|implement|execute|do|perform/i.test(text),
            observe: /observe|result|outcome|feedback|measure|assess/i.test(text),
            adjust: /adjust|modify|change|improve|refine/i.test(text),
            continue: /continue|repeat|cycle|iterate/i.test(text),
        };
        const presentPhases = Object.values(phases).filter(Boolean).length;
        const compliance_score = presentPhases / 5; // 5 ReACT phases
        const strengths = [];
        const improvement_areas = [];
        if (phases.reason)
            strengths.push('Systematic reasoning approach present');
        else
            improvement_areas.push('Add systematic reasoning and problem analysis');
        if (phases.act)
            strengths.push('Action-oriented approach evident');
        else
            improvement_areas.push('Include specific, purposeful actions');
        if (phases.observe)
            strengths.push('Observation and result analysis mentioned');
        else
            improvement_areas.push('Add observation and result analysis');
        if (phases.adjust)
            strengths.push('Adjustment and improvement considered');
        else
            improvement_areas.push('Include reasoning adjustment based on observations');
        const specific_suggestions = [];
        if (!phases.reason) {
            specific_suggestions.push({
                section: 'system',
                type: 'addition',
                description: 'Add systematic reasoning approach',
                content: 'Begin by reasoning through the problem systematically before taking actions.',
                methodologyJustification: 'ReACT Reasoning phase requires systematic problem analysis',
                impact: 'high',
            });
        }
        if (!phases.observe) {
            specific_suggestions.push({
                section: 'system',
                type: 'addition',
                description: 'Add observation and result analysis',
                content: 'Observe and analyze results after taking actions to inform next steps.',
                methodologyJustification: 'ReACT Observe phase is crucial for learning and adjustment',
                impact: 'high',
            });
        }
        return {
            compliant: compliance_score > 0.6,
            compliance_score,
            strengths,
            improvement_areas,
            specific_suggestions,
            methodology_gaps: improvement_areas,
        };
    }
    /**
     * Get ReACT-specific system prompt guidance
     */
    getSystemPromptGuidance(context) {
        return `Apply the ReACT methodology systematically:

**Reason**: Think through the problem systematically and develop a clear approach
**Act**: Take specific, purposeful actions based on your reasoning
**Observe**: Analyze results, feedback, and outcomes of your actions carefully
**Adjust**: Modify your reasoning and approach based on observations
**Continue**: Repeat the cycle until the objective is achieved

Focus on explicit reasoning, measurable actions, systematic observation, and continuous improvement through reasoning-action cycles. Each cycle should build upon learnings from previous cycles.`;
    }
    /**
     * Get ReACT-specific tool descriptions
     * Emphasizes iterative reasoning cycles and observational learning
     */
    getToolDescriptions() {
        return {
            prompt_engine: {
                description: '🚀 PROMPT ENGINE [ReACT]: Operators: %judge menu, @framework, ::gates, #style(<id>), --> chain. Use `>>guide <topic>` for ReACT tips; gate verdicts via `gate_verdict`, step outputs via `user_response`.',
            },
            prompt_manager: {
                description: '📝 PROMPT MANAGER [ReACT GUIDE]: Lifecycle operations emphasize Reason/Act/Observe/Adjust phases. Use `guide` action with `goal:"observe"` to favor verbs that gather evidence before acting.',
                parameters: {
                    action: 'Provide `goal:"observe"` or similar to have the guide favor verbs that gather evidence before acting.',
                },
            },
            system_control: {
                description: '⚙️ SYSTEM CONTROL [ReACT-ENHANCED]: `>>help` narrates Reason→Act→Observe→Adjust intent for framework switches, gate health checks, and analytics. Use `action:"guide" topic:"observe"` to surface telemetry operations.',
                parameters: {
                    action: 'Use `action:"guide" topic:"observe"` to surface observation/telemetry operations before acting.',
                },
            },
        };
    }
    /**
     * Get ReACT-specific judge prompt for resource selection
     */
    getJudgePrompt() {
        return {
            systemMessage: `You are a ReACT methodology expert specializing in iterative reasoning-action cycles.

Your role is to select resources that support systematic problem-solving:
- REASON: Systematic analysis and approach planning
- ACT: Purposeful, measurable actions
- OBSERVE: Result analysis and feedback collection
- ADJUST: Reasoning refinement based on observations

Select resources that enable effective reasoning-action cycles with clear observation points.`,
            userMessageTemplate: `Analyze this task using ReACT reasoning-action cycles:

**Task:** {{command}}

Based on this task, select resources that will support iterative problem-solving through reasoning and acting.

Consider:
1. Does this task require multiple reasoning-action cycles?
2. What gates ensure quality reasoning before actions?
3. Which observation mechanisms will help track progress?
4. What style best supports explicit reasoning traces?

Provide your resource selections.`,
            outputFormat: 'structured',
        };
    }
}
//# sourceMappingURL=react-guide.js.map