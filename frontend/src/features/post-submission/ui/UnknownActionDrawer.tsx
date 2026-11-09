'use client';

import { statusText } from '@/src/features/post-submission/actions/status';
import type { Dictionary } from '@/src/types/dictionary';
import ReadOnlyActionDrawer from './ReadOnlyActionDrawer';

/**
 * An action the server lists but this build has no fields for: its name and description as the
 * server gives them, whether it is on, and where it is set when that is elsewhere.
 */
export default function UnknownActionDrawer({
  dict,
  code,
  name,
  description,
  enabled,
  note,
}: Readonly<{
  dict: Dictionary;
  code: string;
  name: string;
  description?: string;
  enabled: boolean;
  note?: string;
}>) {
  return (
    <ReadOnlyActionDrawer id={code} label={name}>
      <div data-testid={`${code}-unknown`}>
        {description && <p>{description}</p>}
        <p>{statusText(dict, enabled)}</p>
        <p>{dict.postSubmission.unknownAction}</p>
        {note && <p data-testid={`${code}-unknown-note`}>{note}</p>}
      </div>
    </ReadOnlyActionDrawer>
  );
}
