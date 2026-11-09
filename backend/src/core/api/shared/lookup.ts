/** Lookups feed select controls: a small item shape, no paging, and a limit of their own. */
export const MAX_LOOKUP_LIMIT = 500;

/** The extra row is how a lookup knows that more matched than it returns. */
export const LOOKUP_FETCH_LIMIT = MAX_LOOKUP_LIMIT + 1;

export const LOOKUP_NOTE = `Returns at most ${MAX_LOOKUP_LIMIT} items; \`truncated\` is true when more matched. Narrow with \`q\`.`;

export const toLookupResponse = <T>(rows: T[]) => ({
  items: rows.slice(0, MAX_LOOKUP_LIMIT),
  limit: MAX_LOOKUP_LIMIT,
  truncated: rows.length > MAX_LOOKUP_LIMIT,
});
