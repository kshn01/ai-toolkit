import { defineConfig } from 'tsup';

/**
 * Builds the CLI into ONE self-contained JavaScript file: `dist/index.js`.
 *
 * The "noExternal match-all" setting below bundles every dependency (cac, zod, clack,
 * yaml, and our own @ai-workspace/core) straight in. The result needs nothing but Node —
 * no `tsx`, no `node_modules` at runtime — which is exactly what makes it installable
 * as a plain command on a teammate's machine.
 *
 * The `#!/usr/bin/env node` shebang from src/index.ts is preserved and the file is
 * marked executable, so the shell can run it directly.
 */
export default defineConfig({
  entry: { index: 'packages/cli/src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  noExternal: [/.*/],
  clean: true,
  outDir: 'dist',
  minify: false,
  // Some bundled deps (e.g. `yaml`) are CommonJS and call require() internally. ESM
  // output has no require, so we recreate one from node:module. Without this the
  // binary throws "Dynamic require of ... is not supported" at startup.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
