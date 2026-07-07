import { describe, expect, it } from 'vitest';
import { friendlyError } from './errors.js';
import { WorkspaceManifest } from './domain/schema/workspace.js';

describe('friendlyError', () => {
  it('formats a Zod failure as one readable line per problem', () => {
    const result = WorkspaceManifest.safeParse({ version: 2 });
    expect(result.success).toBe(false);
    const msg = friendlyError(result.error);
    expect(msg).toContain('version:');
    expect(msg).toContain('providers:');
    expect(msg).not.toContain('{'); // no raw JSON dump
  });

  it('passes a plain error message through unchanged', () => {
    expect(friendlyError(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-error values', () => {
    expect(friendlyError('nope')).toBe('nope');
  });
});
