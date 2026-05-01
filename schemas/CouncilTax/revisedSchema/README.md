# Gloucester Council Tax — Clean Schema Architecture

## The problem with the v2.5.7 schema

The four `_rebuilt` files had three things tangled together inside the same records:

1. **Policy facts** — the actual legal and financial content (rates, eligibility criteria, legislation)
2. **Channel / process information** — how to apply, URLs, email addresses, application steps
3. **Tooling / pipeline concerns** — publication status, profiles, runtime contracts, authoring governance, refactor audit logs

This meant no file was clean enough to be the authoritative source for any one purpose. A chatbot interpreter couldn't read the facts file without encountering runtime resolver contracts. The rules file contained presentation framing. The results file was a refactor audit log stored as if it were domain data.

---

## The new architecture: 3 core files + 2 overlay files

```
ct_vocabulary.json          Pure controlled vocabulary
ct_facts.json               Pure policy facts
ct_rules.json               Pure decision logic
    │
    ├── ct_channel_overlay.json      Presentation layer (URLs, apply steps, evidence)
    └── ct_chatbot_overlay.json      Interpreter layer (intake trees, framing, follow-ups)
```

---

## File descriptions

### `ct_vocabulary.json`
The controlled vocabulary that the other files reference. Mechanisms, legal basis types, discount categories, exemption classes, occupancy statuses, person roles, evidence types, decision outcomes, themes.

**What was removed:** `design_principles` (authoring governance), `mappings` (migration tracking), `payment_method_types` and `channel_types` (channel concerns).

---

### `ct_facts.json`
The authoritative policy facts. Every fact record contains only what is true about the policy itself.

**What was removed from each fact record:**
- `url` → moved to `ct_channel_overlay.json`
- `how_to_apply` / `application_process` → moved to `ct_channel_overlay.json`
- `change_in_circumstances.examples` and `consequence_of_not_telling` → moved to `ct_channel_overlay.json`
- `_source`, `_publish_status` → removed (pipeline concerns)

**What was removed from the top level:**
- `publication_control` → removed (authoring governance)
- `profiles` → removed (tooling concern)
- `runtime_case_model` → removed (interpreter concern — belongs in chatbot overlay)
- `cross_document_index` → removed (pipeline concern)
- `open_issues` → removed (authoring concern)
- `sources` → removed (pipeline provenance, not policy fact)

Rates are stored as **numeric values** (`244.13`) not formatted strings (`"£244.13"`). Formatting is a presentation decision.

---

### `ct_rules.json`
The decision logic. Two layers:

- `calculation_sequence` — ordered stages (liability → valuation reduction → disregards → exemptions → discounts → premiums → CTS)
- `executable_rules` — typed, machine-readable rule conditions and effects (34 rules)
- `narrative_rules` — prose policy rules where formalisation is not yet safe

**What was removed:**
- `profiles` → removed
- `runtime_resolver_contract` → moved to `ct_chatbot_overlay.json` (framing/resolution_principles)
- `_source`, `_publish_status` from each rule → removed
- `executable_rule_slices` wrapper metadata (scope_note, execution_model) → removed; rules extracted directly

---

### `ct_channel_overlay.json`
Everything about **how a resident interacts with the council**. Keyed by `fact_id` so it joins cleanly to `ct_facts.json` at render time.

Contains:
- `global_contact` — email, postal address, online account URL
- `payment` — instalment schedule, payment methods, difficulty options
- `by_fact_id` — per-discount/exemption: URL, how_to_apply steps, processing notes, change_in_circumstances obligations

**Never read this for policy truth. Always join it to ct_facts.**

---

### `ct_chatbot_overlay.json`
Everything an AI interpreter needs that is not core policy:

- `framing` — scope declaration, tone principles, out-of-scope list
- `resolution_principles` — how to reason through the calculation sequence
- `intake_trees` — question trees to diagnose which rules apply (initial triage, disregards, property adjustments)
- `discount_topics` — plain-English summaries and resident-facing question text
- `suggested_followups_by_topic` — follow-up questions once a topic is identified

**This overlay does not contain policy facts. It references them by id. Always verify against ct_facts + ct_rules.**

---

## How to use the files together

| Purpose | Files needed |
|---|---|
| Display rates table | `ct_facts.json` → `valuation.rates` |
| Check discount eligibility | `ct_facts.json` → `discounts` + `ct_rules.json` → `executable_rules` |
| Render "how to apply" for a discount | `ct_channel_overlay.json` → `by_fact_id[discount_id]` |
| Run chatbot triage | `ct_chatbot_overlay.json` → `intake_trees` → resolve via `ct_facts` |
| Look up a term | `ct_vocabulary.json` |
| Audit calculation logic | `ct_rules.json` → `calculation_sequence` + `executable_rules` |

---

## What happened to the results file

`council_tax_results_v2_5_7_rebuilt.json` was a refactor audit log — it documented what had been migrated, what the coverage was, and what transformations had been applied during the schema rebuild. It was not a domain data file. Its useful content has been redistributed:

- `charge_outputs` (rates) → `ct_facts.json` → `valuation.rates`
- `execution_readiness` / `coverage_trace` → retained in your version control, not in the live schema
- `consumer_contract` / `best_practice` → `ct_chatbot_overlay.json` → `framing.resolution_principles`
- `evidence_requirements` → `ct_facts.json` within each discount record (`evidence_required`)
