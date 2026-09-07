import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^.*\.s?css$/, replacement: 'identity-obj-proxy' }],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    clearMocks: true,
    setupFiles: ['./tools/setup-tests.ts'],
    // .claude/worktrees holds agent worktrees, which are full copies of this repo — without
    // this the suite runs once per leftover worktree, and a stale one runs stale tests as if
    // they were this branch's.
    exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**', '**/.claude/**'],
    server: {
      deps: {
        inline: [/@openmrs/],
      },
    },
    fakeTimers: {
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'Date',
      ],
    },
    alias: {
      '@openmrs/esm-framework/src/internal': '@openmrs/esm-framework/mock',
      '@openmrs/esm-framework': '@openmrs/esm-framework/mock',
      'react-i18next': r('./__mocks__/react-i18next.js'),
    },
  },
});
