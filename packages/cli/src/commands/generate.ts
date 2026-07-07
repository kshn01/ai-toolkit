import path from 'node:path';
import pc from 'picocolors';
import type { MergeAction } from '@ai-workspace/core';
import { runGenerate } from '../pipeline.js';

const COLOR: Record<MergeAction, (s: string) => string> = {
  create: pc.green,
  update: pc.cyan,
  restore: pc.cyan,
  merge: pc.cyan,
  noop: pc.dim,
  keep: pc.yellow,
  conflict: pc.red,
  'orphan-remove': pc.magenta,
  'orphan-keep': pc.yellow,
};

export async function generateCmd(opts: { cwd?: string; dryRun?: boolean } = {}): Promise<void> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  const { outcomes, diagnostics, conflicts } = await runGenerate(root, { dryRun: opts.dryRun });

  const label = opts.dryRun ? pc.bold('diff (dry run)') : pc.bold('generate');
  console.log(`${label} — ${outcomes.length} file(s)\n`);
  for (const o of outcomes) {
    console.log(`  ${COLOR[o.action](o.action.padEnd(14))} ${o.path}`);
  }

  const changed = outcomes.filter((o) => o.action !== 'noop').length;
  console.log(`\n${pc.dim(`${changed} changed, ${outcomes.length - changed} unchanged`)}`);

  if (diagnostics.length) {
    console.log(pc.bold('\nnotices'));
    for (const d of diagnostics) {
      console.log(`  ${pc.yellow('!')} ${pc.dim(`[${d.provider}]`)} ${d.message}`);
    }
  }

  if (conflicts > 0) {
    console.log(pc.red(`\n✗ ${conflicts} conflict(s) — resolve manually (auto-merge lands next increment)`));
    process.exitCode = 1;
  }
}
