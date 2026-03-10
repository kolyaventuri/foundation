import type {UserConfig} from 'vitest/config';

const config: UserConfig = {
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
};

export default config;
