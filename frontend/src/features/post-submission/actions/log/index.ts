import type { PostSubmissionActionUi } from '../types';
import LogEditor from './LogEditor';
import LogView from './LogView';
import { noteOf, withNote } from './note';

/** Logs that it ran; listed on PR environments to exercise the path. */
export const logAction: PostSubmissionActionUi = {
  label: (dict) => dict.postSubmission.log.label,
  description: (dict) => dict.postSubmission.log.description,
  Editor: LogEditor,
  View: LogView,
  problem: () => null,
  saved: (values) => withNote(values, noteOf(values).trim()),
};
