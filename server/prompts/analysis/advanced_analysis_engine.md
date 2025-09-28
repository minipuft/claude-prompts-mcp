# Advanced Analysis Engine

## Description
Complex template testing prompt with advanced Nunjucks features including conditionals, loops, inheritance, filters, and multi-format output generation. Designed to stress-test the template engine with maximum complexity.

## System Message
You are an advanced analysis engine capable of processing complex requests with multiple data sources, analysis types, and output formats. Handle all template complexity gracefully and provide structured, comprehensive analysis. This prompt tests advanced template features including nested conditionals, complex loops, filters, and dynamic content generation.

## User Message Template
# 🔍 Advanced Analysis: {{ topic | title if topic else "General Analysis" }}

## 🎯 Analysis Configuration
{% if analysis_type %}
**Analysis Type**: {{ analysis_type | upper | replace("_", " ") }}
{% else %}
**Analysis Type**: COMPREHENSIVE MULTI-DIMENSIONAL ANALYSIS
{% endif %}

{% set complexity_score = 0 %}
{% if sources %}{% set complexity_score = complexity_score + sources|length %}{% endif %}
{% if focus_areas %}{% set complexity_score = complexity_score + focus_areas|length %}{% endif %}
{% if constraints %}{% set complexity_score = complexity_score + constraints|length %}{% endif %}

**Complexity Score**: {{ complexity_score }} 
{% if complexity_score > 10 %}🔥 MAXIMUM COMPLEXITY{% elif complexity_score > 5 %}⚡ HIGH COMPLEXITY{% else %}📊 STANDARD COMPLEXITY{% endif %}

{% if sources %}
## 📊 Data Sources Strategy
{% for source in sources %}
{% set loop_info = loop %}
{{ loop.index }}. **{{ source | title | replace("_", " ") }}**
   {% if source == "web" %}
   - Current information and real-time trends
   - SEO-optimized content analysis
   - Social sentiment indicators
   {% elif source == "papers" %}
   - Peer-reviewed research and academic insights
   - Methodological rigor and scientific validation
   - Historical context and longitudinal studies
   {% elif source == "news" %}
   - Breaking developments and current events
   - Media bias analysis and fact-checking
   - Timeline construction and event correlation
   {% elif source == "social" %}
   - Public opinion and sentiment analysis
   - Viral trend identification
   - Demographic and geographic distribution
   {% elif source == "industry" %}
   - Market reports and industry intelligence
   - Competitive landscape analysis
   - Regulatory and compliance considerations
   {% elif source == "expert" %}
   - Professional opinions and expert interviews
   - Specialized knowledge and insider perspectives
   - Best practices and lessons learned
   {% else %}
   - {{ source | title }} data collection and analysis
   - Source-specific validation and verification
   - Integration with primary research methods
   {% endif %}
   {% if loop.first %}**PRIMARY SOURCE** - Foundation for analysis{% endif %}
   {% if loop.last %}**VALIDATION SOURCE** - Final verification and cross-reference{% endif %}
   {% if loop.length > 3 and loop.index == loop.length // 2 %}**PIVOT SOURCE** - Mid-analysis validation{% endif %}
{% endfor %}

### Source Integration Matrix
{% for source in sources %}
{% for other_source in sources %}
{% if source != other_source %}
- **{{ source|title }} ↔ {{ other_source|title }}**: {% if source == "web" and other_source == "papers" %}Validate web claims with academic research{% elif source == "news" and other_source == "social" %}Cross-reference news with social sentiment{% else %}Comparative analysis and validation{% endif %}
{% endif %}
{% endfor %}
{% endfor %}
{% else %}
## 📊 Standard Data Sources
1. **Web Research** - Current information and trends
2. **Academic Papers** - Scholarly perspective and research  
3. **News Articles** - Recent developments and context
4. **Industry Reports** - Market intelligence and analysis
{% endif %}

{% if depth %}
## 🎚️ Analysis Depth: {{ depth | title }}
{% set depth_config = {
  "surface": {
    "description": "Quick overview and key highlights",
    "time_estimate": "15-30 minutes",
    "output_length": "2-3 pages", 
    "detail_level": "High-level summary with actionable insights"
  },
  "standard": {
    "description": "Detailed examination of core topics",
    "time_estimate": "1-2 hours",
    "output_length": "5-8 pages",
    "detail_level": "Comprehensive analysis with supporting evidence"
  },
  "comprehensive": {
    "description": "Deep-dive analysis across all dimensions", 
    "time_estimate": "3-5 hours",
    "output_length": "10-15 pages",
    "detail_level": "Multi-perspective evaluation with detailed frameworks"
  },
  "expert": {
    "description": "Expert-level technical analysis",
    "time_estimate": "6+ hours", 
    "output_length": "15+ pages",
    "detail_level": "Advanced methodology with strategic recommendations"
  }
} %}

{% set current_depth = depth_config[depth] if depth in depth_config else depth_config["standard"] %}

- **Description**: {{ current_depth.description }}
- **Estimated Time**: {{ current_depth.time_estimate }}
- **Expected Output**: {{ current_depth.output_length }}
- **Detail Level**: {{ current_depth.detail_level }}

{% if depth == "expert" %}
### Expert Analysis Framework
- Advanced statistical analysis and modeling
- Multi-dimensional correlation mapping
- Predictive analytics and scenario planning
- Risk assessment matrices and mitigation strategies
{% endif %}
{% endif %}

{% if constraints %}
## ⚙️ Analysis Constraints & Parameters
{% for key, value in constraints.items() %}
- **{{ key | replace("_", " ") | title }}**: {{ value }}
  {% if key == "time_limit" %}*Prioritizing high-impact insights within timeframe*{% endif %}
  {% if key == "budget" %}*Cost-effective research methods and resource allocation*{% endif %}
  {% if key == "scope" %}*Focused analysis boundaries and exclusion criteria*{% endif %}
  {% if key == "audience" %}*Content and presentation tailored for {{ value }}*{% endif %}
{% endfor %}

### Constraint Impact Assessment
{% if constraints.time_limit %}
⏱️ **Time Pressure**: Accelerated methodology with focus on critical insights
{% endif %}
{% if constraints.budget %}
💰 **Budget Optimization**: Prioritized research activities and cost-effective approaches  
{% endif %}
{% if constraints.scope %}
🎯 **Scope Management**: Clear boundaries prevent scope creep and maintain focus
{% endif %}
{% endif %}

{% if focus_areas %}
## 🔍 Multi-Dimensional Focus Areas
{% for area in focus_areas %}
### {{ loop.index }}. {{ area | title }} Analysis Framework
{% if area == "technical" %}
#### Technical Deep-Dive
- **Architecture & Design**: System specifications and technical requirements
- **Implementation Details**: Development methodologies and best practices  
- **Performance Metrics**: Benchmarking, optimization, and scalability analysis
- **Technology Stack**: Tools, frameworks, and platform considerations
- **Risk Assessment**: Technical debt, security vulnerabilities, maintenance overhead
{% elif area == "business" %}
#### Business Impact Analysis
- **Market Dynamics**: Competitive landscape and positioning strategies
- **Financial Modeling**: Revenue projections, cost analysis, and ROI calculations
- **Strategic Alignment**: Business objectives and organizational fit
- **Stakeholder Impact**: Customer, partner, and internal team considerations
- **Go-to-Market**: Launch strategies, marketing approaches, and sales enablement
{% elif area == "ethical" %}
#### Ethical Framework Evaluation
- **Moral Implications**: Ethical principles and moral reasoning analysis
- **Stakeholder Impact**: Effects on users, communities, and society
- **Privacy & Rights**: Data protection, consent, and individual autonomy
- **Fairness & Bias**: Algorithmic fairness and discrimination prevention
- **Transparency**: Explainability, accountability, and public discourse
{% elif area == "regulatory" %}
#### Regulatory Compliance Analysis
- **Legal Framework**: Applicable laws, regulations, and compliance requirements
- **Risk Assessment**: Legal exposure, liability, and mitigation strategies
- **Policy Implications**: Government relations and regulatory strategy
- **International Considerations**: Cross-border regulations and harmonization
- **Future Regulations**: Anticipated regulatory changes and preparation strategies
{% elif area == "social" %}
#### Social Impact Assessment
- **Community Effects**: Local and global community implications
- **Cultural Considerations**: Cross-cultural sensitivity and adaptation
- **Public Opinion**: Social acceptance and public discourse analysis
- **Digital Divide**: Accessibility and inclusion considerations
- **Behavioral Change**: Individual and collective behavior modifications
{% elif area == "environmental" %}
#### Environmental Sustainability Analysis
- **Carbon Footprint**: Environmental impact and sustainability metrics
- **Resource Usage**: Energy consumption and resource optimization
- **Lifecycle Assessment**: End-to-end environmental impact evaluation
- **Green Alternatives**: Sustainable approaches and eco-friendly solutions
- **Regulatory Environment**: Environmental regulations and compliance
{% else %}
#### {{ area | title }} Framework
- **Core Principles**: Fundamental concepts and guiding principles
- **Key Considerations**: Critical factors and decision points
- **Impact Assessment**: Quantitative and qualitative impact evaluation
- **Risk Factors**: Potential challenges and mitigation strategies
- **Best Practices**: Industry standards and recommended approaches
{% endif %}

{% if not loop.last %}
---
{% endif %}
{% endfor %}

### Focus Area Integration Matrix
{% for area1 in focus_areas %}
{% for area2 in focus_areas %}
{% if area1 != area2 and loop.index0 < loop.index %}
- **{{ area1|title }} ↔ {{ area2|title }}**: Cross-dimensional analysis and synergy identification
{% endif %}
{% endfor %}
{% endfor %}
{% else %}
## 🔍 Standard Analysis Framework
1. **Contextual Overview** - Current state and background analysis
2. **Trend Identification** - Pattern recognition and trend analysis
3. **Impact Assessment** - Quantitative and qualitative impact evaluation
4. **Strategic Implications** - Long-term considerations and planning
5. **Actionable Recommendations** - Specific next steps and implementation guidance
{% endif %}

{% if format %}
## 📋 Output Format Specification: {{ format | title | replace("_", " ") }}
{% set format_specs = {
  "executive_summary": {
    "structure": "Executive Summary → Key Findings → Strategic Recommendations → Appendices",
    "length": "2-4 pages + supporting materials",
    "audience": "C-level executives, board members, and senior decision makers",
    "style": "Concise, decision-focused, high-level strategic content",
    "sections": ["Executive Overview", "Critical Insights", "Strategic Options", "Resource Requirements", "Timeline & Milestones"]
  },
  "technical_report": {
    "structure": "Technical Overview → Detailed Analysis → Implementation Guide → Technical Appendices",
    "length": "10-20 pages + technical documentation", 
    "audience": "Technical teams, engineers, and implementation specialists",
    "style": "Detailed, implementation-focused, technical depth",
    "sections": ["Technical Architecture", "Detailed Specifications", "Implementation Roadmap", "Technical Risks", "Testing & Validation"]
  },
  "presentation": {
    "structure": "Slide deck with executive summary, detailed findings, and action items",
    "length": "15-25 slides + speaker notes",
    "audience": "Mixed stakeholder groups and meeting presentations", 
    "style": "Visual, presentation-ready, engaging narrative",
    "sections": ["Problem Statement", "Analysis Overview", "Key Findings", "Recommendations", "Next Steps"]
  },
  "research_paper": {
    "structure": "Abstract → Introduction → Literature Review → Analysis → Discussion → Conclusions → References",
    "length": "15-30 pages + extensive bibliography",
    "audience": "Academic researchers, policy makers, and domain experts",
    "style": "Academic rigor, peer-review ready, comprehensive citations",
    "sections": ["Abstract", "Introduction", "Methodology", "Results & Analysis", "Discussion", "Conclusions", "Future Research"]
  }
} %}

{% set current_format = format_specs[format] if format in format_specs else format_specs["executive_summary"] %}

### Format Configuration
- **Structure**: {{ current_format.structure }}
- **Expected Length**: {{ current_format.length }}
- **Target Audience**: {{ current_format.audience }}
- **Writing Style**: {{ current_format.style }}

### Content Sections
{% for section in current_format.sections %}
{{ loop.index }}. **{{ section }}**
{% endfor %}

### Presentation Guidelines
{% if format == "executive_summary" %}
- Lead with bottom-line impact and recommendations
- Use bullet points and executive-friendly language
- Include financial implications and resource requirements
- Provide clear decision points and options
{% elif format == "technical_report" %}
- Include detailed technical specifications and diagrams
- Provide step-by-step implementation guidance
- Document technical dependencies and requirements
- Include testing procedures and validation methods
{% elif format == "presentation" %}
- Design slide-ready content with clear headings
- Include data visualizations and infographics
- Provide speaker notes and presentation guidance
- Structure for 30-45 minute presentation window
{% elif format == "research_paper" %}
- Follow academic formatting and citation standards
- Include comprehensive literature review and methodology
- Provide detailed statistical analysis and evidence
- Structure for peer review and academic publication
{% endif %}
{% endif %}

{% if previous_context %}
## 🔗 Building Upon Previous Analysis
**Previous Context Integration:**
{{ previous_context }}

### Continuity Framework
- **Historical Baseline**: Previous findings serve as analytical foundation
- **Evolutionary Analysis**: Changes and developments since last analysis
- **Gap Identification**: Areas requiring additional investigation
- **Trend Validation**: Confirmation or revision of previous predictions
{% endif %}

{% if requirements %}
## ✅ Specific Requirements & Success Criteria
{% for req in requirements %}
{% if req is string %}
{{ loop.index }}. {{ req }}
{% else %}
{{ loop.index }}. **{{ req.category | default("General Requirement") | title }}**: {{ req.description }}
   {% if req.priority %}
   - **Priority Level**: {{ req.priority | upper }}
   {% if req.priority == "critical" %}🔴 CRITICAL - Must be addressed in core analysis
   {% elif req.priority == "high" %}🟡 HIGH - Primary focus area
   {% elif req.priority == "medium" %}🟢 MEDIUM - Important but not critical
   {% else %}⚪ LOW - Include if time/resources permit{% endif %}
   {% endif %}
   {% if req.examples %}
   - **Examples**: {% for ex in req.examples %}{{ ex }}{% if not loop.last %}, {% endif %}{% endfor %}
   {% endif %}
   {% if req.success_criteria %}
   - **Success Criteria**: {{ req.success_criteria }}
   {% endif %}
{% endif %}
{% endfor %}

### Requirements Validation Matrix
{% for req in requirements %}
{% if req is not string and req.priority %}
- **{{ req.category | default("Requirement " + loop.index|string) }}** ({{ req.priority|upper }}): Validation method and acceptance criteria
{% endif %}
{% endfor %}
{% endif %}

---

## 🎯 Analysis Execution Framework

### Phase 1: Foundation & Context
- Establish analytical baseline and context
- Validate scope and constraints alignment
- Confirm data source accessibility and reliability

### Phase 2: Multi-Dimensional Investigation  
{% if focus_areas %}
{% for area in focus_areas %}
- **{{ area|title }} Analysis**: Deep-dive investigation and assessment
{% endfor %}
{% else %}
- Comprehensive investigation across all relevant dimensions
{% endif %}

### Phase 3: Integration & Synthesis
- Cross-dimensional pattern identification
- Insight synthesis and framework development
- Validation against requirements and constraints

### Phase 4: Recommendations & Implementation
- Strategic recommendation development
- Implementation pathway design
- Risk assessment and mitigation planning

---

**🚀 Analysis Request Summary:**
- **Topic**: {{ topic }}
- **Complexity**: {% if sources and focus_areas and constraints %}Maximum ({{ complexity_score }} complexity points){% elif focus_areas or constraints %}High{% else %}Standard{% endif %}
- **Expected Deliverable**: {{ format | default("Comprehensive Analysis") | title }}
- **Timeline**: {% if constraints.time_limit %}{{ constraints.time_limit }}{% else %}Standard delivery window{% endif %}

{% set template_features_used = [] %}
{% if sources %}{% set _ = template_features_used.append("Dynamic source configuration") %}{% endif %}
{% if focus_areas %}{% set _ = template_features_used.append("Multi-dimensional framework") %}{% endif %}
{% if constraints %}{% set _ = template_features_used.append("Constraint optimization") %}{% endif %}
{% if requirements %}{% set _ = template_features_used.append("Requirements validation") %}{% endif %}
{% if format %}{% set _ = template_features_used.append("Format specialization") %}{% endif %}

**🔧 Template Features Active**: {{ template_features_used | join(", ") | default("Standard template rendering") }}

---

Please provide a comprehensive analysis following the above specifications. Ensure all requested dimensions are covered, the output matches the specified format requirements, and the analysis demonstrates the full complexity and capability of this advanced template system.
