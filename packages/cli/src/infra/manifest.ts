/** Read/write `.ai/workspace.json`, with friendly validation errors. Shared by all commands. */

import path from 'node:path';
import { friendlyError, WorkspaceManifest } from '@ai-workspace/core';
import { readIfExists, writeFileEnsured } from './fs-shell.js';

const manifestPath = (root: string) => path.join(root, '.ai', 'workspace.json');

export async function readManifest(root: string): Promise<WorkspaceManifest> {
  const raw = await readIfExists(manifestPath(root));
  if (!raw) throw new Error('no .ai/workspace.json found — run `ai-workspace init` first');
  try {
    return WorkspaceManifest.parse(JSON.parse(raw));
  } catch (err) {
    throw new Error(`.ai/workspace.json is invalid:\n${friendlyError(err)}`);
  }
}

export async function writeManifest(root: string, manifest: WorkspaceManifest): Promise<void> {
  await writeFileEnsured(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
}
