/**
 * Turn a validation failure into something a human can read.
 *
 * Zod's default `.message` is a JSON dump of every issue — fine for logs, hostile to
 * a user staring at a terminal. This formats each problem as one "field: what's wrong"
 * line. Falls back to the plain message for non-Zod errors (e.g. malformed JSON).
 */

import { ZodError } from 'zod';

export function friendlyError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues
      .map((issue) => {
        const field = issue.path.length ? issue.path.join('.') : '(top level)';
        return `  • ${field}: ${issue.message}`;
      })
      .join('\n');
  }
  return err instanceof Error ? err.message : String(err);
}
