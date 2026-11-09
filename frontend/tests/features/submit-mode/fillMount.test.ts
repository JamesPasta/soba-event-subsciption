import { describe, it, expect } from 'vitest';
import { nextMount, type MountedLoad } from '@/src/features/formio-v5/fillMount';
import type { SubmitFillBundle } from '@/src/types/forms';

const bundle = (headRevisionId: string) => ({ headRevisionId }) as unknown as SubmitFillBundle;
const loaded = bundle('rev-1');
const reloaded = bundle('rev-2');

const load = (
  loadId: string,
  canWrite: boolean,
  canSaveDraft: boolean,
  of: SubmitFillBundle = loaded,
): MountedLoad => ({ loadId, bundle: of, canWrite, canSaveDraft });

describe('nextMount', () => {
  const held = load('0', false, false);

  it.each([
    ['nothing to mount yet', null, null, '0', null],
    ['the first load once it is ready', null, load('0', true, true), '0', load('0', true, true)],
    ['the held load when the read empties or fails', held, null, '0', held],
    [
      'the held load when a decision narrows',
      load('0', true, true),
      held,
      '0',
      load('0', true, true),
    ],
    [
      'the next load from its read',
      held,
      load('1', true, false, reloaded),
      '1',
      load('1', true, false, reloaded),
    ],
    ['nothing for a next load whose read failed', held, null, '1', null],
    [
      'the held load when the read for the next load arrives before it is asked for',
      held,
      load('0', true, true, reloaded),
      '0',
      held,
    ],
  ])('mounts %s', (_label, current, live, loadId, expected) => {
    expect(nextMount(current, live, loadId)).toEqual(expected);
  });

  it('widens a held load over the same bundle, keeping the bundle it mounted with', () => {
    const widened = nextMount(held, load('0', true, false), '0');
    expect(widened).toEqual(load('0', true, false));
    expect(widened?.bundle).toBe(loaded);
  });

  it('returns the held load itself when nothing changes, so a render settles', () => {
    expect(nextMount(held, load('0', false, false), '0')).toBe(held);
  });
});
