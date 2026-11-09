// The API's UUID check (zod's): an RFC 9562 version and variant, or the nil or max UUID.
const UUID_PATTERN =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

/** Whether the API would accept `value` as a UUID. */
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);
