import { useId } from 'react';
import { sessionReadConfig } from '@/src/shared/api/swrConfig';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { classifyDataError } from '@/src/shared/api/dataError';
import { getFormSettings, getWorkspaceSettings } from '@/src/features/form-settings/data/api';
import {
  POST_SUBMISSION_SETTINGS_KEY,
  type PostSubmissionFormActionList,
  type PostSubmissionWorkspaceActionList,
} from '@/src/types/postSubmission';

// Each mount reads the list anew: which actions show depends on features an administrator can
// change at any time.

/** The post-submission actions a form can set, and whether its workspace can set each. */
export function useFormPostSubmissionActions(formId: string) {
  const readId = useId();
  const { data, error } = useAuthedSWR<PostSubmissionFormActionList>(
    ['post-submission-actions', 'form', formId, readId],
    (token) => getFormSettings(token, formId, POST_SUBMISSION_SETTINGS_KEY),
    sessionReadConfig,
  );
  return { actions: data?.actions, error: error ? classifyDataError(error) : null };
}

/** The post-submission actions a workspace can set for its forms. */
export function useWorkspacePostSubmissionActions(workspaceId: string) {
  const readId = useId();
  const { data, error } = useAuthedSWR<PostSubmissionWorkspaceActionList>(
    ['post-submission-actions', 'workspace', workspaceId, readId],
    (token) => getWorkspaceSettings(token, workspaceId, POST_SUBMISSION_SETTINGS_KEY),
    sessionReadConfig,
  );
  return { actions: data?.actions, error: error ? classifyDataError(error) : null };
}
