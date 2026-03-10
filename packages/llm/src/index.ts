import type {ProviderDescriptor} from '@ha-repair/contracts';

const providers: ProviderDescriptor[] = [
  {
    description:
      'Deterministic-only mode for offline usage, testing, and rule-engine baselines.',
    id: 'none',
    label: 'No provider',
  },
  {
    description:
      'Local-first inference through Ollama for private categorization and naming help.',
    id: 'ollama',
    label: 'Ollama',
  },
  {
    description:
      'Hosted enrichment for higher-quality classification and repair summaries when enabled.',
    id: 'openai',
    label: 'OpenAI',
  },
];

export function listProviderDescriptors() {
  return providers;
}
