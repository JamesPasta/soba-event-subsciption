import { createHash } from 'node:crypto';
import type { FormEngineAdapter } from '../integrations/form-engine/FormEngineAdapter';

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : 1);

/**
 * JSON with object keys sorted at every depth, so equal values serialize alike whatever their key
 * order. Undefined members are dropped as JSON.stringify drops them.
 */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const members = Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort(byCodeUnit)
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      );
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/**
 * A SHA-256 hex digest of the canonical JSON of what the engine renders from the schema, so
 * versions that differ only in their stored identity hash equal. An engine that does not say what
 * it renders has the whole document hashed.
 */
export const schemaHashOf = (
  schema: Record<string, unknown>,
  engine: Pick<FormEngineAdapter, 'renderedSchema'>,
): string =>
  createHash('sha256')
    .update(canonicalJson(engine.renderedSchema?.(schema) ?? schema))
    .digest('hex');
