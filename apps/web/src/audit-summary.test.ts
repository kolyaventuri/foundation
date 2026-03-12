import {describe, expect, it} from 'vitest';
import type {ScanAuditSummary} from '@ha-repair/contracts';
import {
  buildAuditScoreCards,
  buildAuditSignalChips,
  buildConflictHotspotHighlights,
  buildIntentClusterHighlights,
  summarizeAuditObjectCounts,
} from './audit-summary';

const audit: ScanAuditSummary = {
  cleanupCandidateIds: [
    'unused_helper:input_boolean.night_toggle',
    'unused_script:script.legacy_shutdown',
  ],
  conflictCandidateIds: [
    'likely_conflicting_controls:automation.kitchen_override:automation.kitchen_presence',
  ],
  conflictHotspots: [
    {
      entityId: 'light.kitchen_main',
      entityLabel: 'Kitchen Main Light',
      findingIds: [
        'likely_conflicting_controls:automation.kitchen_override:automation.kitchen_presence',
      ],
      writerIds: ['automation.kitchen_override', 'automation.kitchen_presence'],
      writerKinds: ['automation'],
    },
  ],
  intentClusters: [
    {
      areaIds: ['area.kitchen'],
      averageSimilarity: 0.74,
      clusterId: 'intent_cluster:kitchen',
      conceptTerms: ['kitchen', 'presence', 'boost'],
      objectIds: [
        'automation.kitchen_presence',
        'automation.kitchen_override',
        'scene.kitchen_evening',
        'script.kitchen_boost',
      ],
      objectKinds: ['automation', 'automation', 'scene', 'script'],
      objectLabels: [
        'Kitchen Presence',
        'Kitchen Override',
        'Kitchen Evening',
        'Kitchen Boost',
      ],
      targetEntityIds: ['light.kitchen_main', 'switch.kitchen_fan'],
    },
  ],
  objectCounts: {
    areas: 1,
    automations: 2,
    configModules: 1,
    devices: 4,
    entities: 12,
    floors: 1,
    helpers: 3,
    labels: 2,
    scenes: 1,
    scripts: 2,
    templates: 2,
  },
  ownershipHotspotFindingIds: ['entity_ownership_hotspot:light.kitchen_main'],
  ownershipHotspots: [
    {
      areaIds: ['area.kitchen'],
      entityId: 'light.kitchen_main',
      entityLabel: 'Kitchen Main Light',
      writerIds: ['automation.kitchen_override', 'automation.kitchen_presence'],
      writerKinds: ['automation'],
    },
  ],
  scores: {
    clarity: 76,
    cleanupOpportunity: 68,
    correctness: 83,
    maintainability: 72,
    redundancy: 41,
  },
};

describe('audit summary helpers', () => {
  it('builds score cards in the intended operator order', () => {
    expect(buildAuditScoreCards(audit)).toEqual([
      {key: 'correctness', label: 'Correctness', value: 83},
      {key: 'maintainability', label: 'Maintainability', value: 72},
      {key: 'clarity', label: 'Clarity', value: 76},
      {key: 'redundancy', label: 'Redundancy', value: 41},
      {key: 'cleanupOpportunity', label: 'Cleanup', value: 68},
    ]);
  });

  it('summarizes core audit signals and inventory counts', () => {
    expect(buildAuditSignalChips(audit)).toEqual([
      {key: 'cleanup', label: 'Cleanup candidates', value: 2},
      {key: 'conflicts', label: 'Conflict candidates', value: 1},
      {key: 'ownership', label: 'Ownership hotspots', value: 1},
      {key: 'clusters', label: 'Intent clusters', value: 1},
    ]);

    expect(summarizeAuditObjectCounts(audit.objectCounts)).toBe(
      '12 entities, 2 automations, 3 helpers, 2 scripts, 1 scene, 2 templates',
    );
  });

  it('formats conflict and intent highlights for the workbench header', () => {
    expect(buildConflictHotspotHighlights(audit)).toEqual([
      {
        detail: '1 conflict candidate(s) across 2 writer(s)',
        id: 'light.kitchen_main',
        title: 'Kitchen Main Light',
      },
    ]);

    expect(buildIntentClusterHighlights(audit)).toEqual([
      {
        detail: '4 object(s) across 2 target(s) at 74% similarity',
        id: 'intent_cluster:kitchen',
        title: 'kitchen / presence / boost',
      },
    ]);
  });
});
