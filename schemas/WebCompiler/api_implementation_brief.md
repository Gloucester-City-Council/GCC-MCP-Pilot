# Tight implementation brief: schema-driven MCP site builder API

## Objective
Build a deterministic API that compiles typed site definitions into standard web output.
Do not use an LLM at render time.

## Product boundary
Input:
- site authoring payload or runtime site definition
- template registry
- component recipe registry
- theme pack
- condition registry
- transform registry
- normaliser contract
- integrity contract
- html sanitisation policy
- naming contract

Output:
- render plan
- HTML/CSS/JS bundle
- asset manifest
- validation report
- blocking and warning errors with stage codes

## Non-goals
- no runtime design inference
- no runtime content rewriting
- no arbitrary custom CSS execution
- no implicit template switching
- no hidden defaults outside contracts

## Required modules
1. schema loader
2. authoring validator
3. normaliser
4. runtime validator
5. integrity checker
6. token resolver
7. template resolver
8. component recipe resolver
9. transform executor
10. condition evaluator
11. html sanitiser
12. render plan compiler
13. HTML emitter
14. CSS emitter
15. JS behaviour manifest emitter
16. golden test runner

## Required execution order
1. validate authoring input
2. normalise to runtime site definition
3. validate runtime site definition
4. run integrity checks
5. resolve conditions and transforms
6. resolve template for each page
7. verify template.page_type matches page.page_type
8. resolve component recipes
9. resolve theme and polish profile
10. sanitise all html fields
11. resolve token paths in component style hooks
12. compile render plan
13. lint accessibility and guardrails
14. emit bundle

Do not skip steps. Blocking failures stop the pipeline.

## Blocking error codes
- unknown_page_type
- template_not_found
- template_page_type_mismatch
- component_recipe_missing
- theme_not_found
- polish_profile_not_supported
- integrity_check_failed
- token_resolution_failed
- html_sanitisation_failed
- guardrail_violation

## Integrity requirements
The checker must enforce:
- every render_condition_id in templates exists in condition registry
- every transform_id in content mappings exists in transform registry
- every theme_id in site definition exists in theme pack manifest
- every polish_profile_id is supported by the selected theme
- every template_id exists in template registry
- every page.template_id resolves to template.page_type matching page.page_type
- every target_component in mappings exists in component recipes
- every component default_variant exists in component variants
- every token path in style hooks resolves in the chosen theme pack
- page ids are unique
- page slugs are unique
- region order values are unique inside each template

## HTML sanitisation requirements
Sanitise before render plan compilation.
Reject:
- script
- style
- iframe
- embed
- event handler attributes
- inline style attributes
Allow only tags and attributes declared in html-policy.
Return exact failing path for rejected content.

## Render plan requirements
Do not emit HTML directly from raw site definition.
Compile a typed intermediate render plan first.
The render plan must contain:
- page nodes
- ordered regions
- component instances
- resolved slot values
- resolved token values
- behaviour manifest entries
- source bindings

## Output rules
HTML:
- semantic elements only
- include data-component, data-variant, data-region

CSS:
- CSS variables with --sb- prefix
- component class naming per naming contract
- no inline styles from content payload

JS:
- behaviour hooks only
- no layout logic in JS
- hook names use js: prefix in manifest

## Suggested implementation shape
Language: TypeScript
Runtime: Node 20+
Validation: AJV

Project structure:
- /schemas
- /src/contracts
- /src/normaliser
- /src/integrity
- /src/resolver
- /src/compiler
- /src/emitter
- /src/testing

## Acceptance criteria
- all golden tests pass
- same input yields byte-stable render plan
- template mismatch is caught before compile
- unresolved token path is blocking
- invalid HTML fragment is blocking
- optional components omit cleanly without crashing
- output bundle is produced without manual patching

## First milestone
Build these first:
1. integrity checker
2. token resolver
3. render plan compiler
4. HTML/CSS emitter
5. golden test runner

Start with the deterministic core, not broad feature work.
