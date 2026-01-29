# Designated Heritage Assets Service Schema
## Policy-as-Code Implementation v1.0.0

### Overview

This schema represents a comprehensive policy-as-code implementation for designated heritage assets services, capturing the complete statutory framework, national policy, technical guidance, and operational processes for heritage protection under English planning law.

### Legislative Foundation

The schema encodes three layers of authority:

1. **Primary Legislation**: Planning (Listed Buildings and Conservation Areas) Act 1990
2. **National Policy**: NPPF Chapter 16 (Conserving and enhancing the historic environment)
3. **Technical Guidance**: Historic England Advice Notes (HEAN 2, 10, 12, 16, etc.)

### Key Innovation: Statutory Duties as Computable Logic

Unlike traditional service documentation, this schema makes statutory duties machine-readable:

```json
{
  "section": "Section 66",
  "statutoryDuty": "In considering whether to grant planning permission for development which affects a listed building or its setting, the local planning authority shall have special regard to the desirability of preserving the building or its setting",
  "criticalPrinciples": [
    "Applies to planning permission (separate from LBC)",
    "Statutory duty to have 'special regard'",
    "Case law: requires 'considerable importance and weight' (Barnwell Manor)"
  ]
}
```

This enables:
- Automated checks that applications address statutory requirements
- Decision-support systems that flag when statutory duties not evidenced
- Training systems that explain what "special regard" means in practice
- Transparency about how law translates to operational process

### NPPF Policy Framework as Decision Trees

The schema encodes NPPF paragraph 214's substantial harm test as a computable decision framework:

```json
{
  "paragraph": "214",
  "decisionFramework": {
    "presumption": "Refuse consent",
    "exception1": "Substantial public benefits outweigh harm/loss",
    "exception2_allMustApply": [
      "Nature of asset prevents all reasonable uses of site",
      "No viable use of asset itself can be found in medium term through appropriate marketing",
      "Conservation by grant-funding or charitable/public ownership demonstrably not possible",
      "Harm/loss outweighed by benefit of bringing site back into use"
    ]
  }
}
```

This structure allows:
- Decision support systems to guide officers through complex policy tests
- Automated validation that decision notices address required policy tests
- Clear audit trail showing how policy applied
- Training tools demonstrating policy application

### Heritage Asset Type Taxonomy

The schema provides a complete taxonomy of designated and non-designated heritage assets with their protection mechanisms:

- **Listed Buildings** (Grade I, II*, II) - Listed Building Consent required
- **Conservation Areas** - Section 72 duty applies
- **Scheduled Monuments** - Separate consent regime (SMC)
- **Registered Parks & Gardens** - Material consideration
- **Registered Battlefields** - Highest significance designation
- **World Heritage Sites** - Outstanding Universal Value
- **Non-designated assets** - Balanced judgment (NPPF 216)

Each asset type includes:
- Designation authority
- Legislative basis
- Consent requirements
- Policy weight in decision-making
- Relationship to other designations

### Process Definitions as Service Blueprints

The `serviceProcesses` section defines complete process flows including:

#### Listed Building Consent Process
- Pre-application advice mechanisms
- Certificate of Lawfulness of Proposed Works (CLPW) alternative
- Statutory consultation requirements (Historic England, Amenity Societies)
- Determination tests (significance → impact → harm → balancing exercise)
- Conditions framework
- Appeals and enforcement

#### Conservation Area Controls
- Demolition consent requirements
- Tree notification requirements
- Permitted development restrictions
- Article 4 directions

#### Heritage at Risk Programme
- Monitoring requirements
- Enforcement powers (Repairs Notice, Urgent Works, Compulsory Purchase)
- Cost recovery mechanisms

### User Journey Mapping

The schema includes three complete user journeys:

1. **Owner of Listed Building** - From identifying need to obtaining consent
2. **Developer Affecting Setting** - Impact assessment and mitigation process
3. **LPA Officer Determination** - Decision-making framework and statutory duty discharge

Each journey provides:
- Sequential step-by-step process
- Decision points and alternatives
- Required documentation
- Success criteria
- Integration with wider planning system

### Key Definitions with Legal Precision

Critical heritage terms defined with their legal and policy sources:

- **Significance** - NPPF Glossary definition + assessment methodology
- **Setting** - Spatial concept + contribution assessment
- **Substantial harm** - Case law interpretation (high bar, Bedford case)
- **Public benefits** - PPG definition + inclusion/exclusion criteria
- **Curtilage** - Legal tests + HEAN 10 reference

### Provenance and Auditability

Every element traces to authoritative source:

```json
{
  "paragraph": "212",
  "policyText": "[exact NPPF text]",
  "source": "NPPF para 212",
  "caselaw": "Barnwell Manor principle",
  "sourceUrl": "https://www.gov.uk/guidance/national-planning-policy-framework/..."
}
```

This enables:
- Verification that schema accurately represents law/policy
- Updates when legislation/policy changes
- Clear attribution for AI-generated content
- Legal review of automated decision support

### Use Cases

#### 1. AI-Powered Pre-Application Advice

System uses schema to:
- Identify if works likely require LBC (affects character test)
- Assess level of heritage statement required (proportionate to significance)
- Flag potential issues (impact on special interest, setting considerations)
- Suggest mitigation approaches from precedent

#### 2. Automated Application Validation

Schema enables validation that application includes:
- Statement of significance (NPPF 207 requirement)
- HER consultation (minimum requirement)
- Appropriate expertise (where necessary)
- Assessment of impact on character/setting
- Public benefits if harm identified

#### 3. Decision Support for Officers

System guides officer through:
- Statutory duties (Sections 16/66/72)
- Significance assessment methodology
- Harm categorization (no/less than substantial/substantial)
- Appropriate policy test (NPPF 214/215)
- Balancing exercise framework
- Condition/refusal reasoning

#### 4. Public Information and Transparency

Schema powers public-facing tools:
- "Do I need consent?" decision tree
- Heritage asset information (grades, protections)
- Clear explanation of decision process
- Access to authoritative guidance
- Contact information for advice

#### 5. Training and Knowledge Management

Schema provides:
- Structured learning paths (legislation → policy → process)
- Worked examples linked to policy tests
- Common scenarios with guidance
- Update notifications when law/policy changes

### Technical Integration Points

Schema designed to integrate with:

- **Historic Environment Record** - Gloucestershire HER lookup
- **National Heritage List** - Historic England API for list descriptions
- **Planning Application Systems** - Validation and workflow
- **GIS Systems** - Heritage asset layers, setting visualization
- **Document Management** - Heritage statement templates

### Comparison to Traditional Service Documentation

| Traditional Approach | Policy-as-Code Schema |
|---------------------|----------------------|
| Static PDF documents | Machine-readable JSON |
| Separate legislation/policy/guidance | Unified authoritative source |
| Manual process interpretation | Computable decision logic |
| Version control via "Issue X" | Semantic versioning + Git |
| Expert knowledge in heads | Codified institutional knowledge |
| Periodic review (maybe) | Continuous validation against sources |

### Governance and Maintenance

```json
{
  "contentGovernance": {
    "owner": "Head of Planning and Development Control",
    "technicalLead": "Principal Conservation Officer",
    "reviewCycle": "Annual or upon legislative/policy change",
    "approvalRequired": ["Service Director", "Legal review for statutory interpretation"]
  }
}
```

Schema updates triggered by:
- Amendments to Planning (Listed Buildings and Conservation Areas) Act 1990
- NPPF revisions (especially Chapter 16)
- New/revised Historic England Advice Notes
- Significant case law affecting heritage decision-making
- Local Plan adoption/review

### Implementation Strategy

#### Phase 1: Foundation
1. Validate schema with conservation officers
2. Legal review of statutory interpretation
3. Populate Gloucester-specific contact details
4. Create mapping to existing case management system

#### Phase 2: Service Integration
1. Integrate HER lookup functionality
2. Implement pre-application decision tree
3. Create heritage statement template generator
4. Build validation checks for applications

#### Phase 3: Advanced Features
1. AI-powered significance assessment guidance
2. Automated impact categorization support
3. Decision notice template generation
4. Performance monitoring and reporting

#### Phase 4: Public-Facing Tools
1. "Do I need consent?" public tool
2. Interactive heritage asset map
3. Listed building owner guidance
4. Heritage at risk register

### Cost-Benefit Analysis

**Traditional Approach Costs:**
- Officer time interpreting legislation/policy for each case
- Inconsistent application of policy tests
- Training new officers requires shadowing/mentoring
- Public confusion about requirements → wasted applications
- Legal challenges from inadequate decision notices

**Schema Approach Benefits:**
- Consistent application of statutory duties and policy
- Faster officer training (codified knowledge)
- Better pre-application advice (decision tree logic)
- Higher quality applications (validation checks)
- More robust decision notices (policy test framework)
- Reduced appeals (clear reasoning, evidence of duty discharge)

### Example: Substantial Harm Test in Practice

Traditional officer thought process (often implicit):
1. Is this substantial harm? (judgment call, inconsistent)
2. If yes, what does NPPF 214 say? (look it up)
3. Have all four tests been met? (easy to miss one)
4. Did I explain this in decision notice? (often inadequate)

Schema-enabled process:
1. System prompts: "Categorize level of harm" [no/LTSH/substantial/total]
2. If substantial selected: System displays NPPF 214 framework
3. System requires evidence for each of four tests OR public benefits justification
4. System generates decision notice text demonstrating test applied
5. Audit trail shows exactly how policy followed

### Relationship to LGR and Digital Transformation

This schema supports Local Government Reorganisation by:

1. **Standardization** - Single authoritative definition of heritage processes across Gloucestershire
2. **Knowledge Transfer** - Codified expertise transferable to new unitary authority
3. **Efficiency** - Automated validation and decision support reduces officer time
4. **Transparency** - Clear provenance and decision logic for public accountability
5. **Scalability** - Same schema serves multiple authorities with local configuration

The schema demonstrates the "Information Infrastructure as Platform" approach:
- **Schema as Source of Truth** - Not documentation of process, but executable definition
- **AI as Service Layer** - Schema enables AI to provide consistent, accurate guidance
- **Humans in Loop** - Professional judgment on complex cases, not routine interpretation
- **Continuous Improvement** - Schema updated based on case outcomes and user feedback

### Next Steps: MCP Server Development

This schema provides foundation for MCP (Model Context Protocol) server enabling:

```javascript
// Example MCP server capability
mcp.tools.heritage.assess_lbc_requirement({
  building_id: "Gloucester-LB-12345",
  proposed_works: "Replace six windows on south elevation",
  materials: "Like-for-like timber, traditional glazing"
})
// Returns: { requires_lbc: true, reasoning: "...", guidance: "...", relevant_policy: [...] }
```

MCP server would provide:
- Asset lookup (National Heritage List integration)
- Significance assessment guidance
- Impact evaluation framework
- Consent requirement determination
- Application validation
- Decision support

This enables AI assistants to provide accurate, source-backed heritage advice across government and to the public.

### Conclusion

This heritage assets schema demonstrates how legislative frameworks, national policy, and technical guidance can be transformed from static documents into computable service logic. The result is:

- **More Consistent** - Statutory duties and policy tests applied uniformly
- **More Transparent** - Clear provenance and reasoning for every element
- **More Efficient** - Automation of routine interpretation and validation
- **More Accessible** - Public can understand and navigate complex requirements
- **More Maintainable** - Updates reflect directly from authoritative sources

Most importantly, it proves that complex statutory regimes can be expressed as policy-as-code without loss of nuance, legal precision, or professional judgment. The schema supports human decision-makers rather than replacing them, codifying best practice while preserving space for expertise on complex cases.

This is the foundation for genuinely intelligent digital government services.

---

**Document Metadata:**
- Version: 1.0.0
- Date: 2026-01-29
- Author: Iain Hamilton (Head of Transformation and Commissioning, Gloucester City Council)
- Schema Location: heritage-assets-schema-v1.json
- License: Open Government Licence v3.0
