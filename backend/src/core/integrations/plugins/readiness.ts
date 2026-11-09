export interface Readiness {
  ok: boolean;
  message?: string;
}

type ReadinessCheck = () => Promise<Readiness | undefined> | Readiness | undefined;

/** Resolve a non-gating readiness report, turning any throw/rejection into { ok: false }. An
 *  undefined result (adapter with no readinessCheck) counts as reachable. */
export async function reportReadiness(check: ReadinessCheck): Promise<Readiness> {
  try {
    return (await check()) ?? { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** reportReadiness for each key, checked concurrently. */
export async function reportReadinessByKey(
  keys: readonly string[],
  check: (key: string) => ReturnType<ReadinessCheck>,
): Promise<Record<string, Readiness>> {
  const results = await Promise.all(
    keys.map(async (key) => [key, await reportReadiness(() => check(key))] as const),
  );
  return Object.fromEntries(results);
}
