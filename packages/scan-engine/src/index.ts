import type {FrameworkSummary} from '@ha-repair/contracts';

export function createFrameworkSummary(): FrameworkSummary {
  return {
    priorities: [
      'Replace the mock Home Assistant client with a real authenticated websocket + REST adapter.',
      'Persist connection profiles, scan runs, and findings in SQLite.',
      'Ship the first deterministic rule packs for naming, area coverage, and assistant exposure.',
    ],
    surfaces: [
      {
        id: 'api',
        name: 'API shell',
        state: 'ready',
        summary:
          'Fastify now exposes health, framework summary, and a stubbed connection-test endpoint.',
      },
      {
        id: 'web',
        name: 'Guided UI shell',
        state: 'ready',
        summary:
          'React + Vite render the shared framework model and are ready for live scan workflows.',
      },
      {
        id: 'cli',
        name: 'CLI path',
        state: 'ready',
        summary:
          'The CLI can already report framework status and exercise the shared Home Assistant client.',
      },
      {
        id: 'rules',
        name: 'Repair engine',
        state: 'planned',
        summary:
          'Rule packs, prioritization, and fix previews are the next vertical slice on top of this scaffold.',
      },
    ],
    tagline:
      'A local-first framework for deep Home Assistant inventory repair, cleanup, and guided improvement.',
    title: 'Home Assistant Repair Console',
  };
}
