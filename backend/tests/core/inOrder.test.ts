import { findInOrder, mapInOrder } from '../../src/core/inOrder';

/** Resolves after `ms`, recording when each call starts and ends. */
const tracked = (events: string[]) => (label: string, ms: number) => {
  events.push(`start ${label}`);
  return new Promise<string>((resolve) =>
    setTimeout(() => {
      events.push(`end ${label}`);
      resolve(label);
    }, ms),
  );
};

describe('mapInOrder', () => {
  it('runs one item at a time and returns results in item order', async () => {
    const events: string[] = [];
    const run = tracked(events);

    const results = await mapInOrder(
      [
        ['a', 20],
        ['b', 0],
        ['c', 10],
      ] as const,
      ([label, ms]) => run(label, ms),
    );

    expect(results).toEqual(['a', 'b', 'c']);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('passes each item its index', async () => {
    await expect(
      mapInOrder(['x', 'y'], (item, index) => Promise.resolve(`${item}${index}`)),
    ).resolves.toEqual(['x0', 'y1']);
  });

  it('resolves to an empty array for no items', async () => {
    await expect(mapInOrder([], () => Promise.resolve(1))).resolves.toEqual([]);
  });

  it('stops at the first rejection', async () => {
    const seen: number[] = [];
    const result = mapInOrder([1, 2, 3], (n) => {
      seen.push(n);
      return n === 2 ? Promise.reject(new Error('two')) : Promise.resolve(n);
    });

    await expect(result).rejects.toThrow('two');
    expect(seen).toEqual([1, 2]);
  });

  it('does not grow the call stack with the list length', async () => {
    const items = Array.from({ length: 20_000 }, (_, i) => i);
    const results = await mapInOrder(items, (n) => Promise.resolve(n * 2));
    expect(results).toHaveLength(20_000);
    expect(results[19_999]).toBe(39_998);
  });
});

describe('findInOrder', () => {
  it('returns the first result that is not null or undefined and skips the rest', async () => {
    const seen: number[] = [];
    const found = await findInOrder([1, 2, 3, 4], (n) => {
      seen.push(n);
      return Promise.resolve(n >= 2 ? `found ${n}` : undefined);
    });

    expect(found).toBe('found 2');
    expect(seen).toEqual([1, 2]);
  });

  it('skips null and undefined but matches other falsy values', async () => {
    const seen: number[] = [];
    const found = await findInOrder([1, 2, 3, 4], (n) => {
      seen.push(n);
      return Promise.resolve([null, undefined, 0, 1][n - 1]);
    });

    expect(found).toBe(0);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('resolves to undefined when nothing matches', async () => {
    await expect(findInOrder([1, 2], () => Promise.resolve(undefined))).resolves.toBeUndefined();
  });

  it('runs one item at a time', async () => {
    const events: string[] = [];
    const run = tracked(events);

    await findInOrder(
      [
        ['a', 20],
        ['b', 0],
      ] as const,
      async ([label, ms]) => {
        await run(label, ms);
        return undefined;
      },
    );

    expect(events).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});
