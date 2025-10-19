# Component Flow Analysis

## Description
Comprehensive component review that tracks data flow, lifecycle, dependencies, and integration points

## User Message Template
Analyze the following {{framework}} component and provide a comprehensive flow analysis:

**Component Path**: {{component_path}}
**Component Code**:
```{{language}}
{{component_code}}
```

## Analysis Framework

### 1. Component Overview
- **Purpose**: What problem does this component solve?
- **Type**: Presentational, Container, Higher-Order Component, Hook, etc.
- **Complexity Level**: Simple, Moderate, Complex
- **Primary Responsibilities**: List core functions

### 2. Data Flow Analysis

#### Inputs (Props/Parameters)
- List all props/parameters with types
- Identify required vs optional inputs
- Document default values
- Track prop drilling depth (if applicable)

#### State Management
- Local state variables and their purpose
- External state (Context, Redux, Zustand, etc.)
- State update triggers and effects
- State flow diagram (describe transitions)

#### Outputs
- Events emitted/callbacks invoked
- Side effects triggered
- Data transformations performed
- Return values or rendered output

### 3. Lifecycle & Execution Flow

#### Initialization Phase
- Constructor/setup logic
- Initial data fetching
- Subscription establishment
- Effect registration

#### Update Phase
- Re-render triggers
- Update dependencies
- Optimization strategies (memoization, etc.)
- Performance considerations

#### Cleanup Phase
- Cleanup operations
- Subscription teardown
- Memory leak prevention
- Resource disposal

### 4. Dependency Analysis

#### Internal Dependencies
- Other components used/imported
- Utility functions called
- Custom hooks utilized
- Internal modules referenced

#### External Dependencies
- Third-party libraries
- API endpoints called
- External services integrated
- Browser APIs used

#### Circular Dependencies
- Identify any circular dependency risks
- Suggest refactoring if needed

### 5. Integration Points

#### Parent Components
- How is this component used by parents?
- What context does it expect?
- Required wrapper components

#### Child Components
- What components does it render?
- How does it communicate with children?
- Data passed down to children

#### Sibling Communication
- Event bus usage
- Shared state access
- Cross-component messaging

### 6. Event Flow & User Interactions

#### User Events Handled
- Click, input, scroll, etc.
- Event handlers and their flow
- Event propagation (bubbling/capturing)

#### Custom Events
- Events dispatched by this component
- Event payload structure
- Event consumers

#### Async Operations
- API calls and their triggers
- Loading states management
- Error handling flow
- Success/failure callbacks

### 7. Rendering Flow

#### Conditional Rendering
- Rendering conditions and branches
- Loading states UI
- Error states UI
- Empty states UI

#### Dynamic Content
- List rendering logic
- Dynamic children generation
- Content interpolation

#### Performance Optimization
- Memoization usage
- Lazy loading implementation
- Virtual scrolling (if applicable)
- Code splitting points

### 8. Side Effects & External Interactions

#### API Interactions
- Endpoints called
- Request/response flow
- Caching strategy
- Error handling

#### Browser APIs
- LocalStorage/SessionStorage
- Geolocation, notifications, etc.
- DOM manipulation
- Navigation/routing

#### Third-Party Services
- Analytics tracking
- Error monitoring
- Feature flags
- Authentication services

### 9. Data Transformation Pipeline

Trace how data flows through the component:
1. **Input** → What raw data comes in?
2. **Processing** → How is it transformed?
3. **Storage** → Where is it stored (if at all)?
4. **Display** → How is it presented to users?
5. **Output** → What data/events go out?

### 10. Flow Diagram

Provide a text-based flow diagram showing:
- Component initialization
- Data flow paths
- User interaction flows
- Async operation flows
- Cleanup sequences

Example format:
```
User Action (click) 
  → Event Handler (handleSubmit)
    → Validation Logic
      → API Call (submitData)
        → Loading State (setIsLoading: true)
        → Success: Update State → Re-render
        → Error: Show Error Message → Re-render
```

### 11. Issues & Recommendations

#### Potential Issues
- Code smells identified
- Performance bottlenecks
- Accessibility concerns
- Security vulnerabilities
- Maintenance challenges

#### Optimization Opportunities
- Refactoring suggestions
- Performance improvements
- Code organization enhancements
- Pattern improvements

#### Best Practices Compliance
- Does it follow framework conventions?
- Proper error handling?
- Accessibility implemented?
- Type safety enforced?

## Summary

Provide a concise summary including:
- Component health score (1-10)
- Primary data flows identified
- Key integration points
- Critical dependencies
- Recommended next actions
