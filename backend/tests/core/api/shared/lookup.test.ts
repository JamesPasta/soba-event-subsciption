import {
  LOOKUP_FETCH_LIMIT,
  MAX_LOOKUP_LIMIT,
  toLookupResponse,
} from '../../../../src/core/api/shared/lookup';
import { WorkspaceLookupQuerySchema } from '../../../../src/core/api/workspaces/schema';
import { FormVersionLookupQuerySchema } from '../../../../src/core/api/forms/schema';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `row-${i}` }));

describe('toLookupResponse', () => {
  it('returns every row and is not truncated at the limit', () => {
    const result = toLookupResponse(rows(MAX_LOOKUP_LIMIT));
    expect(result.items).toHaveLength(MAX_LOOKUP_LIMIT);
    expect(result).toMatchObject({ limit: MAX_LOOKUP_LIMIT, truncated: false });
  });

  // The repo is asked for one row past the limit; that row is never shipped.
  it('drops the extra row and reports truncation', () => {
    const result = toLookupResponse(rows(LOOKUP_FETCH_LIMIT));
    expect(result.items).toHaveLength(MAX_LOOKUP_LIMIT);
    expect(result.items.at(-1)).toEqual({ id: `row-${MAX_LOOKUP_LIMIT - 1}` });
    expect(result.truncated).toBe(true);
  });

  it('handles an empty result', () => {
    expect(toLookupResponse([])).toEqual({ items: [], limit: MAX_LOOKUP_LIMIT, truncated: false });
  });
});

describe('WorkspaceLookupQuerySchema', () => {
  it('accepts no filters', () => {
    expect(WorkspaceLookupQuerySchema.parse({})).toEqual({});
  });

  it('accepts one or more comma-separated permission codes', () => {
    expect(WorkspaceLookupQuerySchema.safeParse({ requiredPermissions: 'form_read' }).success).toBe(
      true,
    );
    expect(
      WorkspaceLookupQuerySchema.parse({
        requiredPermissions: 'form_create,design_create',
        disclaimerAccepted: 'true',
      }),
    ).toEqual({ requiredPermissions: 'form_create,design_create', disclaimerAccepted: 'true' });
  });

  it.each(['', 'form_create,', ',form_create', 'form_create, design_create', '*'])(
    'rejects the permission list %p',
    (requiredPermissions) => {
      expect(WorkspaceLookupQuerySchema.safeParse({ requiredPermissions }).success).toBe(false);
    },
  );

  it('rejects more than ten permission codes', () => {
    const codes = (n: number) => Array.from({ length: n }, () => 'form_read').join(',');
    expect(WorkspaceLookupQuerySchema.safeParse({ requiredPermissions: codes(10) }).success).toBe(
      true,
    );
    expect(WorkspaceLookupQuerySchema.safeParse({ requiredPermissions: codes(11) }).success).toBe(
      false,
    );
  });

  it('rejects a disclaimer flag other than true or false', () => {
    expect(WorkspaceLookupQuerySchema.safeParse({ disclaimerAccepted: 'yes' }).success).toBe(false);
  });

  it('does not accept paging', () => {
    expect(WorkspaceLookupQuerySchema.parse({ offset: '100', limit: '1000' })).toEqual({});
  });
});

describe('FormVersionLookupQuerySchema', () => {
  it('requires a form', () => {
    expect(FormVersionLookupQuerySchema.safeParse({}).success).toBe(false);
    expect(FormVersionLookupQuerySchema.parse({ formId: 'f1', q: ' 12 ' })).toEqual({
      formId: 'f1',
      q: '12',
    });
  });
});
