import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const core = fileURLToPath(new URL('../../../.openmaic/worker-core/', import.meta.url));
export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: core },
      // Overlay modules import React. Resolve it from the prepared Core, the copy the classroom ships, so the contract
      // suite does not depend on a React install at the repository root (the CI build repo installs only vitest there).
      { find: /^(react|react-dom)(\/.*)?$/, replacement: `${core}node_modules/$1$2` },
    ],
  },
  test: { include: ['integrations/openmaic/cloudflare/test/*.test.{ts,tsx}'], testTimeout: 60_000, hookTimeout: 60_000, maxWorkers: 1 },
});
