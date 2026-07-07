/**
 * Filesystem shell — the ONLY place that touches disk. Hashing, file IO, lockfile IO,
 * and the blob cache that holds last-generated content for three-way merges.
 *
 * Hash is sha256 of the FINAL bytes (post-format, once formatting lands) — see
 * merge-engine.md "format before hash".
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WorkspaceLock } from '@ai-workspace/core';

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

export async function readIfExists(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export async function writeFileEnsured(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, 'utf8');
}

export async function removeIfExists(p: string): Promise<void> {
  await fs.rm(p, { force: true });
}

/* --- lockfile + blob cache, both under .ai/ --- */

const lockPath = (root: string) => path.join(root, '.ai', 'workspace-lock.json');
const blobPath = (root: string, hash: string) =>
  path.join(root, '.ai', 'cache', 'blobs', hash);

export async function loadLock(root: string): Promise<WorkspaceLock | undefined> {
  const raw = await readIfExists(lockPath(root));
  if (!raw) return undefined;
  return WorkspaceLock.parse(JSON.parse(raw));
}

export async function saveLock(root: string, lock: WorkspaceLock): Promise<void> {
  await writeFileEnsured(lockPath(root), `${JSON.stringify(lock, null, 2)}\n`);
}

/** Persist last-generated content so a real diff3 base is available on divergence. */
export async function cacheBlob(root: string, content: string): Promise<string> {
  const hash = sha256(content);
  await writeFileEnsured(blobPath(root, hash), content);
  return hash;
}

export async function loadBlob(root: string, hash: string): Promise<string | undefined> {
  return readIfExists(blobPath(root, hash));
}
