# OutputSchema Real-Time Progress & Gate Validation Implementation Plan

## Overview

This plan integrates real-time progress tracking with visual gate validation to create a comprehensive user experience for chain executions and quality gate monitoring. The implementation builds upon the current Option 2 (Minimal Compliance) foundation while adding progressive enhancement capabilities for modern MCP clients.

## Core Feature Integration

### 1. Real-Time Progress Tracking

#### Chain Execution Progress
- **Live Progress Bars**: Visual percentage indicators for overall chain completion
- **Step-by-Step Status**: Individual step progress with state transitions (pending → running → completed/failed)
- **Time Analytics**: Real-time ETA calculations based on historical execution patterns
- **Performance Metrics**: Live memory usage, CPU utilization, and execution speed tracking
- **Multi-Chain Monitoring**: Concurrent chain execution progress with session isolation

#### Progress Data Structure
```typescript
interface RealTimeChainProgress extends ChainProgress {
  // Enhanced progress tracking
  progressPercentage: number;           // 0-100 overall completion
  estimatedTimeRemaining: number;       // ETA in milliseconds
  currentStepProgress: number;          // 0-100 current step completion

  // Performance metrics
  performanceMetrics: {
    memoryUsage: NodeJS.MemoryUsage;
    executionSpeed: number;             // steps per second
    resourceUtilization: number;        // 0-1 CPU/memory usage
  };

  // Historical context
  averageStepTime: number;             // milliseconds
  slowestStepId?: string;
  fastestStepId?: string;
}
```

### 2. Visual Gate Validation

#### Interactive Validation Display
- **Real-Time Gate Status**: Live indicators showing gate evaluation progress
- **Quality Score Visualization**: Graphical representation of validation scores (0-1 range)
- **Detailed Failure Analysis**: Structured explanations with actionable recommendations
- **Retry Mechanism Integration**: Visual retry controls with attempt tracking
- **Validation History**: Historical gate performance with trend analysis

#### Gate Validation Data Structure
```typescript
interface VisualGateValidation extends GateValidationResult {
  // Enhanced validation tracking
  validationProgress: number;          // 0-100 validation completion
  currentGateIndex: number;            // Which gate is being evaluated

  // Visual representation data
  gateStatusMap: Map<string, {
    status: 'pending' | 'running' | 'passed' | 'failed';
    score?: number;
    progressPercentage: number;
    startTime: number;
    estimatedCompletion?: number;
  }>;

  // Retry mechanism
  retryAttempts: Array<{
    attemptNumber: number;
    timestamp: number;
    result: 'passed' | 'failed' | 'timeout';
    improvedGates: string[];           // Gates that passed after retry
  }>;

  // User actionable data
  recommendations: Array<{
    gateId: string;
    priority: 'high' | 'medium' | 'low';
    actionType: 'retry' | 'modify' | 'skip' | 'review';
    description: string;
    estimatedFixTime?: number;
  }>;
}
```

## Technical Implementation Strategy

### Phase 1: Schema Enhancement (Week 1)

#### Enhanced OutputSchema Definitions
```typescript
// Extend existing chainProgressSchema
export const enhancedChainProgressSchema = chainProgressSchema.extend({
  progressPercentage: z.number().min(0).max(100),
  estimatedTimeRemaining: z.number().optional(),
  currentStepProgress: z.number().min(0).max(100),
  performanceMetrics: z.object({
    memoryUsage: z.object({
      heapUsed: z.number(),
      heapTotal: z.number(),
      external: z.number()
    }),
    executionSpeed: z.number(),
    resourceUtilization: z.number().min(0).max(1)
  }),
  averageStepTime: z.number(),
  slowestStepId: z.string().optional(),
  fastestStepId: z.string().optional()
});

// Enhanced gate validation schema
export const visualGateValidationSchema = gateValidationSchema.extend({
  validationProgress: z.number().min(0).max(100),
  currentGateIndex: z.number(),
  gateStatusMap: z.record(z.object({
    status: z.enum(['pending', 'running', 'passed', 'failed']),
    score: z.number().optional(),
    progressPercentage: z.number().min(0).max(100),
    startTime: z.number(),
    estimatedCompletion: z.number().optional()
  })),
  retryAttempts: z.array(z.object({
    attemptNumber: z.number(),
    timestamp: z.number(),
    result: z.enum(['passed', 'failed', 'timeout']),
    improvedGates: z.array(z.string())
  })),
  recommendations: z.array(z.object({
    gateId: z.string(),
    priority: z.enum(['high', 'medium', 'low']),
    actionType: z.enum(['retry', 'modify', 'skip', 'review']),
    description: z.string(),
    estimatedFixTime: z.number().optional()
  }))
});
```

#### Integration Points
- **ChainSessionManager**: Add progress tracking hooks to existing session management
- **GateEvaluator**: Enhance gate evaluation with progress callbacks
- **FrameworkStateManager**: Add performance metrics collection
- **ResponseFormatter**: Extend formatters to handle enhanced schemas

### Phase 2: Real-Time Infrastructure (Week 2)

#### SSE Event Streaming
```typescript
// New progress event types
export enum ProgressEventType {
  CHAIN_STARTED = 'chain:started',
  CHAIN_PROGRESS = 'chain:progress',
  STEP_STARTED = 'step:started',
  STEP_COMPLETED = 'step:completed',
  GATE_VALIDATION_STARTED = 'gate:validation:started',
  GATE_VALIDATION_PROGRESS = 'gate:validation:progress',
  GATE_VALIDATION_COMPLETED = 'gate:validation:completed',
  EXECUTION_METRICS = 'execution:metrics'
}

// Progress event streaming service
export class ProgressEventStreamer {
  private sseConnections: Map<string, Response> = new Map();

  broadcast(eventType: ProgressEventType, data: any): void {
    const event = {
      type: eventType,
      timestamp: Date.now(),
      data
    };

    this.sseConnections.forEach((response, clientId) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    });
  }

  addClient(clientId: string, response: Response): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    this.sseConnections.set(clientId, response);
  }
}
```

#### Chain Execution Integration
```typescript
// Enhanced ChainOrchestrator with progress tracking
export class EnhancedChainOrchestrator extends ChainOrchestrator {
  private progressStreamer: ProgressEventStreamer;

  async executeStep(
    session: ChainExecutionSession,
    stepId: string
  ): Promise<StepExecutionResult> {
    // Emit step start event
    this.progressStreamer.broadcast(ProgressEventType.STEP_STARTED, {
      sessionId: session.sessionId,
      stepId,
      stepName: session.chainDefinition.steps[stepId]?.name,
      progressPercentage: this.calculateOverallProgress(session, stepId)
    });

    // Execute step with performance monitoring
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    const result = await super.executeStep(session, stepId);

    // Calculate performance metrics
    const executionTime = Date.now() - startTime;
    const endMemory = process.memoryUsage();
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;

    // Emit progress update
    this.progressStreamer.broadcast(ProgressEventType.CHAIN_PROGRESS, {
      sessionId: session.sessionId,
      currentStep: stepId,
      progressPercentage: this.calculateOverallProgress(session, stepId),
      estimatedTimeRemaining: this.calculateETA(session, stepId),
      performanceMetrics: {
        stepExecutionTime: executionTime,
        memoryDelta,
        currentMemoryUsage: endMemory
      }
    });

    return result;
  }
}
```

### Phase 3: Gate Validation Enhancement (Week 3)

#### Enhanced Gate Evaluation
```typescript
export class VisualGateEvaluator extends BaseGateEvaluator {
  private progressStreamer: ProgressEventStreamer;

  async evaluateGates(
    content: string,
    gates: GateDefinition[],
    context: EvaluationContext
  ): Promise<VisualGateValidation> {
    const sessionId = context.sessionId || 'anonymous';

    // Initialize gate status map
    const gateStatusMap = new Map();
    gates.forEach((gate, index) => {
      gateStatusMap.set(gate.id, {
        status: 'pending',
        progressPercentage: 0,
        startTime: 0
      });
    });

    // Emit validation start event
    this.progressStreamer.broadcast(ProgressEventType.GATE_VALIDATION_STARTED, {
      sessionId,
      totalGates: gates.length,
      gateStatusMap: Object.fromEntries(gateStatusMap)
    });

    const results: GateEvaluationResult[] = [];
    const retryAttempts: Array<any> = [];

    for (let i = 0; i < gates.length; i++) {
      const gate = gates[i];

      // Update gate status to running
      gateStatusMap.set(gate.id, {
        status: 'running',
        progressPercentage: 0,
        startTime: Date.now()
      });

      // Emit progress update
      this.progressStreamer.broadcast(ProgressEventType.GATE_VALIDATION_PROGRESS, {
        sessionId,
        currentGateIndex: i,
        currentGateId: gate.id,
        overallProgress: (i / gates.length) * 100,
        gateStatusMap: Object.fromEntries(gateStatusMap)
      });

      // Evaluate gate with progress callbacks
      const result = await this.evaluateGateWithProgress(gate, content, context, (progress) => {
        gateStatusMap.set(gate.id, {
          status: 'running',
          progressPercentage: progress,
          startTime: gateStatusMap.get(gate.id)!.startTime
        });

        this.progressStreamer.broadcast(ProgressEventType.GATE_VALIDATION_PROGRESS, {
          sessionId,
          currentGateIndex: i,
          currentGateId: gate.id,
          currentGateProgress: progress,
          overallProgress: ((i + progress/100) / gates.length) * 100,
          gateStatusMap: Object.fromEntries(gateStatusMap)
        });
      });

      // Update final status
      gateStatusMap.set(gate.id, {
        status: result.passed ? 'passed' : 'failed',
        progressPercentage: 100,
        startTime: gateStatusMap.get(gate.id)!.startTime,
        score: result.score
      });

      results.push(result);

      // Handle retry logic if gate failed
      if (!result.passed && gate.allowRetry) {
        const retryResult = await this.handleGateRetry(gate, content, context, retryAttempts);
        if (retryResult) {
          gateStatusMap.set(gate.id, {
            status: 'passed',
            progressPercentage: 100,
            startTime: gateStatusMap.get(gate.id)!.startTime,
            score: retryResult.score
          });
          results[results.length - 1] = retryResult;
        }
      }
    }

    // Generate recommendations
    const recommendations = this.generateActionableRecommendations(results, gates);

    // Emit final validation complete event
    this.progressStreamer.broadcast(ProgressEventType.GATE_VALIDATION_COMPLETED, {
      sessionId,
      overallResult: results.every(r => r.passed),
      totalTime: Date.now() - (gateStatusMap.values().next().value?.startTime || 0),
      recommendations
    });

    return {
      ...this.consolidateResults(results),
      validationProgress: 100,
      currentGateIndex: gates.length - 1,
      gateStatusMap: Object.fromEntries(gateStatusMap),
      retryAttempts,
      recommendations
    };
  }
}
```

### Phase 4: Client Integration (Week 4)

#### WebUI Components
```typescript
// React component for chain progress visualization
export const ChainProgressTracker: React.FC<{
  sessionId: string;
  onComplete?: (result: ChainExecutionResult) => void;
}> = ({ sessionId, onComplete }) => {
  const [progress, setProgress] = useState<RealTimeChainProgress | null>(null);
  const [gateValidation, setGateValidation] = useState<VisualGateValidation | null>(null);

  useEffect(() => {
    // Connect to SSE stream
    const eventSource = new EventSource(`/api/progress/stream/${sessionId}`);

    eventSource.addEventListener('chain:progress', (event) => {
      const data = JSON.parse(event.data);
      setProgress(data);
    });

    eventSource.addEventListener('gate:validation:progress', (event) => {
      const data = JSON.parse(event.data);
      setGateValidation(data);
    });

    return () => eventSource.close();
  }, [sessionId]);

  return (
    <div className="chain-progress-tracker">
      <ChainProgressBar progress={progress} />
      <StepStatusIndicators steps={progress?.steps || []} />
      <GateValidationDisplay validation={gateValidation} />
      <PerformanceMetrics metrics={progress?.performanceMetrics} />
    </div>
  );
};
```

#### MCP Client Integration
```typescript
// Enhanced MCP client with progress tracking
export class ProgressAwareMCPClient extends MCPClient {
  private progressCallbacks: Map<string, (progress: any) => void> = new Map();

  async executeChainWithProgress(
    chainId: string,
    args: any,
    onProgress?: (progress: RealTimeChainProgress) => void,
    onGateValidation?: (validation: VisualGateValidation) => void
  ): Promise<ToolResponse> {
    const sessionId = generateSessionId();

    // Register progress callbacks
    if (onProgress) {
      this.progressCallbacks.set(`${sessionId}:progress`, onProgress);
    }
    if (onGateValidation) {
      this.progressCallbacks.set(`${sessionId}:gate`, onGateValidation);
    }

    // Execute chain with enhanced response parsing
    const response = await this.callTool('prompt_engine', {
      command: `>>${chainId}`,
      ...args,
      sessionOptions: {
        sessionId,
        trackProgress: true,
        enableGateVisualization: true
      }
    });

    // Parse structured content for progress data
    if (response.structuredContent?.chainProgress) {
      onProgress?.(response.structuredContent.chainProgress);
    }

    if (response.structuredContent?.gateValidation) {
      onGateValidation?.(response.structuredContent.gateValidation);
    }

    return response;
  }
}
```

### Phase 5: Backward Compatibility & Progressive Enhancement

#### Compatibility Strategy
```typescript
// Feature detection and graceful degradation
export class ProgressCompatibilityLayer {
  static detectClientCapabilities(request: Request): ClientCapabilities {
    const userAgent = request.headers['user-agent'] || '';
    const acceptHeader = request.headers.accept || '';

    return {
      supportsSSE: acceptHeader.includes('text/event-stream'),
      supportsStructuredOutput: request.headers['x-mcp-structured'] === 'true',
      supportsProgressTracking: request.headers['x-progress-tracking'] === 'true',
      clientType: this.identifyClientType(userAgent)
    };
  }

  static adaptResponse(
    response: ToolResponse,
    capabilities: ClientCapabilities
  ): ToolResponse {
    if (!capabilities.supportsStructuredOutput) {
      // Return Option 2 minimal compliance response
      return {
        content: response.content,
        isError: response.isError
      };
    }

    if (!capabilities.supportsProgressTracking) {
      // Remove progress-specific structured data
      const { chainProgress, gateValidation, ...otherData } = response.structuredContent || {};
      return {
        ...response,
        structuredContent: otherData
      };
    }

    return response; // Full enhanced response
  }
}
```

## Implementation Benefits

### User Experience Enhancement
- **Visual Feedback**: Clear progress indicators reduce uncertainty during long-running operations
- **Error Understanding**: Detailed gate validation results help users understand and fix issues
- **Performance Insights**: Real-time metrics help users optimize their chains and prompts
- **Professional Interface**: Modern UI components suitable for enterprise environments

### Developer Benefits
- **Debugging Capabilities**: Detailed progress tracking aids in identifying bottlenecks
- **Performance Optimization**: Real-time metrics enable performance tuning
- **Quality Assurance**: Enhanced gate validation improves output quality
- **Extensibility**: Modular design allows easy addition of new progress types

### System Integration
- **Backward Compatible**: Maintains Option 2 minimal compliance as foundation
- **Progressive Enhancement**: Advanced features only activate for capable clients
- **Scalable Architecture**: Event-driven design supports multiple concurrent clients
- **Future-Proof**: Extensible schema design accommodates future enhancements

## Success Metrics

### Technical Metrics
- **Performance Impact**: < 5% overhead for progress tracking
- **Memory Usage**: < 10MB additional memory for progress state
- **Response Time**: < 100ms additional latency for enhanced responses
- **Compatibility**: 100% backward compatibility maintained

### User Experience Metrics
- **Progress Clarity**: Users report clear understanding of execution status
- **Error Resolution**: Reduced time to fix gate validation failures
- **Perceived Performance**: Improved user satisfaction with long-running operations
- **Adoption Rate**: Percentage of clients utilizing enhanced features

## Risk Mitigation

### Performance Risks
- **Mitigation**: Configurable progress granularity (can reduce update frequency)
- **Monitoring**: Real-time performance impact measurement
- **Fallback**: Automatic degradation to minimal compliance if performance degrades

### Compatibility Risks
- **Mitigation**: Comprehensive client capability detection
- **Testing**: Automated testing with various client types
- **Documentation**: Clear migration guides for client implementations

### Implementation Complexity
- **Mitigation**: Phased rollout with incremental feature addition
- **Testing**: Extensive integration testing at each phase
- **Documentation**: Detailed implementation guides and examples

This implementation plan provides a comprehensive foundation for real-time progress tracking and visual gate validation while maintaining the stability and compatibility of the existing system.