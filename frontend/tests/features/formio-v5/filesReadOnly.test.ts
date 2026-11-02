import { describe, expect, it } from 'vitest';
import type { FormType } from '@formio/react';
import { withFilesReadOnly } from '@/src/features/formio-v5/filesReadOnly';

const SCHEMA = {
  display: 'form',
  components: [
    { type: 'textfield', key: 'name' },
    { type: 'file', key: 'plain' },
    {
      type: 'columns',
      columns: [{ components: [{ type: 'bcgov-file', key: 'inColumn' }] }],
    },
    {
      type: 'table',
      rows: [[{ components: [{ type: 'panel', components: [{ type: 'file', key: 'inTable' }] }] }]],
    },
  ],
} as unknown as FormType;

const find = (schema: FormType, key: string): Record<string, unknown> => {
  const search = (node: unknown): Record<string, unknown> | null => {
    if (!node || typeof node !== 'object') return null;
    if ((node as { key?: unknown }).key === key) return node as Record<string, unknown>;
    for (const value of Object.values(node)) {
      const found = search(value);
      if (found) return found;
    }
    return null;
  };
  const found = search(schema);
  if (!found) throw new Error(`No component ${key}`);
  return found;
};

describe('withFilesReadOnly', () => {
  it.each(['plain', 'inColumn', 'inTable'])('disables the file component %s', (key) => {
    expect(find(withFilesReadOnly(SCHEMA), key).disabled).toBe(true);
  });

  it('leaves other components as they are', () => {
    expect(find(withFilesReadOnly(SCHEMA), 'name').disabled).toBeUndefined();
  });

  it('leaves the schema it was given alone', () => {
    withFilesReadOnly(SCHEMA);
    expect(find(SCHEMA, 'plain').disabled).toBeUndefined();
  });
});
