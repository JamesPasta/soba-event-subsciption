'use client';

import type { Dictionary } from '@/src/types/dictionary';
import { postSubmissionActionUi } from '@/src/features/post-submission/actions/registry';
import { useWorkspacePostSubmissionActions } from '@/src/features/post-submission/data/usePostSubmissionActions';
import PostSubmissionActions from './PostSubmissionActions';
import UnknownActionDrawer from './UnknownActionDrawer';
import WorkspaceActionDrawer from './WorkspaceActionDrawer';

/** A workspace's After Submission tab: what happens when its forms receive submissions. */
export default function WorkspacePostSubmissionTab({
  dict,
  workspaceId,
}: Readonly<{ dict: Dictionary; workspaceId: string }>) {
  const { actions, error } = useWorkspacePostSubmissionActions(workspaceId);
  return (
    <PostSubmissionActions
      dict={dict}
      intro={dict.postSubmission.workspaceIntro}
      actions={actions}
      error={error}
      renderAction={(action) => {
        const ui = postSubmissionActionUi(action.code);
        return ui ? (
          <WorkspaceActionDrawer
            key={action.code}
            dict={dict}
            workspaceId={workspaceId}
            code={action.code}
            ui={ui}
          />
        ) : (
          <UnknownActionDrawer
            key={action.code}
            dict={dict}
            code={action.code}
            name={action.name}
            description={action.description}
            enabled={action.settings.values.enabled}
          />
        );
      }}
    />
  );
}
