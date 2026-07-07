import path from 'node:path';
import pc from 'picocolors';
import { readManifest, writeManifest } from '../infra/manifest.js';

/** `remove <ref...>` — drop catalog refs from `use`. Files are cleaned up on next generate. */
export async function removeCmd(refs: string[], opts: { cwd?: string } = {}): Promise<void> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  if (!refs?.length) throw new Error('nothing to remove — e.g. `ai-workspace remove pack:frontend-team`');

  const manifest = await readManifest(root);
  const use = new Set(manifest.use);
  const removed = refs.filter((r) => use.delete(r));
  manifest.use = [...use].sort();
  await writeManifest(root, manifest);

  if (removed.length) {
    console.log(pc.green(`✓ removed ${removed.length}:`));
    removed.forEach((r) => console.log(`  - ${r}`));
    console.log(pc.dim('\nrun `ai-workspace generate` to delete the files it created.'));
  } else {
    console.log(pc.dim('• none of those were installed — nothing to remove'));
  }
}
