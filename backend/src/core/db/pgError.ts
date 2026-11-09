export const PG_UNIQUE_VIOLATION = '23505';

// Drizzle wraps the driver error, so the pg code can sit on the cause chain, not the top level.
export function hasPgCode(err: unknown, codes: readonly string[]): boolean {
  for (let e: unknown = err, depth = 0; e != null && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && codes.includes(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export type PgErrorFields = {
  name?: string;
  code: string;
  table?: string;
  column?: string;
  constraint?: string;
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * The fields of a Postgres error on the cause chain (pg's DatabaseError carries `severity`); null
 * when there is none. Never the message or query parameters, which carry submitted values.
 */
export function pgErrorFields(err: unknown): PgErrorFields | null {
  for (let e: unknown = err, depth = 0; e != null && depth < 5; depth++) {
    const fields = e as { code?: unknown; severity?: unknown };
    if (typeof fields.code === 'string' && typeof fields.severity === 'string') {
      const { table, column, constraint } = e as Record<string, unknown>;
      return {
        name: err instanceof Error ? err.name : undefined,
        code: fields.code,
        table: text(table),
        column: text(column),
        constraint: text(constraint),
      };
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** True when `err` is a unique violation on the named constraint or index. */
export function isUniqueViolationOn(err: unknown, constraint: string): boolean {
  const fields = pgErrorFields(err);
  return fields?.code === PG_UNIQUE_VIOLATION && fields.constraint === constraint;
}
