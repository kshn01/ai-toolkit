#!/usr/bin/env node
import { cac } from 'cac';
import pc from 'picocolors';
import { initCmd } from './commands/init.js';
import { generateCmd } from './commands/generate.js';
import { addCmd } from './commands/add.js';
import { removeCmd } from './commands/remove.js';
import { listCmd } from './commands/list.js';
import { searchCmd } from './commands/search.js';

const cli = cac('ai-workspace');

cli
  .command('init', 'Create a canonical workspace (.ai/workspace.json)')
  .option('--cwd <dir>', 'workspace root')
  .option('--yes', 'skip prompts and use defaults')
  .action((opts) => initCmd(opts));

cli
  .command('generate', 'Project the canonical workspace into provider files')
  .option('--cwd <dir>', 'workspace root')
  .action((opts) => generateCmd(opts));

cli
  .command('diff', 'Show what generate would change, without writing')
  .option('--cwd <dir>', 'workspace root')
  .action((opts) => generateCmd({ ...opts, dryRun: true }));

cli
  .command('search [query]', 'Search the shared catalog for artifacts and packs')
  .option('--cwd <dir>', 'workspace root')
  .action((query, opts) => searchCmd(query, opts));

cli
  .command('add [...refs]', 'Add catalog refs (e.g. agent:x, pack:y) to this workspace')
  .option('--cwd <dir>', 'workspace root')
  .action((refs, opts) => addCmd(refs, opts));

cli
  .command('remove [...refs]', 'Remove catalog refs from this workspace')
  .option('--cwd <dir>', 'workspace root')
  .action((refs, opts) => removeCmd(refs, opts));

cli
  .command('list', 'List installed refs and what the catalog offers')
  .option('--cwd <dir>', 'workspace root')
  .action((opts) => listCmd(opts));

cli.help();
cli.version('0.0.0');

async function main() {
  try {
    cli.parse(process.argv, { run: false });
    await cli.runMatchedCommand();
  } catch (err) {
    // Typed domain errors get a clean message; everything else keeps its message too.
    console.error(pc.red(`✗ ${(err as Error).message}`));
    process.exitCode = 1;
  }
}

void main();
