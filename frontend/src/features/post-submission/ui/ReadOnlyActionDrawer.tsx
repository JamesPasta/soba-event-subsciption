'use client';

import { Accordion } from '@bcgov/design-system-react-components';

/** A drawer with nothing to save: an action shown here but set elsewhere, or not known here. */
export default function ReadOnlyActionDrawer({
  id,
  label,
  children,
}: Readonly<{ id: string; label: string; children: React.ReactNode }>) {
  return (
    <Accordion id={id} data-testid={`accordion-${id}`} label={label}>
      <div className="d-block w-100">{children}</div>
    </Accordion>
  );
}
