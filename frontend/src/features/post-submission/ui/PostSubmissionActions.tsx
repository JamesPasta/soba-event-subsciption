'use client';

import type { ReactNode } from 'react';
import { AccordionGroup, InlineAlert } from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import type { DataError } from '@/src/shared/api/dataContracts';
import { messageForDataError } from '@/src/shared/api/dataError';
import type { Dictionary } from '@/src/types/dictionary';

/**
 * The After Submission tab around its drawers: loading, a read that failed, a scope with no actions,
 * or one drawer per action in the server's order. A 404 means post-submission is no longer
 * available here, such as after it was turned off.
 */
export default function PostSubmissionActions<T extends { code: string }>({
  dict,
  intro,
  actions,
  error,
  renderAction,
}: Readonly<{
  dict: Dictionary;
  intro: string;
  actions: T[] | undefined;
  error: DataError | null;
  renderAction: (action: T) => ReactNode;
}>) {
  const t = dict.postSubmission;
  if (error) {
    return (
      <InlineAlert
        variant="warning"
        title={messageForDataError(error, {
          sessionExpired: dict.general.sessionExpired,
          forbidden: dict.general.noAccess,
          notFound: t.notAvailable,
          failed: t.loadError,
        })}
        data-testid="post-submission-load-error"
      />
    );
  }
  if (!actions) return <CenteredProgress label={dict.general.loading} />;
  if (actions.length === 0) return <p data-testid="post-submission-empty">{t.empty}</p>;
  return (
    <>
      <p data-testid="post-submission-intro">{intro}</p>
      <AccordionGroup allowsMultipleExpanded={false} defaultExpandedKeys={[actions[0].code]}>
        {actions.map(renderAction)}
      </AccordionGroup>
    </>
  );
}
