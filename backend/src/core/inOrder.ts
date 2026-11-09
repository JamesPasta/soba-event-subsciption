/** Runs `fn` one item at a time, in order, and returns the results. */
export function mapInOrder<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const next = async (index: number): Promise<R[]> => {
    if (index === items.length) return results;
    results.push(await fn(items[index], index));
    return next(index + 1);
  };
  return next(0);
}

/** Runs `fn` one item at a time, in order, until it returns neither null nor undefined. */
export function findInOrder<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R | null | undefined>,
): Promise<R | undefined> {
  const next = async (index: number): Promise<R | undefined> => {
    if (index === items.length) return undefined;
    const found = await fn(items[index]);
    return found ?? next(index + 1);
  };
  return next(0);
}
