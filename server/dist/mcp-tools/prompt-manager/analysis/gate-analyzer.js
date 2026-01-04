// @lifecycle canonical - Analyzes gate metadata within prompts.
/**
 * Gate Analyzer Module
 *
 * Analyzes prompt content to suggest appropriate gates and temporary gate definitions.
 * Integrates with the temporary gate system to provide intelligent gate recommendations.
 */
/**
 * Analyzes prompts for gate recommendations
 */
export class GateAnalyzer {
    constructor(dependencies) {
        this.logger = dependencies.logger;
        this.dependencies = dependencies;
    }
    /**
     * Analyze a prompt for gate recommendations
     */
    async analyzePromptForGates(prompt) {
        this.logger.debug('[GATE ANALYZER] Analyzing prompt for gate recommendations:', {
            promptId: prompt.id,
            category: prompt.category,
            hasChainSteps: !!prompt.chainSteps?.length,
            argumentsCount: prompt.arguments?.length || 0,
        });
        // Extract context from prompt
        const context = this.extractGateSuggestionContext(prompt);
        // Analyze content for gate requirements
        const contentAnalysis = this.analyzePromptContent(prompt);
        // Generate gate recommendations
        const recommendedGates = this.generateGateRecommendations(context, contentAnalysis);
        // Generate temporary gate suggestions
        const temporaryGates = this.generateTemporaryGateSuggestions(context, contentAnalysis);
        // TODO: Confidence calculation requires semantic LLM layer (future feature)
        // const confidence = this.calculateConfidence(
        //   context,
        //   contentAnalysis,
        //   recommendedGates.length + temporaryGates.length
        // );
        const confidence = 0.0; // Placeholder until semantic LLM integration
        // Create reasoning
        const reasoning = this.generateReasoning(context, contentAnalysis, recommendedGates, temporaryGates);
        // Generate gate configuration preview
        const gateConfigurationPreview = this.generateGateConfigurationPreview(recommendedGates, temporaryGates);
        const result = {
            recommendedGates,
            suggestedTemporaryGates: temporaryGates,
            reasoning,
            confidence,
            gateConfigurationPreview,
        };
        this.logger.debug('[GATE ANALYZER] Analysis complete:', {
            promptId: prompt.id,
            recommendedGatesCount: recommendedGates.length,
            temporaryGatesCount: temporaryGates.length,
            // confidence, // Disabled until semantic LLM integration
        });
        return result;
    }
    /**
     * Extract gate suggestion context from prompt
     */
    extractGateSuggestionContext(prompt) {
        // Determine execution type
        let executionType = 'single';
        if (prompt.chainSteps && prompt.chainSteps.length > 0) {
            executionType = 'chain';
        }
        else if (prompt.systemMessage || (prompt.arguments && prompt.arguments.length > 2)) {
            executionType = 'single';
        }
        // Determine complexity
        let complexity = 'low';
        const complexityIndicators = [
            prompt.arguments?.length || 0,
            prompt.chainSteps?.length || 0,
            prompt.userMessageTemplate.length / 100,
        ];
        const complexityScore = complexityIndicators.reduce((a, b) => a + b, 0);
        if (complexityScore > 10) {
            complexity = 'high';
        }
        else if (complexityScore > 5) {
            complexity = 'medium';
        }
        // Extract intent keywords
        const intentKeywords = this.extractIntentKeywords(prompt.userMessageTemplate);
        const result = {
            executionType,
            category: prompt.category,
            intentKeywords,
            complexity,
        };
        const activeFramework = this.dependencies.frameworkStateManager?.getActiveFramework()?.type;
        if (activeFramework) {
            result.framework = activeFramework;
        }
        return result;
    }
    /**
     * Analyze prompt content for gate indicators
     */
    analyzePromptContent(prompt) {
        const content = (prompt.userMessageTemplate + ' ' + (prompt.systemMessage || '')).toLowerCase();
        return {
            hasDataRequirements: /data|statistics|numbers|metrics|analytics/.test(content),
            hasCodeRequirements: /code|programming|function|class|method|variable/.test(content),
            hasResearchRequirements: /research|analyze|investigate|study|examine/.test(content),
            hasEducationalContent: /learn|teach|explain|understand|clarify/.test(content),
            hasTechnicalContent: /technical|specification|implementation|architecture/.test(content),
            requiresAccuracy: /accurate|precise|correct|verify|validate/.test(content),
            requiresStructure: /structure|organize|format|outline|steps/.test(content),
        };
    }
    /**
     * Generate gate recommendations based on analysis
     */
    generateGateRecommendations(context, contentAnalysis) {
        const gates = [];
        // Content-based recommendations
        if (contentAnalysis.hasCodeRequirements) {
            gates.push('code-quality');
        }
        if (contentAnalysis.hasResearchRequirements) {
            gates.push('research-quality');
        }
        if (contentAnalysis.hasEducationalContent) {
            gates.push('educational-clarity');
        }
        if (contentAnalysis.hasTechnicalContent) {
            gates.push('technical-accuracy');
        }
        if (contentAnalysis.requiresStructure) {
            gates.push('content-structure');
        }
        // Category-based recommendations
        const categoryGates = this.getCategoryGateMapping()[context.category] || [];
        gates.push(...categoryGates);
        // Remove duplicates
        return [...new Set(gates)];
    }
    /**
     * Generate temporary gate suggestions
     */
    generateTemporaryGateSuggestions(context, contentAnalysis) {
        const temporaryGates = [];
        // Data accuracy temporary gate
        if (contentAnalysis.hasDataRequirements) {
            temporaryGates.push({
                name: 'Data Source Verification',
                type: 'validation',
                scope: 'execution',
                description: 'Verify all statistical claims and data sources',
                guidance: 'Ensure all numerical data includes proper citations and verification of accuracy',
                pass_criteria: [
                    {
                        type: 'content_check',
                        message: 'Data sources must be cited',
                        passed: false,
                    },
                ],
                source: 'automatic',
            });
        }
        // Code review temporary gate
        if (contentAnalysis.hasCodeRequirements && context.complexity === 'high') {
            temporaryGates.push({
                name: 'Code Review Standards',
                type: 'validation',
                scope: 'execution',
                description: 'Enhanced code quality validation for complex implementations',
                guidance: 'Apply rigorous code review standards including performance, security, and maintainability',
                pass_criteria: [
                    {
                        type: 'pattern_check',
                        message: 'Code must include error handling',
                        passed: false,
                    },
                ],
                source: 'automatic',
            });
        }
        // Research depth temporary gate
        if (contentAnalysis.hasResearchRequirements && context.executionType === 'chain') {
            temporaryGates.push({
                name: 'Research Depth Validation',
                type: 'validation',
                scope: 'chain',
                description: 'Ensure comprehensive research across all chain steps',
                guidance: 'Each research step must provide multiple perspectives and credible sources',
                source: 'automatic',
            });
        }
        return temporaryGates;
    }
    /**
     * Calculate confidence score
     */
    calculateConfidence(context, contentAnalysis, totalGatesRecommended) {
        let confidence = 0.5; // Base confidence
        // Increase confidence for clear indicators
        const indicators = Object.values(contentAnalysis).filter(Boolean).length;
        confidence += indicators * 0.05;
        // Adjust for context clarity
        if (context.category !== 'general')
            confidence += 0.1;
        if (context.framework)
            confidence += 0.1;
        if (context.intentKeywords && context.intentKeywords.length > 0)
            confidence += 0.1;
        // Adjust for recommendation count
        if (totalGatesRecommended > 0)
            confidence += 0.1;
        if (totalGatesRecommended > 3)
            confidence += 0.1;
        return Math.min(confidence, 1.0);
    }
    /**
     * Generate reasoning for recommendations
     */
    generateReasoning(context, contentAnalysis, recommendedGates, temporaryGates) {
        const reasoning = [];
        reasoning.push(`Analyzed ${context.executionType} with ${context.complexity} complexity in ${context.category} category`);
        if (contentAnalysis.hasCodeRequirements) {
            reasoning.push('Detected code requirements - recommended code quality gates');
        }
        if (contentAnalysis.hasResearchRequirements) {
            reasoning.push('Detected research requirements - recommended research quality gates');
        }
        if (contentAnalysis.hasEducationalContent) {
            reasoning.push('Detected educational content - recommended clarity-focused gates');
        }
        if (temporaryGates.length > 0) {
            reasoning.push(`Suggested ${temporaryGates.length} temporary gates for execution-specific quality control`);
        }
        if (recommendedGates.length === 0 && temporaryGates.length === 0) {
            reasoning.push('No specific gate requirements detected - default gates will apply');
        }
        return reasoning;
    }
    /**
     * Generate gate configuration preview
     */
    generateGateConfigurationPreview(recommendedGates, temporaryGates) {
        const preview = {};
        if (recommendedGates.length > 0) {
            preview.include = recommendedGates;
        }
        if (temporaryGates.length > 0) {
            preview.inline_gate_definitions = temporaryGates;
        }
        // Default to including framework gates unless specifically disabled
        preview.framework_gates = true;
        return preview;
    }
    /**
     * Extract intent keywords from content
     */
    extractIntentKeywords(content) {
        const keywords = [];
        const intentPatterns = {
            analysis: /analyz|investigat|examin|study/gi,
            creation: /creat|generat|build|develop/gi,
            explanation: /explain|clarify|describe|detail/gi,
            validation: /validat|verify|check|confirm/gi,
            optimization: /optim|improv|enhanc|refin/gi,
        };
        for (const [intent, pattern] of Object.entries(intentPatterns)) {
            if (pattern.test(content)) {
                keywords.push(intent);
            }
        }
        return keywords;
    }
    /**
     * Get intent-based gate recommendations
     */
    getIntentBasedGates(intentKeywords) {
        const intentGateMapping = {
            analysis: ['research-quality', 'technical-accuracy'],
            creation: ['content-structure', 'code-quality'],
            explanation: ['educational-clarity', 'content-structure'],
            validation: ['technical-accuracy'],
            optimization: ['code-quality', 'technical-accuracy'],
        };
        const gates = [];
        for (const intent of intentKeywords) {
            const intentGates = intentGateMapping[intent] || [];
            gates.push(...intentGates);
        }
        return [...new Set(gates)];
    }
    /**
     * Get category-based gate mapping
     */
    getCategoryGateMapping() {
        return {
            analysis: ['research-quality', 'technical-accuracy'],
            education: ['educational-clarity', 'content-structure'],
            development: ['code-quality', 'security-awareness'],
            research: ['research-quality', 'technical-accuracy'],
            debugging: ['technical-accuracy', 'code-quality'],
            documentation: ['content-structure', 'educational-clarity'],
            content_processing: ['content-structure'],
            general: ['content-structure'],
        };
    }
    /**
     * Get framework-specific gates
     */
    getFrameworkGates(framework) {
        const frameworkGateMapping = {
            CAGEERF: ['framework-compliance', 'content-structure'],
            ReACT: ['technical-accuracy', 'research-quality'],
            '5W1H': ['content-structure', 'research-quality'],
            SCAMPER: ['educational-clarity'],
        };
        return frameworkGateMapping[framework] || ['framework-compliance'];
    }
}
//# sourceMappingURL=gate-analyzer.js.map