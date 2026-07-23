/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Use Node environment — our contract tests don't need a browser DOM.
    // Compact circuit tests run in Node.js with the proof server Docker service.
    environment: 'node',

    // Test file locations — keep contract tests co-located with source
    include: [
      'contract/src/**/*.test.ts',
      'lib/**/*.test.ts',
      'tests/**/*.test.ts',
    ],

    // Give circuit tests extra time — ZK proof generation is CPU intensive
    testTimeout: 120000,  // 2 minutes per test
    hookTimeout: 60000,   // 1 minute for beforeAll/afterAll setup

    // Coverage report — used by GitHub Actions CI badge
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['contract/src/**', 'lib/**'],
      exclude: ['**/*.d.ts', '**/*.test.ts', '**/node_modules/**'],
    },

    // Reporter: verbose shows each test name (good for CI logs)
    reporter: 'verbose',
  },
});
