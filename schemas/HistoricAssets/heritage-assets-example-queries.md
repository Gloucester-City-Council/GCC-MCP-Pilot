# Heritage Assets Schema: Example Queries and Use Cases

## Query Examples Demonstrating Schema Capabilities

### Example 1: Do I Need Listed Building Consent?

**User Query:** "I want to replace the windows in my Grade II listed house with double glazing. Do I need consent?"

**Schema-Enabled Response Logic:**
```json
{
  "asset_type": "Listed Building",
  "grade": "Grade II",
  "proposed_works": "Window replacement",
  "trigger_test": {
    "question": "Would works affect character as building of special architectural/historic interest?",
    "factors": [
      "Windows likely contribute to special interest (historic fabric)",
      "Double glazing changes appearance and materials",
      "Section 7 trigger: alteration affecting character"
    ],
    "conclusion": "Listed Building Consent required"
  },
  "statutory_basis": "Section 7, Planning (Listed Buildings and Conservation Areas) Act 1990",
  "guidance": "Historic England Advice Note 16, paragraphs addressing windows",
  "pre_application_advice": "Strongly recommended - Conservation Officer can advise on acceptable approaches",
  "alternatives": [
    "Secondary glazing (may be acceptable, less harmful)",
    "Slim-profile double glazing in timber frames (may preserve character)",
    "Like-for-like timber windows with traditional glazing (likely acceptable)"
  ],
  "criminal_offence_warning": "Carrying out works without consent is criminal offence with unlimited fine",
  "next_steps": [
    "Contact Conservation Officer for pre-application advice",
    "Discuss acceptable glazing options",
    "Prepare heritage statement for application",
    "Submit Listed Building Consent application"
  ]
}
```

### Example 2: Assessing Impact of Development on Setting

**User Query:** "We're proposing a three-storey apartment block 50m from a Grade I listed church. What do we need to address?"

**Schema-Enabled Assessment Framework:**
```json
{
  "heritage_asset": {
    "type": "Listed Building",
    "grade": "Grade I",
    "special_interest": "Architectural (Gothic Revival), Historic (medieval origins)",
    "significance": "Highest - substantial harm should be wholly exceptional (NPPF 213)"
  },
  "proposal": {
    "development": "Three-storey apartment block",
    "distance": "50m from listed building",
    "relationship": "Development within setting of heritage asset"
  },
  "statutory_duties": [
    {
      "duty": "Section 66(1) - Special regard to desirability of preserving building or setting",
      "application": "Applies to planning permission decision",
      "weight": "Considerable importance and weight (Barnwell Manor case law)"
    }
  ],
  "required_assessments": [
    {
      "assessment": "Statement of Heritage Significance",
      "source": "NPPF para 207",
      "content_required": [
        "Identify significance of listed church",
        "Assess contribution of setting to significance",
        "Describe proposal and how it responds to significance",
        "Evaluate impact on setting",
        "Categorize harm (no harm / less than substantial / substantial)",
        "Justify any harm with clear and convincing justification",
        "Demonstrate how harm avoided/minimized",
        "Identify public benefits if harm present"
      ]
    },
    {
      "assessment": "Visualizations",
      "purpose": "Show proposal in context of heritage asset",
      "types": ["Site photographs", "Photomontages", "3D visualizations"]
    }
  ],
  "decision_framework": {
    "step_1": "Identify significance (architectural, historic interest of church)",
    "step_2": "Assess current setting (contribution of open space, views, relationship to surroundings)",
    "step_3": "Evaluate impact (would development harm significance? scale, massing, materials, prominence)",
    "step_4": "Categorize harm level",
    "step_5": {
      "if_no_harm": "Approve subject to other considerations",
      "if_less_than_substantial_harm": "Weigh harm against public benefits (NPPF 215)",
      "if_substantial_harm": "Refuse unless substantial public benefits outweigh harm (NPPF 214) - very high bar for Grade I"
    }
  },
  "mitigation_considerations": [
    "Reduce height/scale",
    "Adjust siting (further from church)",
    "Modify design (traditional materials, sympathetic form)",
    "Landscaping/screening",
    "Enhanced public realm around church"
  ],
  "consultation_requirements": {
    "historic_england": "Mandatory - Grade I listed building",
    "amenity_societies": "Likely - check if works to listed building involved",
    "conservation_officer": "Essential - specialist heritage advice"
  }
}
```

### Example 3: Officer Determining Listed Building Consent Application

**Scenario:** Application to convert Grade II* listed barn to residential use

**Schema-Guided Decision Process:**
```json
{
  "application_type": "Listed Building Consent - Change of use with alterations",
  "heritage_asset": {
    "type": "Listed Building",
    "grade": "Grade II*",
    "building_type": "Agricultural barn (18th century)",
    "special_interest": {
      "architectural": "Timber frame construction, vernacular design",
      "historic": "Evidence of agricultural economy, rural settlement pattern"
    }
  },
  "validation_checks": {
    "heritage_statement_provided": "Yes - assess adequacy",
    "significance_identified": "Check statement addresses architectural and historic interest",
    "HER_consulted": "Verify consultation undertaken",
    "appropriate_expertise": "Check heritage consultant credentials",
    "drawings_adequate": "Existing and proposed elevations, floor plans, construction details"
  },
  "significance_assessment": {
    "special_interest_elements": [
      "Timber frame structure and construction techniques",
      "Open interior space and volume",
      "Evidence of original agricultural use (threshing floor, hay loft)",
      "Relationship to farmstead and landscape setting",
      "Traditional materials (timber, brick plinth, clay tiles)"
    ],
    "contribution_to_significance": "High - structure and interior arrangement tell story of agricultural heritage"
  },
  "impact_assessment": {
    "proposed_works": [
      "Insert floors to create two-storey accommodation",
      "Install windows in gable ends",
      "Insert insulation and services",
      "Create openings for doors and stairs"
    ],
    "impact_on_significance": {
      "positive": "Secures viable use, prevents deterioration, retains building in landscape",
      "negative": [
        "Loss of open interior volume (SUBSTANTIAL IMPACT)",
        "Loss of legibility of agricultural function",
        "Harm to historic fabric from interventions",
        "Change to character of building"
      ]
    },
    "harm_categorization": "LESS THAN SUBSTANTIAL HARM",
    "justification": "Interior volume lost but structure retained; some special interest preserved; building secured in landscape"
  },
  "statutory_duty_application": {
    "section_16": "Special regard to desirability of preserving building or features of special interest",
    "assessment": "Considerable importance and weight given to preservation",
    "finding": "Proposal results in harm to special interest but does not result in total loss"
  },
  "policy_application": {
    "NPPF_212": "Great weight given to conservation (Grade II* = high weight)",
    "NPPF_213": "Harm requires clear and convincing justification",
    "NPPF_215": "Less than substantial harm weighed against public benefits"
  },
  "balancing_exercise": {
    "harm": {
      "scale": "Less than substantial",
      "detail": "Loss of interior volume and legibility of agricultural use",
      "weight": "Significant (Grade II* = high importance)"
    },
    "public_benefits": {
      "heritage_benefits": [
        "Secures optimum viable use",
        "Prevents deterioration and loss",
        "Retains building in landscape setting",
        "Opportunity for enhanced understanding through Heritage Statement"
      ],
      "economic_benefits": [
        "Reuse of heritage asset supports rural economy",
        "Construction jobs",
        "Occupied building contributes to settlement vitality"
      ],
      "environmental_benefits": [
        "Reuse of existing building (embodied carbon retained)",
        "Sustainable location (if appropriate)"
      ]
    },
    "balancing_conclusion": "Public benefits, particularly heritage benefit of securing viable use, outweigh less than substantial harm"
  },
  "conditions": [
    {
      "condition": "Detailed drawings of all interventions",
      "purpose": "Ensure proper execution protecting special interest"
    },
    {
      "condition": "Schedule and samples of materials",
      "purpose": "Ensure traditional materials used appropriately"
    },
    {
      "condition": "Method statements for structural interventions",
      "purpose": "Protect historic timber frame"
    },
    {
      "condition": "Recording of building prior to works",
      "purpose": "Advance understanding of heritage significance (NPPF 218)"
    }
  ],
  "decision": "GRANT LISTED BUILDING CONSENT subject to conditions",
  "decision_notice_reasoning": [
    "Statutory duty under Section 16 discharged by giving considerable importance to preserving building",
    "Great weight given to conservation per NPPF 212",
    "Harm identified as less than substantial",
    "Clear and convincing justification provided (securing viable use)",
    "Public benefits (heritage, economic, environmental) outweigh harm per NPPF 215",
    "Conditions imposed to protect remaining special interest and secure proper execution"
  ]
}
```

### Example 4: Heritage at Risk - Enforcement Action

**Scenario:** Empty Grade II listed building deteriorating, owner not responding

**Schema-Guided Enforcement Process:**
```json
{
  "heritage_asset": {
    "type": "Listed Building",
    "grade": "Grade II",
    "condition": "Deteriorating",
    "occupancy": "Vacant",
    "at_risk": true
  },
  "local_authority_duties": {
    "monitoring": "Regular inspection of heritage assets at risk",
    "intervention": "Powers to secure preservation where owner failing in duty"
  },
  "enforcement_powers": [
    {
      "power": "Section 54 Urgent Works Notice",
      "trigger": "Unoccupied building; works urgently necessary for preservation",
      "procedure": [
        "LPA may execute works to preserve building",
        "Must give owner 7 days notice (or shorter if urgent)",
        "Works limited to preservation (weatherproofing, securing, temporary support)",
        "Cost recovered from owner as civil debt"
      ],
      "when_to_use": "Immediate risk of further deterioration; owner unresponsive"
    },
    {
      "power": "Section 48 Repairs Notice",
      "trigger": "Building not being properly preserved",
      "procedure": [
        "LPA serves notice specifying works reasonably necessary for proper preservation",
        "Owner given time to execute works (minimum 2 months)",
        "If not complied with, may lead to compulsory purchase",
        "Must demonstrate proper preservation not being secured"
      ],
      "when_to_use": "Serious disrepair; owner capable but unwilling to act"
    },
    {
      "power": "Section 47 Compulsory Purchase",
      "trigger": "Repairs notice not complied with; building deteriorating",
      "procedure": [
        "LPA may acquire building compulsorily",
        "Must demonstrate reasonable steps taken to secure preservation",
        "Compensation based on condition",
        "LPA must then secure repair and viable use"
      ],
      "when_to_use": "Last resort; owner unwilling/unable; building at serious risk"
    }
  ],
  "recommended_action_sequence": {
    "step_1": {
      "action": "Informal contact with owner",
      "purpose": "Encourage voluntary action; offer advice and grant information"
    },
    "step_2": {
      "action": "Assess urgency of works required",
      "factors": ["Structural stability", "Weather protection", "Security", "Rate of deterioration"]
    },
    "step_3": {
      "action": "Section 54 Urgent Works if necessary",
      "justification": "Prevent immediate harm; secure building",
      "cost_recovery": "Pursue owner for reasonable costs"
    },
    "step_4": {
      "action": "Section 48 Repairs Notice if owner unresponsive",
      "justification": "Formal requirement for comprehensive repairs",
      "timescale": "Reasonable period for works (e.g., 3-6 months depending on scope)"
    },
    "step_5": {
      "action": "Monitor compliance with Repairs Notice",
      "inspection": "Regular site visits to check progress"
    },
    "step_6": {
      "action": "Section 47 Compulsory Purchase if no compliance",
      "justification": "Building still at risk; owner demonstrated unwillingness/inability",
      "process": "Secretary of State confirmation required; compensation determined"
    },
    "step_7": {
      "action": "LPA secures repair and viable use",
      "approach": "Direct repair and sale/lease; or partnership with building preservation trust"
    }
  },
  "considerations": {
    "proportionality": "Enforcement action proportionate to risk and owner's response",
    "resources": "LPA must be prepared to fund urgent works and potentially CPO process",
    "expertise": "Conservation officer and legal advice essential",
    "publicity": "Heritage at risk cases attract attention; clear communication strategy needed"
  }
}
```

### Example 5: Conservation Area - New Development

**Scenario:** Proposal for new houses within conservation area

**Schema-Guided Assessment:**
```json
{
  "heritage_asset": {
    "type": "Conservation Area",
    "name": "[Conservation Area Name]",
    "character": "Victorian suburb with tree-lined streets, consistent building line, traditional materials"
  },
  "statutory_duty": {
    "section_72": "Special attention to desirability of preserving or enhancing character or appearance",
    "application": "Applies to planning permission decision for development in conservation area"
  },
  "proposal": {
    "development": "Five new dwellings",
    "site": "Vacant plot within conservation area",
    "design": "Contemporary interpretation"
  },
  "required_assessments": [
    {
      "assessment": "Conservation Area Character Appraisal",
      "purpose": "Understand special interest that justifies designation",
      "key_characteristics": [
        "Victorian/Edwardian architecture",
        "Consistent building heights and form",
        "Traditional materials (brick, slate)",
        "Established tree cover and green spaces",
        "Regular plot widths and building line"
      ]
    },
    {
      "assessment": "Heritage Statement",
      "content": [
        "Describe character of conservation area",
        "Assess contribution of site to character",
        "Explain design approach and how responds to character",
        "Evaluate impact on character or appearance"
      ]
    }
  ],
  "policy_framework": {
    "NPPF_203": "Plans should promote conservation and enhancement",
    "NPPF_204": "Ensure conservation area justifies status - special architectural or historic interest",
    "NPPF_210": "Desirability of new development making positive contribution to local character",
    "NPPF_219": "Look for opportunities to enhance or better reveal significance"
  },
  "design_considerations": {
    "positive_contribution": [
      "Respect building line and plot widths",
      "Relate to prevailing heights and massing",
      "Use traditional materials or complementary palette",
      "Incorporate landscaping to maintain green character",
      "Respond to local rhythm and grain",
      "High quality design (NPPF Chapter 12)"
    ],
    "enhancement_opportunities": [
      "Improve boundary treatments",
      "Enhanced public realm",
      "Tree planting",
      "Repair/restore historic features if present"
    ]
  },
  "decision_framework": {
    "preserve_or_enhance_test": "Would development preserve or enhance character or appearance?",
    "outcomes": {
      "enhances": "Weight in favor of approval",
      "preserves": "Neutral; other planning considerations apply",
      "harms": "Weight against approval; must be justified by other benefits"
    }
  },
  "example_conditions": [
    "Materials: Facing bricks and roofing materials to be agreed",
    "Boundary treatments: Traditional walls/hedges rather than close-boarded fencing",
    "Landscaping: Retention of existing trees, new planting scheme",
    "Refuse/cycle storage: Integrated into design, not visually prominent",
    "Window details: Traditional proportions and reveals, no modern standardized units"
  ]
}
```

## Demonstrating Schema Value

These examples show how the schema enables:

1. **Consistent Interpretation** - Same legislative framework and policy tests applied to every case
2. **Transparent Reasoning** - Clear audit trail from statute → policy → assessment → decision
3. **Comprehensive Guidance** - All relevant considerations captured in structured format
4. **Decision Support** - Officers guided through complex multi-stage tests
5. **Public Accessibility** - Technical requirements explained in usable format
6. **Quality Assurance** - Validation that all required elements addressed
7. **Training Tool** - New officers learn consistent approach
8. **Automation Potential** - Routine validation and guidance can be automated

## Next: MCP Server Implementation

These query patterns form basis for MCP server tools:

- `assess_consent_requirement()` - Determine if LBC/CAC needed
- `evaluate_significance()` - Guide significance assessment
- `categorize_harm()` - Assist in harm level determination
- `apply_policy_test()` - Check correct policy test used
- `suggest_conditions()` - Recommend appropriate conditions
- `validate_application()` - Check completeness against requirements
- `generate_decision_notice()` - Draft reasoning for decision

All backed by authoritative schema ensuring accuracy and consistency.
