export const RENDER_BUSY = 'Document generation is busy; try again shortly';

// Renders in progress in this process.
let inFlight = 0;

/** Take one of `max` render slots this process shares; null when every slot is taken. */
export function takeRenderSlot(max: number): (() => void) | null {
  if (inFlight >= max) return null;
  inFlight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
}

/** Run `render` in one of `max` render slots this process shares; 'busy' when every slot is taken. */
export async function withRenderSlot<T>(
  max: number,
  render: () => Promise<T>,
): Promise<T | 'busy'> {
  const release = takeRenderSlot(max);
  if (!release) return 'busy';
  try {
    return await render();
  } finally {
    release();
  }
}
