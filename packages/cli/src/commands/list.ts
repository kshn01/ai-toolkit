import path from 'node:path';
import pc from 'picocolors';
import { readManifest } from '../infra/manifest.js';
import { openRegistry } from '../infra/registry.js';

/** `list` — show what's installed (manifest.use) and what's available in the catalog. */
export async function listCmd(opts: { cwd?: string } = {}): Promise<void> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  const manifest = await readManifest(root);
  const installed = new Set(manifest.use);

  console.log(pc.bold('installed'));
  if (installed.size === 0) console.log(pc.dim('  (none — add some with `ai-workspace add <ref>`)'));
  else [...installed].sort().forEach((r) => console.log(`  ${pc.green('✓')} ${r}`));

  const registry = openRegistry(manifest.registry, root);
  if (!registry) {
    console.log(pc.dim('\nno catalog configured (add "registry" to .ai/workspace.json to browse shared artifacts).'));
    return;
  }
  const catalog = await registry.load();

  const refs = [
    ...catalog.artifacts.map((a) => `${a.kind}:${a.value.id}`),
    ...catalog.packs.map((p) => `pack:${p.id}`),
  ].sort();

  console.log(pc.bold('\navailable in catalog'));
  const width = Math.max(0, ...refs.map((r) => r.length));
  for (const ref of refs) {
    const mark = installed.has(ref) ? pc.green('✓') : ' ';
    console.log(`  ${mark} ${pc.cyan(ref.padEnd(width))}`);
  }
}
