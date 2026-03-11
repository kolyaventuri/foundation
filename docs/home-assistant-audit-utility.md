# Home Assistant Audit Utility Implementation Spec

## Current baseline vs target model
This repo already ships a working audit and repair foundation:

- live read-only scans over Home Assistant REST + WebSocket
- persisted `ScanRun` records with passes, notes, fingerprints, enrichment metadata, and optional backup checkpoints
- deterministic findings for naming collisions, stale entities, orphaned links, area/floor/label hygiene, invalid automation/scene targets, and assistant exposure bloat
- web and CLI workbench flows that review findings and support dry-run repair workflows

This document describes the next expansion of that foundation. It is a target-state audit spec, not a claim that every schema or check below is already implemented.

The audit layer should extend the current platform, not replace it:

- current CLI commands and API routes remain the stable operator surface
- richer scan content flows through the existing scan, history, export, and workbench lifecycle
- audit findings feed later repair and enhancement experiences rather than redefining the product as audit-only

## Purpose
Build an AI-assisted audit layer on top of the existing Home Assistant scanner that analyzes:

- entities
- automations
- scenes
- scripts
- helpers
- templates
- config structure

The system should prioritize actionable design and correctness issues, not only cleanup. It should identify brittle logic, duplicate intent, dead objects, semantic drift, and architectural smells.

### Primary goals
- Detect broken or risky automation and config patterns.
- Surface likely conflicts and duplicate logic.
- Identify unused, orphaned, or legacy objects.
- Rate install health by category.
- Generate findings that are understandable and fixable.
- Provide enough structure for deterministic checks now and AI summarization later.

### Non-goals for this phase
- runtime telemetry analysis
- disaster simulation
- backup verification
- network or device health
- recorder performance from live metrics
- restore workflows

## Supported inputs
Current shared contracts are intentionally lean. The audit engine should expand them into richer normalized scan inputs while preserving serializable outputs.

### Entities
Current baseline:

- `entityId`
- `displayName`
- `areaId`
- `deviceId`
- `disabledBy`
- `hiddenBy`
- `labelIds`
- `state`

Planned normalized fields:

- `entity_id`
- `domain`
- `friendly_name`
- `area_id`
- `device_id`
- `disabled`
- `hidden`
- `integration`
- `platform`
- `labels` or tags when available
- `source_file`
- `attributes` when available
- `state_class` and `device_class` when available

### Automations
Current baseline:

- `automationId`
- `name`
- `sourcePath`
- `targetEntityIds`

Planned normalized fields:

- `id`
- `alias`
- `description`
- `mode`
- `triggers`
- `conditions`
- `actions`
- `variables`
- `enabled`
- `source_file`
- `raw_yaml`
- extracted entity references
- extracted service references
- extracted templates
- extracted helpers, scripts, and scenes referenced

### Scenes
Current baseline:

- `sceneId`
- `name`
- `sourcePath`
- `targetEntityIds`

Planned normalized fields:

- `entity_id`
- `name`
- `source_file`
- controlled entities
- target states and attributes
- activation references from automations, scripts, and dashboards when detectable

### Scripts
Planned normalized fields:

- `entity_id`
- `alias`
- `sequence`
- `enabled`
- `source_file`
- entity, service, and template references

### Helpers
Planned helper coverage includes:

- `input_boolean`
- `input_select`
- `input_number`
- `input_datetime`
- `input_text`
- `timer`
- `counter`
- `group`

Planned normalized fields:

- `entity_id`
- `name`
- `type`
- `source_file`
- references from automations, scenes, scripts, and templates

### Templates
Planned template sources:

- template entities
- inline automation templates
- trigger templates
- template conditions
- scripts
- template sensors and binary sensors

Planned normalized fields:

- `template_id`
- `source_type`
- `source_object_id`
- `template_text`
- extracted entity references
- extracted functions, filters, and tests
- parse validity when available

### Config modules
Current baseline already includes `ConfigAnalysis` summaries and issues. Planned audit normalization expands that into:

- `file_path`
- `object_types_present`
- line counts
- include and package usage
- duplication fingerprints
- counts of automations, scenes, scripts, helpers, and templates per file

## Core concepts
- **Audit object**: any analyzable entity, automation, scene, script, helper, template, or config module.
- **Check**: a deterministic or AI-assisted rule that evaluates one or more audit objects and produces findings.
- **Finding**: a structured issue, warning, or recommendation produced by a check.
- **Intent cluster**: a group of automations, scenes, or scripts that appear to represent the same user goal.
- **Ownership hotspot**: an entity targeted by many automations, scenes, or scripts, especially in overlapping contexts.

## Normalized model and relationship graph
The current `InventoryGraph` should evolve into a graph-friendly normalized model used internally by the scan engine.

### Planned normalized object shape
```json
{
  "id": "automation.bedtime_lights",
  "kind": "automation",
  "name": "Bedtime Lights",
  "enabled": true,
  "source_file": "automations/bedroom.yaml",
  "references": {
    "entities_read": ["binary_sensor.bedroom_motion", "input_boolean.sleep_mode"],
    "entities_written": ["light.bedroom_lamps"],
    "scripts_called": ["script.goodnight_announce"],
    "scenes_activated": ["scene.bedroom_night"],
    "helpers_used": ["input_boolean.sleep_mode"],
    "services_used": ["light.turn_on", "script.turn_on"]
  },
  "metadata": {
    "mode": "single",
    "has_templates": false,
    "trigger_count": 2,
    "condition_count": 3,
    "action_count": 4
  },
  "raw": {}
}
```

### Planned graph edges
- `READS`
- `WRITES`
- `CALLS_SCRIPT`
- `ACTIVATES_SCENE`
- `USES_HELPER`
- `DEFINED_IN`
- `SIMILAR_TO`
- `CONFLICTS_WITH`
- `UNUSED`
- `ORPHANED`

This graph should support deterministic checks first. Embedding-based similarity can be layered in later without becoming a hard dependency.

## Public interface and contract notes
No command or endpoint rename is planned for this audit expansion.

### CLI surface remains stable
- `ha-repair connect test`
- `ha-repair scan [--profile] [--mode mock|live] [--deep] [--llm-provider]`
- `ha-repair checkpoint [scan-id] [--download]`
- `ha-repair findings [scan-id] [--format table|json|md]`
- `ha-repair apply [fix-id...] --dry-run`
- `ha-repair export [scan-id] [--format md|json]`

### API surface remains stable
- `POST /api/profiles/test`
- `POST /api/scans`
- `GET /api/scans/:id`
- `GET /api/scans/:id/findings`
- `GET /api/scans/:id/backup-checkpoint`
- `POST /api/scans/:id/backup-checkpoint`
- `POST /api/fixes/preview`
- `POST /api/fixes/apply`
- `GET /api/history`

### Planned contract evolution
- `InventoryGraph` expands beyond entities, automations, and scenes to also cover scripts, helpers, templates, config modules, and derived relationships.
- `Finding` expands from the current minimal record (`id`, `kind`, `severity`, `title`, `evidence`, `objectIds`) into a richer audit record.
- `ScanRun` output grows category scores, clusters, cleanup candidates, and refactor recommendations while still fitting the existing scan and workbench lifecycle.

## Finding schema and scoring
The current finding shape is intentionally small. The audit layer should evolve toward the following planned structure:

```json
{
  "id": "finding-uuid",
  "check_id": "AUTOMATION_MISSING_REFERENCE",
  "category": "broken_references",
  "severity": "high",
  "confidence": 0.98,
  "title": "Automation references missing entity",
  "summary": "Automation 'Bedtime Lights' references binary_sensor.bedroom_motion_old, which does not exist.",
  "why_it_matters": "The automation may fail or behave unpredictably after entity renames or migrations.",
  "affected_objects": [
    {"kind": "automation", "id": "automation.bedtime_lights"},
    {"kind": "entity", "id": "binary_sensor.bedroom_motion_old"}
  ],
  "evidence": {
    "source_file": "automations/bedroom.yaml",
    "reference_type": "condition",
    "field_path": "conditions[1].entity_id"
  },
  "recommendation": {
    "action": "Replace the missing entity reference or remove the stale condition.",
    "steps": [
      "Verify the intended replacement entity",
      "Update the reference in the automation",
      "Retest bedtime automation behavior"
    ]
  },
  "scores": {
    "fragility": 88,
    "clarity": 62,
    "coupling": 54
  },
  "tags": ["stale-reference", "migration-risk", "bedroom"],
  "related_findings": []
}
```

### Planned per-object subscores
- `fragility`
- `noise`
- `clarity`
- `coupling`
- `redundancy`

### Planned install-level scores
- `correctness`
- `maintainability`
- `clarity`
- `redundancy`
- `cleanup_opportunity`

### Severity guidance
- `critical`: likely broken core logic, invalid service-target combinations, or missing references in control paths
- `high`: likely automation conflict, missing dependency in an active automation, or highly brittle central logic
- `medium`: duplicate logic, naming ambiguity, missing hysteresis, or unused-but-risky legacy objects
- `low`: style inconsistency, refactor opportunities, monolithic files, or probable stale configs with limited impact

## Audit categories
The first full audit pass should group findings into these categories:

1. Broken References
2. Conflict and Overlap
3. Dead or Legacy Objects
4. Naming and Intent Drift
5. Fragile Automation Patterns
6. Configuration Smells

Configuration Smells can remain a stretch category if initial delivery pressure requires focusing on the first five.

## Check catalog
Checks should ship in waves, but the target catalog is:

### Broken References
- `AUTOMATION_MISSING_REFERENCE`
- `AUTOMATION_DISABLED_DEPENDENCY`
- `SCRIPT_MISSING_REFERENCE`
- `SCENE_TARGET_MISSING_ENTITY`
- `TEMPLATE_MISSING_REFERENCE`
- `INVALID_SERVICE_TARGET_COMBINATION`

### Conflict and Overlap
- `ENTITY_OWNERSHIP_HOTSPOT`
- `LIKELY_AUTOMATION_CONFLICT`
- `SCENE_OVERLAP_HIGH`
- `DUPLICATE_SERVICE_PATTERN`

### Dead or Legacy Objects
- `UNUSED_HELPER`
- `UNUSED_SCENE`
- `UNUSED_SCRIPT`
- `DISABLED_AND_UNREFERENCED_AUTOMATION`
- `LEGACY_REFERENCE_PATTERN`
- `ORPHAN_CONFIG_MODULE`

### Naming and Intent Drift
- `AMBIGUOUS_HELPER_NAME`
- `SEMANTIC_DUPLICATE_NAMING`
- `MISLEADING_ALIAS`
- `INCONSISTENT_NAMING_CONVENTION`

### Fragile Automation Patterns
- `BROAD_STATE_TRIGGER`
- `NOISY_ATTRIBUTE_TRIGGER`
- `THRESHOLD_NO_HYSTERESIS`
- `MOTION_NO_OFF_STRATEGY`
- `DEVICE_TRACKER_DIRECT_CONTROL`
- `TEMPLATE_NO_UNKNOWN_HANDLING`
- `HIGHLY_COUPLED_AUTOMATION`
- `MONOLITHIC_AUTOMATION`
- `MISSING_IDEMPOTENCY_GUARD`

### Configuration Smells
- `MONOLITHIC_CONFIG_FILE`
- `COPY_PASTE_CLUSTER`
- `FRAGMENTED_INTENT_MODELING`
- `MAGIC_VALUE_SPREAD`

### Recommended first delivery set
The strongest first expansion on top of the current repo baseline is:

- `AUTOMATION_MISSING_REFERENCE`
- `SCRIPT_MISSING_REFERENCE`
- `SCENE_TARGET_MISSING_ENTITY`
- `UNUSED_HELPER`
- `UNUSED_SCRIPT`
- `UNUSED_SCENE`
- `ENTITY_OWNERSHIP_HOTSPOT`
- `LIKELY_AUTOMATION_CONFLICT`
- `AMBIGUOUS_HELPER_NAME`
- `HIGHLY_COUPLED_AUTOMATION`

## Intent clustering
Intent clustering is central to duplicate and conflict detection.

### Inputs
For each automation, scene, and script derive:

- alias or name tokens
- referenced area names
- target entities
- service types
- helper names
- trigger keywords
- time keywords
- mode keywords

### Planned fingerprint shape
```json
{
  "object_id": "automation.bedtime_lights",
  "concept_terms": ["bedtime", "sleep", "night", "bedroom"],
  "target_terms": ["light", "lamp"],
  "behavior_terms": ["turn_on", "dim", "scene"],
  "gating_terms": ["motion", "sleep_mode", "after_sunset"]
}
```

### Similarity signals
- token similarity on alias and name
- overlap in target entities
- overlap in helpers
- overlap in service types
- overlap in area or room names
- optional embedding similarity later

### Initial deterministic thresholds
- `>= 0.75`: likely duplicate
- `0.55 - 0.74`: related cluster
- `< 0.55`: unrelated

## Conflict detection
A conflict candidate exists when:

1. Two objects write to the same entity or overlapping entity set.
2. Their behaviors differ materially, such as on vs off, different scenes, or temperature up vs down.
3. Their contexts are related or overlapping, such as similar time windows, same room, same intent cluster, or similar helper gates.

### Planned conflict score components
- target overlap
- action polarity difference
- trigger overlap
- concept overlap
- gate inconsistency

Example summary:

`automation.kitchen_motion_on` and `automation.night_shutdown` both control `light.kitchen_main` in overlapping evening contexts with opposing actions.

## Reachability and dead-object audit
An object is a cleanup candidate when it has no inbound references from detectable sources.

### Planned inbound sources
- automations
- scripts
- scenes
- templates
- dashboards when available later

### Initial reachability rules
- scene with no inbound references -> `UNUSED_SCENE`
- helper with no inbound references -> `UNUSED_HELPER`
- script with no inbound references -> `UNUSED_SCRIPT`

### Important caveat
These should be labeled as `safe_review_candidate`, not `definitely_unused`, because some objects may still be activated manually.

## Naming and template audit
### Naming audit
Start with a small ambiguity dictionary:

- `mode`
- `state`
- `status`
- `toggle`
- `switch`
- `active`
- `enable`
- `default`
- `normal`
- `scene1`
- `test`
- `temp`

Only flag names when context is too weak. `input_boolean.sleep_mode` is acceptable. `input_boolean.mode` is not.

Convention detection should infer the dominant local style, such as snake_case ids, title case aliases, room-first naming, or intent-first naming, then flag outliers rather than forcing a hardcoded global style.

### Template audit
Target checks include:

- missing references inside templates
- no handling for `unknown` or `unavailable`
- brittle direct string equality
- numeric logic without coercion or defaults
- repeated template snippets

Initial deterministic patterns to detect:

- `states('entity')` with a missing entity
- fragile `states.entity.state` access
- numeric comparisons without `| float(...)`, `| int(...)`, or `| default(...)`
- missing `is_state(...)` or fallback handling where appropriate

## Summary output contract
The final scan report should grow toward this top-level structure while remaining compatible with the current `ScanRun` lifecycle:

```json
{
  "metadata": {
    "scanned_at": "2026-03-11T12:00:00Z",
    "object_counts": {
      "entities": 812,
      "automations": 146,
      "scenes": 28,
      "scripts": 17,
      "helpers": 64,
      "templates": 39,
      "config_files": 24
    }
  },
  "scores": {
    "correctness": 74,
    "maintainability": 61,
    "clarity": 58,
    "redundancy": 49,
    "cleanup_opportunity": 82
  },
  "findings": [],
  "clusters": {
    "intent_clusters": [],
    "ownership_hotspots": [],
    "duplicate_groups": []
  },
  "recommendations": {
    "top_actions": [],
    "cleanup_candidates": [],
    "refactor_candidates": []
  }
}
```

### Recommendation rules
Recommendations should be:

- concrete
- bounded
- tied to evidence
- phrased as reviewable changes

Avoid vague advice and unsupported runtime assumptions. Prefer specific reviewable actions such as renaming an ambiguous helper, consolidating duplicate bedtime automations, or extracting repeated action blocks into scripts.

## Implementation order
These phases describe the audit-engine expansion only. They do not replace the repo-level platform status documented in [PLAN.md](../PLAN.md).

### Phase A - Audit foundation
- normalize the expanded object model
- build the reference graph
- build the target writer graph
- implement the richer finding schema
- add the scoring framework

### Phase B - Highest-value deterministic checks
- ship the recommended first delivery set
- keep checks evidence-backed and serializable
- expose the results through the existing scan, export, and workbench flow

### Phase C - Smarter reasoning
- add intent fingerprinting
- add duplicate service pattern detection
- add semantic duplicate naming
- add monolithic automation detection
- add fragmented intent modeling

### Phase D - Audit-driven repair and enhancement
- generate human-readable intent summaries per automation or scene
- explain duplicate and conflict clusters
- produce bounded refactor recommendations that later repair and enhancement flows can consume

## Validation and acceptance
- Add fixture-based unit tests for normalization, reference resolution, graph indexing, and score calculation.
- Add rule tests for missing references, unused helpers/scripts/scenes, ownership hotspots, ambiguous helper names, and highly coupled automations.
- Add regression coverage to ensure current CLI, API, storage, and workbench flows can read richer scan outputs without route or command changes.
- Keep every target-state schema or check in documentation clearly labeled as planned until the code ships.

## Useful internal helpers
Useful helper modules for the audit expansion include:

- `reference_resolver`
- `entity_writer_index`
- `name_normalizer`
- `intent_fingerprint_builder`
- `similarity_engine`
- `template_risk_analyzer`
- `config_duplication_detector`
- `finding_aggregator`
- `score_calculator`
