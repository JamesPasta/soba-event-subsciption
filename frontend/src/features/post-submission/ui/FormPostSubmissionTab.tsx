'use client';

import type { Dictionary } from '@/src/types/dictionary';
import { postSubmissionActionUi } from '@/src/features/post-submission/actions/registry';
import { useFormPostSubmissionActions } from '@/src/features/post-submission/data/usePostSubmissionActions';
import FormActionDrawer from './FormActionDrawer';
import PostSubmissionActions from './PostSubmissionActions';
import UnknownActionDrawer from './UnknownActionDrawer';

/** A form's After Submission tab: what happens each time the form receives a submission. */
export default function FormPostSubmissionTab({
  dict,
  formId,
}: Readonly<{ dict: Dictionary; formId: string }>) {
  const { actions, error } = useFormPostSubmissionActions(formId);
  return (
    <PostSubmissionActions
      dict={dict}
      intro={dict.postSubmission.formIntro}
      actions={actions}
      error={error}
      renderAction={(action) => {
        const ui = postSubmissionActionUi(action.code);
        return ui ? (
          <FormActionDrawer key={action.code} dict={dict} formId={formId} action={action} ui={ui} />
        ) : (
          <UnknownActionDrawer
            key={action.code}
            dict={dict}
            code={action.code}
            name={action.name}
            description={action.description}
            enabled={action.settings.effective.enabled}
            note={
              action.scopes.includes('form') ? undefined : dict.postSubmission.workspaceOnlyNote
            }
          />
        );
      }}
    />
  );
}
