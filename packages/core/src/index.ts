/**
 * Public API of @ai-workspace/core.
 *
 * This barrel is the ONE door into the core package. Other packages import from
 * '@ai-workspace/core' — never from deep paths like '.../core/src/merge.js'. That
 * keeps the package's internals free to move without breaking callers.
 */

// data shapes (schemas + inferred types)
export * from './domain/schema/workspace.js';
export * from './domain/schema/lockfile.js';
export * from './domain/schema/catalog.js';

// pure logic
export * from './errors.js';
export * from './catalog.js';
export * from './merge.js';
export * from './regions.js';
export * from './structured.js';
export * from './resolve.js';

// provider port + adapters
export * from './providers/adapter.js';
export { claudeAdapter } from './providers/claude.js';
export { copilotAdapter } from './providers/copilot.js';
